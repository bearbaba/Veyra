/**
 * Veyra Settlement — Arc Studio-authored VeyraSettlement contract UI.
 *
 * Surfaces two operations:
 *   1. Direct Pay — instant USDC transfer through the settlement contract
 *   2. Escrow     — time-locked USDC held until release or refund
 *
 * Security invariants:
 * - Connected chain must be Arc Testnet (5042002) or Arc Mainnet (5042).
 * - VeyraSettlement must be deployed on the active chain.
 * - Recipient must be a valid non-zero EVM address.
 * - Amount must be > 0 USDC.
 * - Exact allowance is requested — not unlimited approval.
 * - Protocol fee and net amount are read from the live contract, not hardcoded.
 * - Payment reference is generated at review time so the user sees it before signing.
 * - Every transaction result is verified on-chain before "Verified" is shown.
 * - Escrow functions remain externally callable on-chain (EVM is permissionless).
 *   On-chain safety: payer controls their own funds; approval required; only payer
 *   can refund after timeout; payer/recipient can release early.
 */

import { useState, useCallback } from 'react';
import {
  useAccount, useWriteContract, useWaitForTransactionReceipt,
  useReadContract, useSwitchChain,
} from 'wagmi';
import { parseUnits, isAddress, formatUnits, erc20Abi } from 'viem';
import { ConnectKitButton } from 'connectkit';
import { AlertTriangle, CheckCircle, Clock, ExternalLink, Lock, Send, Unlock } from 'lucide-react';
import {
  VEYRA_SETTLEMENT_ABI,
  ARC_TESTNET_CHAIN_ID,
  ARC_MAINNET_CHAIN_ID,
  ARC_TESTNET_USDC,
  ARC_MAINNET_USDC,
  buildSettlementTxExplorerUrl,
  getVeyraSettlementDeployment,
} from '@/config/veyraSettlement';

function arcUsdcForChain(chainId: number): `0x${string}` {
  if (chainId === ARC_MAINNET_CHAIN_ID) return ARC_MAINNET_USDC;
  return ARC_TESTNET_USDC;
}

function arcChainLabel(chainId: number): string {
  if (chainId === ARC_MAINNET_CHAIN_ID) return 'Arc Mainnet';
  if (chainId === ARC_TESTNET_CHAIN_ID) return 'Arc Testnet';
  return `Chain ${chainId}`;
}

type Mode = 'pay' | 'escrow';
type Step = 'form' | 'review' | 'approve' | 'execute' | 'done' | 'error';

const USDC_DECIMALS = 6;
const MIN_ESCROW_HOURS = 1;
const MAX_ESCROW_DAYS = 30;
const BPS_DENOM = 10_000n;

/** Generates a unique payment reference at review time. */
function buildRef(): `0x${string}` {
  const entropy = crypto.getRandomValues(new Uint8Array(32));
  const hex = Array.from(entropy).map(b => b.toString(16).padStart(2, '0')).join('');
  return `0x${hex}`;
}

/** Format USDC with up to 6 decimal places, stripping trailing zeros. */
function fmtUsdc(raw: bigint): string {
  const s = formatUnits(raw, USDC_DECIMALS);
  return s.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}

/** Row in the review card. */
function ReviewRow({ label, value, mono = false, accent = false }: {
  label: string; value: React.ReactNode; mono?: boolean; accent?: boolean;
}) {
  return (
    <div className="px-4 py-3 flex justify-between items-center gap-3">
      <span className="text-xs text-white/50 shrink-0">{label}</span>
      <span className={`text-sm text-right break-all ${mono ? 'font-mono' : 'font-medium'} ${accent ? 'text-emerald-300' : 'text-white'}`}>
        {value}
      </span>
    </div>
  );
}

export function SettlementPage() {
  const { address, isConnected, chainId } = useAccount();
  const { switchChain } = useSwitchChain();

  const [mode, setMode] = useState<Mode>('pay');
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [escrowHours, setEscrowHours] = useState('24');
  const [step, setStep] = useState<Step>('form');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [approveTxHash, setApproveTxHash] = useState<`0x${string}` | undefined>();
  const [settleTxHash, setSettleTxHash] = useState<`0x${string}` | undefined>();
  // Payment reference fixed at review entry so user sees it before signing.
  const [paymentRef, setPaymentRef] = useState<`0x${string}` | null>(null);

  const deployment = chainId ? getVeyraSettlementDeployment(chainId) : null;
  const onArc = chainId === ARC_TESTNET_CHAIN_ID || chainId === ARC_MAINNET_CHAIN_ID;
  const activeUsdcAddress = chainId ? arcUsdcForChain(chainId) : ARC_TESTNET_USDC;
  const chainLabel = chainId ? arcChainLabel(chainId) : 'Arc';

  const amountParsed = (() => {
    try { return parseUnits(amount, USDC_DECIMALS); } catch { return 0n; }
  })();
  const recipientValid = isAddress(recipient.trim());
  const escrowSecondsValid = (() => {
    const h = parseFloat(escrowHours);
    return !isNaN(h) && h >= MIN_ESCROW_HOURS && h <= MAX_ESCROW_DAYS * 24;
  })();
  const canReview = recipientValid && amountParsed > 0n && (mode === 'pay' || escrowSecondsValid) && !!deployment;

  // Read live feeBps from the deployed contract.
  const { data: liveFeeBps } = useReadContract({
    address: deployment?.address,
    abi: VEYRA_SETTLEMENT_ABI,
    functionName: 'feeBps',
    chainId,
    query: { enabled: !!deployment && onArc, staleTime: 60_000 },
  });

  // Read live feeRecipient from the deployed contract.
  const { data: liveFeeRecipient } = useReadContract({
    address: deployment?.address,
    abi: VEYRA_SETTLEMENT_ABI,
    functionName: 'feeRecipient',
    chainId,
    query: { enabled: !!deployment && onArc, staleTime: 60_000 },
  });

  // Compute fee and net from live contract values.
  const feeBps = typeof liveFeeBps === 'number' ? BigInt(liveFeeBps) :
    typeof liveFeeBps === 'bigint' ? liveFeeBps : 0n;
  const feeAmount = amountParsed > 0n ? (amountParsed * feeBps) / BPS_DENOM : 0n;
  const netAmount = amountParsed - feeAmount;
  const feePercent = Number(feeBps) / 100;

  // Read current USDC allowance for the settlement contract.
  const { data: currentAllowance } = useReadContract({
    address: activeUsdcAddress,
    abi: erc20Abi,
    functionName: 'allowance',
    args: address && deployment ? [address, deployment.address] : undefined,
    chainId,
    query: { enabled: isConnected && !!deployment && !!address && onArc },
  });

  const needsApproval = currentAllowance !== undefined ? currentAllowance < amountParsed : true;

  const { writeContractAsync: writeApprove, isPending: approving } = useWriteContract();
  const { writeContractAsync: writeSettle, isPending: settling } = useWriteContract();
  const { isSuccess: approveConfirmed } = useWaitForTransactionReceipt({ hash: approveTxHash });
  const { isSuccess: settleConfirmed, data: settleReceipt } = useWaitForTransactionReceipt({ hash: settleTxHash });

  const reset = useCallback(() => {
    setStep('form');
    setErrorMsg(null);
    setApproveTxHash(undefined);
    setSettleTxHash(undefined);
    setPaymentRef(null);
  }, []);

  function handleReview() {
    setPaymentRef(buildRef()); // fix ref before user sees review screen
    setStep('review');
  }

  async function handleApprove() {
    if (!deployment || !address) return;
    setStep('approve');
    setErrorMsg(null);
    try {
      const hash = await writeApprove({
        address: activeUsdcAddress,
        abi: erc20Abi,
        functionName: 'approve',
        args: [deployment.address, amountParsed], // exact allowance
      });
      setApproveTxHash(hash);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Approval failed');
      setStep('error');
    }
  }

  async function handleSettle() {
    if (!deployment || !address || !paymentRef) return;
    setStep('execute');
    setErrorMsg(null);
    try {
      let hash: `0x${string}`;
      if (mode === 'pay') {
        hash = await writeSettle({
          address: deployment.address,
          abi: VEYRA_SETTLEMENT_ABI,
          functionName: 'pay',
          args: [recipient.trim() as `0x${string}`, amountParsed, paymentRef],
        });
      } else {
        const timeoutSeconds = BigInt(Math.round(parseFloat(escrowHours) * 3600));
        hash = await writeSettle({
          address: deployment.address,
          abi: VEYRA_SETTLEMENT_ABI,
          functionName: 'createEscrow',
          args: [recipient.trim() as `0x${string}`, amountParsed, timeoutSeconds, paymentRef],
        });
      }
      setSettleTxHash(hash);
      setStep('done');
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Transaction failed');
      setStep('error');
    }
  }

  // Auto-advance after approve confirmation
  if (approveConfirmed && step === 'approve' && approveTxHash) {
    setStep('review');
  }

  const explorerTxUrl = settleTxHash
    ? buildSettlementTxExplorerUrl(chainId ?? ARC_TESTNET_CHAIN_ID, settleTxHash)
    : null;

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
              <span className="text-xs text-emerald-300 font-medium">Contract verified on {chainLabel}</span>
            </div>
            <a href={deployment.explorerUrl} target="_blank" rel="noopener noreferrer"
              className="text-xs text-emerald-400/70 flex items-center gap-1 hover:text-emerald-300">
              {deployment.address.slice(0, 6)}…{deployment.address.slice(-4)}
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        )}

        {/* Not yet deployed on this Arc network */}
        {isConnected && onArc && !deployment && (
          <div className="rounded-2xl bg-white/[0.04] border border-white/[0.08] p-5 text-center space-y-2">
            <p className="text-sm text-white/70 font-medium">VeyraSettlement not yet deployed on {chainLabel}</p>
            <p className="text-xs text-white/40">
              {chainId === ARC_MAINNET_CHAIN_ID
                ? 'Mainnet deployment requires owner authorization. Use Arc Testnet to try Settlement.'
                : 'Switch to Arc Testnet to use Settlement.'}
            </p>
            <button onClick={() => switchChain({ chainId: ARC_TESTNET_CHAIN_ID })}
              className="mt-2 text-xs font-medium text-blue-400 underline">Use Arc Testnet</button>
          </div>
        )}

        {/* Form */}
        {isConnected && onArc && !!deployment && step === 'form' && (
          <>
            {/* Mode toggle */}
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

            <p className="text-xs text-white/40 px-1">
              {mode === 'pay'
                ? 'Immediately transfers USDC to recipient via the settlement contract. Instant and final.'
                : 'Locks USDC in the contract. Recipient claims before the timeout, or you refund after it.'}
            </p>

            {/* Escrow mainnet notice */}
            {mode === 'escrow' && chainId === ARC_MAINNET_CHAIN_ID && (
              <div className="rounded-xl bg-amber-500/10 border border-amber-500/20 px-4 py-3">
                <p className="text-xs text-amber-300">
                  Escrow is available on-chain but has not completed a live Mainnet canary test.
                  Use Direct Pay for the initial real-USDC transaction.
                </p>
              </div>
            )}

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

            {mode === 'escrow' && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-white/50 uppercase tracking-wide">Escrow timeout (hours)</label>
                <input value={escrowHours} onChange={(e) => setEscrowHours(e.target.value)}
                  placeholder="24" inputMode="numeric"
                  className="w-full rounded-xl bg-white/[0.06] border border-white/[0.08] px-4 py-3 text-sm text-white placeholder-white/30 focus:outline-none focus:border-white/20" />
                <p className="text-xs text-white/30">Min {MIN_ESCROW_HOURS}h — Max {MAX_ESCROW_DAYS * 24}h ({MAX_ESCROW_DAYS} days)</p>
              </div>
            )}

            <button disabled={!canReview} onClick={handleReview}
              className="w-full py-3.5 rounded-2xl bg-white text-black text-sm font-semibold disabled:opacity-30 disabled:cursor-not-allowed hover:bg-white/90 transition-colors">
              Review transaction
            </button>
          </>
        )}

        {/* Review — complete payment details per Phase 3 spec */}
        {isConnected && onArc && !!deployment && step === 'review' && (
          <div className="space-y-4">
            <div className="rounded-2xl bg-white/[0.04] border border-white/[0.08] divide-y divide-white/[0.06]">
              <ReviewRow label="Network" value={chainLabel} />
              <ReviewRow label="Your wallet" value={
                <span className="font-mono">{address?.slice(0, 8)}…{address?.slice(-6)}</span>
              } />
              <ReviewRow label="Type" value={mode === 'pay' ? 'Direct payment' : 'Escrow'} />
              <ReviewRow label="Recipient" value={
                <span className="font-mono">{recipient.slice(0, 10)}…{recipient.slice(-6)}</span>
              } mono />
              <ReviewRow label="Gross amount" value={`${fmtUsdc(amountParsed)} USDC`} />
              <ReviewRow label="Protocol fee" value={
                feeBps > 0n
                  ? `${fmtUsdc(feeAmount)} USDC (${feePercent}%)`
                  : `0 USDC (${feePercent}%)`
              } />
              {feeBps > 0n && typeof liveFeeRecipient === 'string' && (
                <ReviewRow label="Fee recipient" value={
                  <span className="font-mono text-xs">{liveFeeRecipient.slice(0, 8)}…{liveFeeRecipient.slice(-6)}</span>
                } mono />
              )}
              <ReviewRow label="Net to recipient" value={`${fmtUsdc(netAmount)} USDC`} accent />
              {mode === 'escrow' && (
                <ReviewRow label="Timeout" value={
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
              {paymentRef && (
                <ReviewRow label="Payment ref" value={
                  <span className="font-mono text-xs text-white/60">{paymentRef.slice(0, 14)}…</span>
                } mono />
              )}
            </div>

            {/* Step 1: Approve */}
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
                    Approval confirmed — ready to execute
                  </p>
                )}
                <p className="text-xs text-white/50 text-center">
                  {approveTxHash ? 'Step 2 of 2: ' : ''}Sign the {mode === 'pay' ? 'payment' : 'escrow creation'} transaction
                </p>
                <button disabled={settling} onClick={() => { void handleSettle(); }}
                  className="w-full py-3.5 rounded-2xl bg-white text-black text-sm font-semibold disabled:opacity-50 hover:bg-white/90 transition-colors">
                  {settling ? 'Waiting for signature…' : mode === 'pay' ? 'Send payment' : 'Create escrow'}
                </button>
              </div>
            )}

            <button onClick={reset} className="w-full py-2 text-sm text-white/40 hover:text-white/70">
              ← Back
            </button>
          </div>
        )}

        {/* Pending */}
        {(step === 'approve' || step === 'execute') && (
          <div className="rounded-2xl bg-white/[0.04] border border-white/[0.08] p-6 text-center space-y-3">
            <div className="w-10 h-10 mx-auto rounded-full border-2 border-white/20 border-t-white animate-spin" />
            <p className="text-sm text-white/70">
              {step === 'approve' ? 'Approving USDC…' : 'Submitting transaction…'}
            </p>
          </div>
        )}

        {/* Waiting for on-chain confirmation */}
        {step === 'done' && !settleConfirmed && settleTxHash && (
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

        {/* Verified success */}
        {step === 'done' && settleConfirmed && (
          <div className="rounded-2xl bg-emerald-500/10 border border-emerald-500/20 p-6 space-y-4">
            <div className="text-center space-y-2">
              <CheckCircle className="w-10 h-10 text-emerald-400 mx-auto" />
              <p className="text-base font-semibold text-white">
                {mode === 'pay' ? 'Payment verified' : 'Escrow created'}
              </p>
            </div>

            {/* Receipt */}
            <div className="rounded-xl bg-white/[0.04] border border-white/[0.06] divide-y divide-white/[0.06]">
              <ReviewRow label="Gross amount" value={`${fmtUsdc(amountParsed)} USDC`} />
              <ReviewRow label="Protocol fee" value={`${fmtUsdc(feeAmount)} USDC`} />
              <ReviewRow label="Net received" value={`${fmtUsdc(netAmount)} USDC`} accent />
              {settleReceipt && (
                <ReviewRow label="Block" value={settleReceipt.blockNumber.toString()} />
              )}
              {paymentRef && (
                <ReviewRow label="Payment ref" value={
                  <span className="font-mono text-xs text-white/60">{paymentRef.slice(0, 14)}…</span>
                } mono />
              )}
            </div>

            {explorerTxUrl && (
              <a href={explorerTxUrl} target="_blank" rel="noopener noreferrer"
                className="flex items-center justify-center gap-1.5 text-sm text-blue-400 hover:underline">
                View on Arc Explorer <ExternalLink className="w-3.5 h-3.5" />
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

        {/* Error */}
        {step === 'error' && (
          <div className="rounded-2xl bg-red-500/10 border border-red-500/20 p-5 space-y-3">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm text-red-300 font-medium">Transaction failed</p>
                <p className="text-xs text-red-400/70 mt-1 break-words">{errorMsg}</p>
              </div>
            </div>
            <button onClick={reset} className="w-full py-2 text-sm text-white/40 hover:text-white/70">
              Try again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
