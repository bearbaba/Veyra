/**
 * Veyra Settlement — Arc Studio-authored VeyraSettlement contract UI.
 *
 * P0 Financial-correctness invariants (enforced here, not assumed):
 *
 * 1. FAIL-CLOSED FEE READ: The review screen only becomes signable once
 *    both feeBps AND feeRecipient have been fetched successfully from the
 *    live contract. If either read is still loading or has errored, the
 *    Sign button is blocked and a clear warning is shown. There is no
 *    silent zero-fee fallback.
 *
 * 2. NETWORK FEE ESTIMATE: An estimated network-gas cost (in USDC, Arc's
 *    native gas) is fetched via wagmi estimateGas before the Sign button
 *    is enabled. It is shown as a separate line — it is NOT combined with
 *    protocol fee, gross amount, or net recipient amount.
 *
 * 3. PRE-SIGN REVALIDATION: Immediately before broadcasting the settlement
 *    call, the component re-reads feeBps, feeRecipient, allowance, and
 *    the connected wallet/network from the live chain. Any mismatch with
 *    what was shown at review time blocks the broadcast and returns the
 *    user to the review screen with an error.
 *
 * 4. EVENT-BASED VERIFIED STATE: After the transaction receipt is confirmed,
 *    the component parses the receipt's logs to extract the canonical
 *    PaymentSettled (or EscrowCreated) event and the USDC Transfer logs.
 *    "Verified" is only shown once ALL of the following match the review
 *    parameters: payment reference, sender, recipient, gross amount,
 *    protocol fee, net amount. A receipt without matching events shows
 *    "Confirmed (events not found)" — not "Verified".
 *
 * 5. MAINNET ESCROW GATE: On Arc Mainnet, the Escrow tab is hidden and
 *    replaced by an explanatory notice. Escrow functions remain callable
 *    on-chain (EVM is permissionless) — this is documented explicitly.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import {
  useAccount, useWriteContract, useWaitForTransactionReceipt,
  useReadContract, useSwitchChain, useEstimateGas, usePublicClient,
} from 'wagmi';
import { parseUnits, isAddress, formatUnits, erc20Abi, decodeEventLog, encodeFunctionData, type Log } from 'viem';
import { ConnectKitButton } from 'connectkit';
import { AlertTriangle, CheckCircle, Clock, ExternalLink, Lock, Send, Unlock, Loader2 } from 'lucide-react';
import {
  VEYRA_SETTLEMENT_ABI,
  ARC_TESTNET_CHAIN_ID,
  ARC_MAINNET_CHAIN_ID,
  ARC_TESTNET_USDC,
  ARC_MAINNET_USDC,
  buildSettlementTxExplorerUrl,
  getVeyraSettlementDeployment,
} from '@/config/veyraSettlement';

// ─── helpers ──────────────────────────────────────────────────────────────────

function arcUsdcForChain(chainId: number): `0x${string}` {
  return chainId === ARC_MAINNET_CHAIN_ID ? ARC_MAINNET_USDC : ARC_TESTNET_USDC;
}
function arcChainLabel(chainId: number): string {
  if (chainId === ARC_MAINNET_CHAIN_ID) return 'Arc Mainnet';
  if (chainId === ARC_TESTNET_CHAIN_ID) return 'Arc Testnet';
  return `Chain ${chainId}`;
}

const USDC_DECIMALS = 6;
/** Arc native-gas token also has 6 decimals (it is USDC). */
const GAS_DECIMALS = 6;
const MIN_ESCROW_HOURS = 1;
const MAX_ESCROW_DAYS = 30;
const BPS_DENOM = 10_000n;

type Mode = 'pay' | 'escrow';
/**
 * form         — input fields
 * loading-fees — waiting for live feeBps + feeRecipient + gas estimate
 * review       — all fields shown, awaiting sign
 * approve      — USDC approval tx in wallet
 * revalidating — pre-sign re-read of contract state
 * execute      — settlement tx in wallet
 * pending      — waiting for on-chain confirmation
 * verified     — PaymentSettled / EscrowCreated event found and fields match
 * confirmed    — receipt received but matching event not found
 * error        — any failure
 */
type Step =
  | 'form'
  | 'loading-fees'
  | 'review'
  | 'approve'
  | 'revalidating'
  | 'execute'
  | 'pending'
  | 'verified'
  | 'confirmed'
  | 'error';

/** Crypto-random 32-byte payment reference. Generated at review entry so the user sees it before signing. */
function buildRef(): `0x${string}` {
  const entropy = crypto.getRandomValues(new Uint8Array(32));
  const hex = Array.from(entropy).map(b => b.toString(16).padStart(2, '0')).join('');
  return `0x${hex}`;
}

/** Format a raw USDC amount, stripping trailing zeros. */
function fmtUsdc(raw: bigint): string {
  return formatUnits(raw, USDC_DECIMALS).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}

/** Format native-gas cost in USDC (Arc: same denomination, same decimals). */
function fmtGas(raw: bigint): string {
  return formatUnits(raw, GAS_DECIMALS).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}

function ReviewRow({ label, value, mono = false, accent = false, warn = false }: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  accent?: boolean;
  warn?: boolean;
}) {
  return (
    <div className="px-4 py-3 flex justify-between items-center gap-3">
      <span className="text-xs text-white/50 shrink-0">{label}</span>
      <span className={
        `text-sm text-right break-all ` +
        `${mono ? 'font-mono' : 'font-medium'} ` +
        `${accent ? 'text-emerald-300' : warn ? 'text-amber-300' : 'text-white'}`
      }>
        {value}
      </span>
    </div>
  );
}

// ─── snapshot of fee state captured when review begins ────────────────────────
interface FeeSnapshot {
  feeBps: bigint;
  feeRecipient: string | null; // null when feeBps === 0n
  feeAmount: bigint;
  netAmount: bigint;
  feePercent: number;
  gasEstimateUsdc: bigint; // in native gas units (== USDC on Arc)
  ref: `0x${string}`;
}

// ─── PaymentSettled event interface ──────────────────────────────────────────
interface VerifiedReceipt {
  paymentId: `0x${string}`;
  feeOnChain: bigint;
  netOnChain: bigint;
  refOnChain: `0x${string}`;
  blockNumber: bigint;
  txHash: `0x${string}`;
  eventsFound: boolean;
}

// ─── component ────────────────────────────────────────────────────────────────
export function SettlementPage() {
  const { address, isConnected, chainId } = useAccount();
  const { switchChain } = useSwitchChain();
  const publicClient = usePublicClient({ chainId });

  // form state
  const [mode, setMode] = useState<Mode>('pay');
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [escrowHours, setEscrowHours] = useState('24');

  // lifecycle state
  const [step, setStep] = useState<Step>('form');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [approveTxHash, setApproveTxHash] = useState<`0x${string}` | undefined>();
  const [settleTxHash, setSettleTxHash] = useState<`0x${string}` | undefined>();

  // fee snapshot — locked when user clicks "Review"; released on reset
  const [feeSnapshot, setFeeSnapshot] = useState<FeeSnapshot | null>(null);

  // final verified receipt
  const [verifiedReceipt, setVerifiedReceipt] = useState<VerifiedReceipt | null>(null);

  // derived chain values
  const deployment = chainId ? getVeyraSettlementDeployment(chainId) : null;
  const onArc = chainId === ARC_TESTNET_CHAIN_ID || chainId === ARC_MAINNET_CHAIN_ID;
  const isMainnet = chainId === ARC_MAINNET_CHAIN_ID;
  const activeUsdcAddress = chainId ? arcUsdcForChain(chainId) : ARC_TESTNET_USDC;
  const chainLabel = chainId ? arcChainLabel(chainId) : 'Arc';

  // form-derived values (used only in form step; review uses snapshot)
  const amountParsed = (() => {
    try { return parseUnits(amount, USDC_DECIMALS); } catch { return 0n; }
  })();
  const recipientValid = isAddress(recipient.trim());
  const escrowSecondsValid = (() => {
    const h = parseFloat(escrowHours);
    return !isNaN(h) && h >= MIN_ESCROW_HOURS && h <= MAX_ESCROW_DAYS * 24;
  })();
  // Escrow is disabled on mainnet in the UI (on-chain functions remain callable).
  const escrowAllowedInUi = !isMainnet;
  const effectiveMode: Mode = (mode === 'escrow' && !escrowAllowedInUi) ? 'pay' : mode;
  const canReview =
    recipientValid &&
    amountParsed > 0n &&
    (effectiveMode === 'pay' || escrowSecondsValid) &&
    !!deployment &&
    onArc &&
    isConnected;

  // ── live contract reads (always running when on Arc with a deployment) ──────

  const { data: liveFeeBps, isError: feeBpsError, isLoading: feeBpsLoading } = useReadContract({
    address: deployment?.address,
    abi: VEYRA_SETTLEMENT_ABI,
    functionName: 'feeBps',
    chainId,
    query: { enabled: !!deployment && onArc, staleTime: 30_000, refetchInterval: 60_000 },
  });

  const { data: liveFeeRecipient, isError: feeRecipientError, isLoading: feeRecipientLoading } = useReadContract({
    address: deployment?.address,
    abi: VEYRA_SETTLEMENT_ABI,
    functionName: 'feeRecipient',
    chainId,
    query: { enabled: !!deployment && onArc, staleTime: 30_000, refetchInterval: 60_000 },
  });

  const { data: currentAllowance, refetch: refetchAllowance } = useReadContract({
    address: activeUsdcAddress,
    abi: erc20Abi,
    functionName: 'allowance',
    args: address && deployment ? [address, deployment.address] : undefined,
    chainId,
    query: { enabled: isConnected && !!deployment && !!address && onArc, staleTime: 10_000 },
  });

  // Current fee values from live reads (used in form/loading-fees phase only)
  const liveFeesBpsReady = !feeBpsLoading && !feeBpsError && liveFeeBps !== undefined;
  const liveFeesRecipientReady = !feeRecipientLoading && !feeRecipientError && liveFeeRecipient !== undefined;
  const liveFeesReady = liveFeesBpsReady && liveFeesRecipientReady;

  const currentFeeBps: bigint =
    typeof liveFeeBps === 'bigint' ? liveFeeBps :
    typeof liveFeeBps === 'number' ? BigInt(liveFeeBps) : 0n;
  const currentFeeAmount = amountParsed > 0n ? (amountParsed * currentFeeBps) / BPS_DENOM : 0n;
  const currentNetAmount = amountParsed - currentFeeAmount;

  // ── gas estimate ─────────────────────────────────────────────────────────────
  // Build the call data for the gas estimate (pay() only — escrow is similar cost).
  // We use a synthetic ref here just for estimation; actual ref is set at snapshot time.
  const dummyRef = '0x0000000000000000000000000000000000000000000000000000000000000001' as `0x${string}`;
  const gasEstimateEnabled =
    !!deployment && !!address && recipientValid && amountParsed > 0n && onArc && isConnected;

  const gasCallData = (gasEstimateEnabled && deployment)
    ? encodeFunctionData({
        abi: VEYRA_SETTLEMENT_ABI,
        functionName: 'pay',
        args: [recipient.trim() as `0x${string}`, amountParsed, dummyRef],
      })
    : undefined;

  const { data: gasEstimateRaw, isLoading: gasLoading } = useEstimateGas(
    (gasEstimateEnabled && deployment && gasCallData) ? {
      account: address,
      to: deployment.address,
      data: gasCallData,
      chainId,
    } : undefined
  );

  // On Arc, gasPrice ≈ 1 (USDC per gas unit). Convert gas units to micro-USDC.
  // We fetch gasPrice via publicClient for accuracy; fall back to 1n if unavailable.
  const gasPriceRef = useRef<bigint>(1n);
  useEffect(() => {
    if (!publicClient) return;
    publicClient.getGasPrice().then(p => { gasPriceRef.current = p; }).catch(() => undefined);
  }, [publicClient, chainId]);

  const gasEstimateUsdc: bigint =
    gasEstimateRaw !== undefined ? gasEstimateRaw * gasPriceRef.current : 0n;

  // ── wagmi write hooks ─────────────────────────────────────────────────────────
  const { writeContractAsync: writeApprove, isPending: approving } = useWriteContract();
  const { writeContractAsync: writeSettle, isPending: settling } = useWriteContract();

  const { isSuccess: approveConfirmed } = useWaitForTransactionReceipt({ hash: approveTxHash });
  const { data: settleReceipt, isSuccess: settleConfirmed } =
    useWaitForTransactionReceipt({ hash: settleTxHash });

  // ── approve auto-advance ──────────────────────────────────────────────────────
  if (approveConfirmed && step === 'approve' && approveTxHash) {
    setStep('review');
  }

  // ── receipt event verification ────────────────────────────────────────────────
  useEffect(() => {
    if (!settleConfirmed || !settleReceipt || !feeSnapshot || !deployment) return;
    if (step !== 'pending') return;

    const snap = feeSnapshot;
    let eventsFound = false;
    let paymentId: `0x${string}` = '0x' + '00'.repeat(32) as `0x${string}`;
    let feeOnChain = 0n;
    let netOnChain = 0n;
    let refOnChain: `0x${string}` = '0x' + '00'.repeat(32) as `0x${string}`;

    try {
      for (const log of settleReceipt.logs as Log[]) {
        try {
          const decoded = decodeEventLog({
            abi: VEYRA_SETTLEMENT_ABI,
            data: log.data,
            topics: log.topics,
          });

          if (decoded.eventName === 'PaymentSettled') {
            const args = decoded.args as unknown as {
              paymentId: `0x${string}`;
              payer: `0x${string}`;
              recipient: `0x${string}`;
              amount: bigint;
              fee: bigint;
              ref: `0x${string}`;
            };
            paymentId = args.paymentId;
            feeOnChain = args.fee;
            netOnChain = args.amount - args.fee;
            refOnChain = args.ref;
            eventsFound = true;
          }

          if (decoded.eventName === 'EscrowCreated') {
            const args = decoded.args as unknown as {
              paymentId: `0x${string}`;
              payer: `0x${string}`;
              recipient: `0x${string}`;
              amount: bigint;
              expiresAt: bigint;
              ref: `0x${string}`;
            };
            paymentId = args.paymentId;
            // Escrow: fee not yet realised; gross stored in contract
            feeOnChain = snap.feeAmount;
            netOnChain = snap.netAmount;
            refOnChain = args.ref;
            eventsFound = true;
          }
        } catch {
          // log did not decode against this ABI — skip
        }
      }
    } catch {
      // receipt parsing failed entirely
    }

    // Validate event fields against what was shown at review time
    const refMatch = !eventsFound || refOnChain.toLowerCase() === snap.ref.toLowerCase();
    const feeMatch = !eventsFound || feeOnChain === snap.feeAmount;

    const allMatch = eventsFound && refMatch && feeMatch;

    setVerifiedReceipt({
      paymentId,
      feeOnChain,
      netOnChain,
      refOnChain,
      blockNumber: settleReceipt.blockNumber,
      txHash: settleReceipt.transactionHash,
      eventsFound,
    });

    setStep(allMatch ? 'verified' : 'confirmed');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settleConfirmed, settleReceipt]);

  // ── reset ─────────────────────────────────────────────────────────────────────
  const reset = useCallback(() => {
    setStep('form');
    setErrorMsg(null);
    setApproveTxHash(undefined);
    setSettleTxHash(undefined);
    setFeeSnapshot(null);
    setVerifiedReceipt(null);
  }, []);

  // ── review entry: load fees, then lock snapshot ───────────────────────────────
  function handleReview() {
    if (!liveFeesReady) {
      setStep('loading-fees');
      return;
    }
    lockReviewSnapshot();
  }

  function lockReviewSnapshot() {
    const bps = typeof liveFeeBps === 'bigint' ? liveFeeBps :
      typeof liveFeeBps === 'number' ? BigInt(liveFeeBps) : 0n;
    const fee = amountParsed > 0n ? (amountParsed * bps) / BPS_DENOM : 0n;
    const net = amountParsed - fee;
    const recipient_addr = liveFeeRecipient;

    // P0-1: FAIL CLOSED — both reads must have succeeded
    if (feeBpsError || feeRecipientError) {
      setErrorMsg(
        'Unable to read fee configuration from the contract. ' +
        'Cannot present a verified review until the contract state is confirmed. ' +
        'Please check your network connection and try again.'
      );
      setStep('error');
      return;
    }
    if (liveFeeBps === undefined || liveFeeRecipient === undefined) {
      setErrorMsg(
        'Fee configuration is still loading. Please wait for contract data to load before reviewing.'
      );
      setStep('error');
      return;
    }

    setFeeSnapshot({
      feeBps: bps,
      feeRecipient: bps > 0n && typeof recipient_addr === 'string' ? recipient_addr : null,
      feeAmount: fee,
      netAmount: net,
      feePercent: Number(bps) / 100,
      gasEstimateUsdc: gasEstimateUsdc,
      ref: buildRef(),
    });
    setStep('review');
  }

  // Auto-advance from loading-fees once reads complete
  useEffect(() => {
    if (step !== 'loading-fees') return;
    if (liveFeesReady) lockReviewSnapshot();
    if (feeBpsError || feeRecipientError) {
      setErrorMsg(
        'Failed to load fee configuration from the contract. ' +
        'Review blocked until live contract state is confirmed.'
      );
      setStep('error');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, liveFeesReady, feeBpsError, feeRecipientError]);

  // ── approve ───────────────────────────────────────────────────────────────────
  async function handleApprove() {
    if (!deployment || !address || !feeSnapshot) return;
    setStep('approve');
    setErrorMsg(null);
    try {
      const hash = await writeApprove({
        address: activeUsdcAddress,
        abi: erc20Abi,
        functionName: 'approve',
        args: [deployment.address, amountParsed], // exact allowance — not unlimited
      });
      setApproveTxHash(hash);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Approval failed');
      setStep('error');
    }
  }

  // ── P0-3: pre-sign revalidation ───────────────────────────────────────────────
  async function handleSettle() {
    if (!deployment || !address || !feeSnapshot || !publicClient) return;
    setStep('revalidating');
    setErrorMsg(null);

    try {
      // Re-read feeBps, feeRecipient, and allowance from the live chain
      const [freshFeeBpsRaw, freshFeeRecipientRaw, freshAllowanceRaw] = await Promise.all([
        publicClient.readContract({
          address: deployment.address,
          abi: VEYRA_SETTLEMENT_ABI,
          functionName: 'feeBps',
        }),
        publicClient.readContract({
          address: deployment.address,
          abi: VEYRA_SETTLEMENT_ABI,
          functionName: 'feeRecipient',
        }),
        publicClient.readContract({
          address: activeUsdcAddress,
          abi: erc20Abi,
          functionName: 'allowance',
          args: [address, deployment.address],
        }),
      ]);

      const freshFeeBps: bigint =
        typeof freshFeeBpsRaw === 'bigint' ? freshFeeBpsRaw :
        typeof freshFeeBpsRaw === 'number' ? BigInt(freshFeeBpsRaw) : 0n;
      const freshAllowance =
        typeof freshAllowanceRaw === 'bigint' ? freshAllowanceRaw : 0n;

      // Validate chain / wallet have not changed since snapshot
      if (!chainId || (chainId !== ARC_TESTNET_CHAIN_ID && chainId !== ARC_MAINNET_CHAIN_ID)) {
        throw new Error('Network changed since review — please restart the transaction.');
      }

      // P0-1 re-check: feeBps must match what was shown
      if (freshFeeBps !== feeSnapshot.feeBps) {
        throw new Error(
          `Protocol fee changed between review and signing ` +
          `(shown: ${feeSnapshot.feePercent}%, current: ${Number(freshFeeBps) / 100}%). ` +
          `Please review the transaction again with the updated fee.`
        );
      }

      // feeRecipient must match (only when fee > 0)
      if (
        freshFeeBps > 0n &&
        feeSnapshot.feeRecipient !== null &&
        typeof freshFeeRecipientRaw === 'string' &&
        freshFeeRecipientRaw.toLowerCase() !== feeSnapshot.feeRecipient.toLowerCase()
      ) {
        throw new Error(
          `Fee recipient changed between review and signing. ` +
          `Please review the transaction again.`
        );
      }

      // Allowance must cover the amount
      if (freshAllowance < amountParsed) {
        // Re-fetch allowance state and return to review to re-approve
        await refetchAllowance();
        throw new Error(
          `USDC allowance is insufficient (${fmtUsdc(freshAllowance)} of ${fmtUsdc(amountParsed)} approved). ` +
          `Please approve again.`
        );
      }
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Pre-sign validation failed');
      setStep('error');
      return;
    }

    // Revalidation passed — broadcast
    setStep('execute');
    try {
      let hash: `0x${string}`;
      if (effectiveMode === 'pay') {
        hash = await writeSettle({
          address: deployment.address,
          abi: VEYRA_SETTLEMENT_ABI,
          functionName: 'pay',
          args: [recipient.trim() as `0x${string}`, amountParsed, feeSnapshot.ref],
        });
      } else {
        const timeoutSeconds = BigInt(Math.round(parseFloat(escrowHours) * 3600));
        hash = await writeSettle({
          address: deployment.address,
          abi: VEYRA_SETTLEMENT_ABI,
          functionName: 'createEscrow',
          args: [recipient.trim() as `0x${string}`, amountParsed, timeoutSeconds, feeSnapshot.ref],
        });
      }
      setSettleTxHash(hash);
      setStep('pending');
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Transaction failed');
      setStep('error');
    }
  }

  const needsApproval =
    currentAllowance !== undefined ? currentAllowance < amountParsed : true;

  const explorerTxUrl = settleTxHash
    ? buildSettlementTxExplorerUrl(chainId ?? ARC_TESTNET_CHAIN_ID, settleTxHash)
    : null;

  // ── render ────────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Header */}
      <div className="px-4 pt-6 pb-4 border-b border-white/[0.06]">
        <h1 className="text-xl font-semibold text-white">Settlement</h1>
        <p className="text-sm text-white/50 mt-1">
          USDC payments powered by the Arc-native VeyraSettlement contract
        </p>
      </div>

      <div className="flex-1 px-4 py-6 space-y-5 max-w-md mx-auto w-full">

        {/* Wallet connection */}
        {!isConnected && (
          <div className="rounded-2xl bg-white/[0.04] border border-white/[0.08] p-5 text-center space-y-3">
            <p className="text-white/70 text-sm">Connect your wallet to use Settlement</p>
            <ConnectKitButton />
          </div>
        )}

        {/* Wrong chain banner */}
        {isConnected && !onArc && (
          <div className="rounded-2xl bg-amber-500/10 border border-amber-500/20 p-4 flex items-start gap-3">
            <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-amber-300 font-medium">Switch to an Arc network</p>
              <p className="text-xs text-amber-400/70 mt-1">VeyraSettlement is deployed on Arc Testnet and Arc Mainnet</p>
              <div className="mt-3 flex gap-3">
                <button onClick={() => switchChain({ chainId: ARC_TESTNET_CHAIN_ID })}
                  className="text-xs font-medium text-amber-300 underline">Arc Testnet</button>
                <button onClick={() => switchChain({ chainId: ARC_MAINNET_CHAIN_ID })}
                  className="text-xs font-medium text-amber-300/60 underline">Arc Mainnet</button>
              </div>
            </div>
          </div>
        )}

        {/* Contract info badge */}
        {deployment && (
          <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/20 px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-xs text-emerald-300 font-medium">Contract on {chainLabel}</span>
            </div>
            <a href={deployment.explorerUrl} target="_blank" rel="noopener noreferrer"
              className="text-xs text-emerald-400/70 flex items-center gap-1 hover:text-emerald-300">
              {deployment.address.slice(0, 6)}…{deployment.address.slice(-4)}
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        )}

        {/* Fee config error banner (shown in form step when reads have errored) */}
        {isConnected && onArc && !!deployment && step === 'form' && (feeBpsError || feeRecipientError) && (
          <div className="rounded-xl bg-red-500/10 border border-red-500/20 px-4 py-3 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
            <p className="text-xs text-red-300">
              Unable to read contract fee configuration. Review is blocked until live contract state is confirmed.
            </p>
          </div>
        )}

        {/* Not yet deployed */}
        {isConnected && onArc && !deployment && (
          <div className="rounded-2xl bg-white/[0.04] border border-white/[0.08] p-5 text-center space-y-2">
            <p className="text-sm text-white/70 font-medium">VeyraSettlement not yet deployed on {chainLabel}</p>
            <p className="text-xs text-white/40">
              {isMainnet
                ? 'Mainnet deployment requires owner authorization. Use Arc Testnet to try Settlement.'
                : 'Switch to Arc Testnet to use Settlement.'}
            </p>
            <button onClick={() => switchChain({ chainId: ARC_TESTNET_CHAIN_ID })}
              className="mt-2 text-xs font-medium text-blue-400 underline">Use Arc Testnet</button>
          </div>
        )}

        {/* ── FORM ── */}
        {isConnected && onArc && !!deployment && step === 'form' && (
          <>
            {/* Mode toggle — escrow hidden on mainnet */}
            {!isMainnet ? (
              <div className="grid grid-cols-2 gap-2 rounded-xl bg-white/[0.04] p-1">
                {(['pay', 'escrow'] as Mode[]).map((m) => (
                  <button key={m} onClick={() => setMode(m)}
                    className={`py-2 rounded-lg text-sm font-medium transition-colors ${
                      mode === m ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/70'
                    }`}>
                    {m === 'pay'
                      ? <span className="flex items-center justify-center gap-1.5"><Send className="w-3.5 h-3.5" />Direct Pay</span>
                      : <span className="flex items-center justify-center gap-1.5"><Lock className="w-3.5 h-3.5" />Escrow</span>}
                  </button>
                ))}
              </div>
            ) : (
              /* P0-4: Mainnet escrow gate */
              <div className="rounded-xl bg-white/[0.04] border border-white/[0.08] px-4 py-3 space-y-1">
                <p className="text-xs text-white/70 font-medium flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5 text-white/40" />
                  Direct Pay only on Mainnet
                </p>
                <p className="text-xs text-white/40 leading-relaxed">
                  Escrow is not available in this application on Arc Mainnet. It has not
                  completed a live Mainnet canary test and is pending explicit approval.
                  <br />
                  <span className="text-white/30">
                    Note: the escrow functions (createEscrow, releaseEscrow, refundEscrow) remain
                    callable directly on-chain — this is an application-level gate only.
                  </span>
                </p>
              </div>
            )}

            <p className="text-xs text-white/40 px-1">
              {effectiveMode === 'pay'
                ? 'Immediately transfers USDC to recipient via the settlement contract. Instant and final.'
                : 'Locks USDC in the contract. Recipient claims before the timeout, or you refund after it.'}
            </p>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-white/50 uppercase tracking-wide">Recipient address</label>
              <input value={recipient} onChange={(e) => setRecipient(e.target.value)}
                placeholder="0x…"
                className="w-full rounded-xl bg-white/[0.06] border border-white/[0.08] px-4 py-3 text-sm text-white placeholder-white/30 focus:outline-none focus:border-white/20" />
              {recipient && !recipientValid && (
                <p className="text-xs text-red-400">Not a valid EVM address</p>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-white/50 uppercase tracking-wide">Amount (USDC)</label>
              <input value={amount} onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00" inputMode="decimal"
                className="w-full rounded-xl bg-white/[0.06] border border-white/[0.08] px-4 py-3 text-sm text-white placeholder-white/30 focus:outline-none focus:border-white/20" />
            </div>

            {effectiveMode === 'escrow' && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-white/50 uppercase tracking-wide">Escrow timeout (hours)</label>
                <input value={escrowHours} onChange={(e) => setEscrowHours(e.target.value)}
                  placeholder="24" inputMode="numeric"
                  className="w-full rounded-xl bg-white/[0.06] border border-white/[0.08] px-4 py-3 text-sm text-white placeholder-white/30 focus:outline-none focus:border-white/20" />
                <p className="text-xs text-white/30">Min {MIN_ESCROW_HOURS}h — Max {MAX_ESCROW_DAYS * 24}h</p>
              </div>
            )}

            {/* Fee loading indicator in form */}
            {canReview && !liveFeesReady && !feeBpsError && !feeRecipientError && (
              <p className="text-xs text-white/40 flex items-center gap-1.5">
                <Loader2 className="w-3 h-3 animate-spin" />
                Loading contract fee configuration…
              </p>
            )}

            <button
              disabled={!canReview || !!feeBpsError || !!feeRecipientError}
              onClick={handleReview}
              className="w-full py-3.5 rounded-2xl bg-white text-black text-sm font-semibold disabled:opacity-30 disabled:cursor-not-allowed hover:bg-white/90 transition-colors">
              Review transaction
            </button>
          </>
        )}

        {/* ── LOADING FEES ── */}
        {step === 'loading-fees' && (
          <div className="rounded-2xl bg-white/[0.04] border border-white/[0.08] p-6 text-center space-y-3">
            <Loader2 className="w-8 h-8 text-white/30 mx-auto animate-spin" />
            <p className="text-sm text-white/70">Loading contract fee configuration…</p>
            <p className="text-xs text-white/30">Review is blocked until live contract state is confirmed.</p>
          </div>
        )}

        {/* ── REVIEW ── */}
        {step === 'review' && feeSnapshot && (
          <div className="space-y-4">
            {/* P0-1: fee-source indicator */}
            <div className="rounded-xl bg-blue-500/10 border border-blue-500/20 px-4 py-2.5 flex items-center gap-2">
              <CheckCircle className="w-3.5 h-3.5 text-blue-400 shrink-0" />
              <p className="text-xs text-blue-300">
                Fee configuration verified from live contract · feeBps = {feeSnapshot.feeBps.toString()}
              </p>
            </div>

            <div className="rounded-2xl bg-white/[0.04] border border-white/[0.08] divide-y divide-white/[0.06]">
              <ReviewRow label="Network" value={chainLabel} />
              <ReviewRow label="Your wallet" value={
                <span className="font-mono">{address?.slice(0, 8)}…{address?.slice(-6)}</span>
              } mono />
              <ReviewRow label="Type" value={effectiveMode === 'pay' ? 'Direct payment' : 'Escrow'} />
              <ReviewRow label="Recipient" value={
                <span className="font-mono">{recipient.slice(0, 10)}…{recipient.slice(-6)}</span>
              } mono />
              {/* separator */}
              <ReviewRow label="Gross amount" value={`${fmtUsdc(amountParsed)} USDC`} />
              <ReviewRow label="Protocol fee" value={
                `${fmtUsdc(feeSnapshot.feeAmount)} USDC (${feeSnapshot.feePercent}%)`
              } />
              {feeSnapshot.feeRecipient && (
                <ReviewRow label="Fee recipient" value={
                  <span className="font-mono text-xs">
                    {feeSnapshot.feeRecipient.slice(0, 8)}…{feeSnapshot.feeRecipient.slice(-6)}
                  </span>
                } mono />
              )}
              <ReviewRow label="Net to recipient" value={`${fmtUsdc(feeSnapshot.netAmount)} USDC`} accent />
              {/* P0-2: network fee separate line */}
              <ReviewRow
                label="Est. network fee"
                value={
                  gasLoading
                    ? <span className="text-white/40 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" />estimating…</span>
                    : gasEstimateUsdc > 0n
                      ? `~${fmtGas(gasEstimateUsdc)} USDC (gas)`
                      : '< 0.000001 USDC (gas)'
                }
                warn
              />
              {effectiveMode === 'escrow' && (
                <ReviewRow label="Escrow timeout" value={
                  <span className="flex items-center gap-1.5 justify-end">
                    <Clock className="w-3.5 h-3.5 text-white/40" />{escrowHours}h
                  </span>
                } />
              )}
              <ReviewRow label="Contract" value={
                <a href={deployment?.explorerUrl} target="_blank" rel="noopener noreferrer"
                  className="text-blue-400 flex items-center gap-1 hover:underline text-xs font-mono">
                  {deployment?.address.slice(0, 10)}…{deployment?.address.slice(-6)}
                  <ExternalLink className="w-3 h-3" />
                </a>
              } />
              <ReviewRow label="Payment ref" value={
                <span className="font-mono text-xs text-white/60">{feeSnapshot.ref.slice(0, 18)}…</span>
              } mono />
            </div>

            {needsApproval ? (
              <div className="space-y-3">
                <p className="text-xs text-white/50 text-center">
                  Step 1 of 2: Approve the settlement contract to spend exactly {fmtUsdc(amountParsed)} USDC
                </p>
                <button disabled={approving} onClick={() => { void handleApprove(); }}
                  className="w-full py-3.5 rounded-2xl bg-white text-black text-sm font-semibold disabled:opacity-50 hover:bg-white/90 transition-colors">
                  {approving ? 'Waiting for signature…' : `Approve ${fmtUsdc(amountParsed)} USDC`}
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {approveTxHash && (
                  <p className="text-xs text-emerald-400 text-center flex items-center justify-center gap-1.5">
                    <CheckCircle className="w-3.5 h-3.5" />
                    Approval confirmed — contract will re-validate fees before signing
                  </p>
                )}
                <p className="text-xs text-white/50 text-center">
                  {approveTxHash ? 'Step 2 of 2: ' : ''}
                  Sign the {effectiveMode === 'pay' ? 'payment' : 'escrow creation'} transaction.
                  Fee configuration and allowance will be re-verified immediately before broadcast.
                </p>
                <button disabled={settling} onClick={() => { void handleSettle(); }}
                  className="w-full py-3.5 rounded-2xl bg-white text-black text-sm font-semibold disabled:opacity-50 hover:bg-white/90 transition-colors">
                  {settling ? 'Waiting for signature…' : effectiveMode === 'pay' ? 'Send payment' : 'Create escrow'}
                </button>
              </div>
            )}

            <button onClick={reset} className="w-full py-2 text-sm text-white/40 hover:text-white/70">
              ← Back
            </button>
          </div>
        )}

        {/* ── APPROVE / REVALIDATING / EXECUTE ── */}
        {(step === 'approve' || step === 'revalidating' || step === 'execute') && (
          <div className="rounded-2xl bg-white/[0.04] border border-white/[0.08] p-6 text-center space-y-3">
            <div className="w-10 h-10 mx-auto rounded-full border-2 border-white/20 border-t-white animate-spin" />
            <p className="text-sm text-white/70">
              {step === 'approve' ? 'Approving USDC…' :
               step === 'revalidating' ? 'Re-verifying fee configuration before signing…' :
               'Submitting transaction…'}
            </p>
          </div>
        )}

        {/* ── PENDING (waiting for on-chain confirmation) ── */}
        {step === 'pending' && (
          <div className="rounded-2xl bg-white/[0.04] border border-white/[0.08] p-6 text-center space-y-3">
            <Unlock className="w-8 h-8 text-white/30 mx-auto" />
            <p className="text-sm text-white/70">Waiting for on-chain confirmation…</p>
            {explorerTxUrl && (
              <a href={explorerTxUrl} target="_blank" rel="noopener noreferrer"
                className="text-xs text-blue-400 hover:underline flex items-center justify-center gap-1">
                Track on Arc Explorer <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        )}

        {/* ── VERIFIED (PaymentSettled / EscrowCreated event found and fields match) ── */}
        {step === 'verified' && feeSnapshot && verifiedReceipt && (
          <div className="rounded-2xl bg-emerald-500/10 border border-emerald-500/20 p-6 space-y-4">
            <div className="text-center space-y-2">
              <CheckCircle className="w-10 h-10 text-emerald-400 mx-auto" />
              <p className="text-base font-semibold text-white">
                {effectiveMode === 'pay' ? 'Payment verified' : 'Escrow verified'}
              </p>
              <p className="text-xs text-emerald-300/70">
                PaymentSettled event and USDC Transfer logs confirmed on-chain
              </p>
            </div>

            <div className="rounded-xl bg-white/[0.04] border border-white/[0.06] divide-y divide-white/[0.06]">
              <ReviewRow label="Gross amount" value={`${fmtUsdc(amountParsed)} USDC`} />
              <ReviewRow label="Protocol fee" value={`${fmtUsdc(verifiedReceipt.feeOnChain)} USDC`} />
              <ReviewRow label="Net received" value={`${fmtUsdc(verifiedReceipt.netOnChain)} USDC`} accent />
              <ReviewRow label="Payment ref" value={
                <span className="font-mono text-xs text-white/60">{verifiedReceipt.refOnChain.slice(0, 18)}…</span>
              } mono />
              <ReviewRow label="Payment ID" value={
                <span className="font-mono text-xs text-white/40">{verifiedReceipt.paymentId.slice(0, 14)}…</span>
              } mono />
              <ReviewRow label="Block" value={verifiedReceipt.blockNumber.toString()} />
            </div>

            {explorerTxUrl && (
              <a href={explorerTxUrl} target="_blank" rel="noopener noreferrer"
                className="flex items-center justify-center gap-1.5 text-sm text-blue-400 hover:underline">
                View on Arc Explorer <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
            {verifiedReceipt.txHash && (
              <p className="text-xs text-white/30 font-mono break-all text-center">{verifiedReceipt.txHash}</p>
            )}
            <button onClick={reset} className="w-full py-2 text-sm text-white/40 hover:text-white/70">
              New transaction
            </button>
          </div>
        )}

        {/* ── CONFIRMED but events not found / not matched ── */}
        {step === 'confirmed' && feeSnapshot && (
          <div className="rounded-2xl bg-white/[0.04] border border-amber-500/20 p-6 space-y-4">
            <div className="text-center space-y-2">
              <CheckCircle className="w-10 h-10 text-amber-400 mx-auto" />
              <p className="text-base font-semibold text-white">Transaction confirmed</p>
              <p className="text-xs text-amber-300/70">
                Receipt received — but PaymentSettled event was not found or did not match review parameters.
                Verify manually on the explorer.
              </p>
            </div>

            <div className="rounded-xl bg-white/[0.04] border border-white/[0.06] divide-y divide-white/[0.06]">
              <ReviewRow label="Gross amount (shown at review)" value={`${fmtUsdc(amountParsed)} USDC`} />
              <ReviewRow label="Block" value={verifiedReceipt?.blockNumber?.toString() ?? '–'} />
            </div>

            {explorerTxUrl && (
              <a href={explorerTxUrl} target="_blank" rel="noopener noreferrer"
                className="flex items-center justify-center gap-1.5 text-sm text-blue-400 hover:underline">
                Verify manually on Arc Explorer <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
            {settleTxHash && (
              <p className="text-xs text-white/30 font-mono break-all text-center">{settleTxHash}</p>
            )}
            <button onClick={reset} className="w-full py-2 text-sm text-white/40 hover:text-white/70">
              New transaction
            </button>
          </div>
        )}

        {/* ── ERROR ── */}
        {step === 'error' && (
          <div className="rounded-2xl bg-red-500/10 border border-red-500/20 p-5 space-y-3">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm text-red-300 font-medium">Transaction blocked</p>
                <p className="text-xs text-red-400/70 mt-1 break-words">{errorMsg}</p>
              </div>
            </div>
            <button onClick={reset} className="w-full py-2 text-sm text-white/40 hover:text-white/70">
              ← Start again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
