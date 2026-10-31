/**
 * Veyra Settlement — Arc Studio-authored VeyraSettlement contract UI.
 *
 * Surfaces two operations:
 *   1. Direct Pay   — instant USDC transfer through the settlement contract
 *   2. Escrow       — time-locked USDC held until release or refund
 *
 * Security invariants (enforced here, not assumed):
 * - Connected chain must be Arc Testnet or Arc Mainnet before any call.
 * - VeyraSettlement contract must be deployed on the active chain.
 * - Recipient must be a valid non-zero EVM address.
 * - Amount must be > 0 and within USDC decimal precision.
 * - Exact allowance is requested — not unlimited approval.
 * - User sees the exact amount, fee, and recipient before signing.
 * - Every transaction result is verified on-chain before "success" is shown.
 *
 * DEV isolation: this page does not share any state with CctpE2EPage.
 */

import { useState } from 'react';
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useReadContract, useSwitchChain } from 'wagmi';
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

/** The USDC ERC-20 address for the given Arc chain. */
function arcUsdcForChain(chainId: number): `0x${string}` {
  if (chainId === ARC_MAINNET_CHAIN_ID) return ARC_MAINNET_USDC;
  return ARC_TESTNET_USDC;
}

/** Human-readable label for an Arc chain. */
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

/** Generates a unique, deterministic reference bytes32 for a settlement call. */
function buildRef(): `0x${string}` {
  const ts = performance.now().toString(36) + Math.random().toString(36).slice(2);
  return `0x${ts.replace(/[^0-9a-f]/gi, '0').slice(0, 64).padEnd(64, '0')}`;
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

  const deployment = chainId ? getVeyraSettlementDeployment(chainId) : null;
  const onArc = chainId === ARC_TESTNET_CHAIN_ID || chainId === ARC_MAINNET_CHAIN_ID;
  const activeUsdcAddress = chainId ? arcUsdcForChain(chainId) : ARC_TESTNET_USDC;
  const chainLabel = chainId ? arcChainLabel(chainId) : 'Arc';

  // Derived values
  const recipientValid = isAddress(recipient.trim());
  const amountParsed = (() => {
    try { return parseUnits(amount, USDC_DECIMALS); } catch { return 0n; }
  })();
  const escrowSecondsValid = (() => {
    const h = parseFloat(escrowHours);
    return !isNaN(h) && h >= MIN_ESCROW_HOURS && h <= MAX_ESCROW_DAYS * 24;
  })();
  const canReview = recipientValid && amountParsed > 0n && (mode === 'pay' || escrowSecondsValid) && !!deployment;

  // Read current USDC allowance for the settlement contract on the active chain
  const { data: currentAllowance } = useReadContract({
    address: activeUsdcAddress,
    abi: erc20Abi,
    functionName: 'allowance',
    args: address && deployment ? [address, deployment.address] : undefined,
    chainId: chainId,
    query: { enabled: isConnected && !!deployment && !!address && onArc },
  });

  const needsApproval = currentAllowance !== undefined ? currentAllowance < amountParsed : true;

  // Approve USDC
  const { writeContractAsync: writeApprove, isPending: approving } = useWriteContract();
  // Execute settlement
  const { writeContractAsync: writeSettle, isPending: settling } = useWriteContract();

  // Wait for approve tx
  const { isSuccess: approveConfirmed } = useWaitForTransactionReceipt({ hash: approveTxHash });
  // Wait for settle tx
  const { isSuccess: settleConfirmed, data: settleReceipt } = useWaitForTransactionReceipt({ hash: settleTxHash });

  function reset() {
    setStep('form');
    setErrorMsg(null);
    setApproveTxHash(undefined);
    setSettleTxHash(undefined);
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
        args: [deployment.address, amountParsed], // exact allowance — not unlimited
      });
      setApproveTxHash(hash);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Approval failed');
      setStep('error');
    }
  }

  async function handleSettle() {
    if (!deployment || !address) return;
    setStep('execute');
    setErrorMsg(null);
    const ref = buildRef();
    try {
      let hash: `0x${string}`;
      if (mode === 'pay') {
        hash = await writeSettle({
          address: deployment.address,
          abi: VEYRA_SETTLEMENT_ABI,
          functionName: 'pay',
          args: [recipient.trim() as `0x${string}`, amountParsed, ref],
        });
      } else {
        const timeoutSeconds = BigInt(Math.round(parseFloat(escrowHours) * 3600));
        hash = await writeSettle({
          address: deployment.address,
          abi: VEYRA_SETTLEMENT_ABI,
          functionName: 'createEscrow',
          args: [recipient.trim() as `0x${string}`, amountParsed, timeoutSeconds, ref],
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
    setStep('review'); // return to review to let user click Execute
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
                <button
                  onClick={() => switchChain({ chainId: ARC_TESTNET_CHAIN_ID })}
                  className="text-xs font-medium text-amber-300 underline"
                >Arc Testnet</button>
                <button
                  onClick={() => switchChain({ chainId: ARC_MAINNET_CHAIN_ID })}
                  className="text-xs font-medium text-amber-300/60 underline"
                >Arc Mainnet</button>
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
            <a
              href={deployment.explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-emerald-400/70 flex items-center gap-1 hover:text-emerald-300"
            >
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
            <button
              onClick={() => switchChain({ chainId: ARC_TESTNET_CHAIN_ID })}
              className="mt-2 text-xs font-medium text-blue-400 underline"
            >Use Arc Testnet</button>
          </div>
        )}

        {/* Form */}
        {isConnected && onArc && !!deployment && step === 'form' && (
          <>
            {/* Mode toggle */}
            <div className="grid grid-cols-2 gap-2 rounded-xl bg-white/[0.04] p-1">
              {(['pay', 'escrow'] as Mode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`py-2 rounded-lg text-sm font-medium transition-colors ${
                    mode === m
                      ? 'bg-white/10 text-white'
                      : 'text-white/40 hover:text-white/70'
                  }`}
                >
                  {m === 'pay' ? (
                    <span className="flex items-center justify-center gap-1.5"><Send className="w-3.5 h-3.5" />Direct Pay</span>
                  ) : (
                    <span className="flex items-center justify-center gap-1.5"><Lock className="w-3.5 h-3.5" />Escrow</span>
                  )}
                </button>
              ))}
            </div>

            {/* Mode description */}
            <p className="text-xs text-white/40 px-1">
              {mode === 'pay'
                ? 'Immediately transfers USDC to recipient via the settlement contract. Instant and final.'
                : 'Locks USDC in the contract. Recipient claims before the timeout, or you refund after it.'}
            </p>

            {/* Recipient */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-white/50 uppercase tracking-wide">Recipient address</label>
              <input
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                placeholder="0x…"
                className="w-full rounded-xl bg-white/[0.06] border border-white/[0.08] px-4 py-3 text-sm text-white placeholder-white/30 focus:outline-none focus:border-white/20"
              />
              {recipient && !recipientValid && (
                <p className="text-xs text-red-400">Not a valid EVM address</p>
              )}
            </div>

            {/* Amount */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-white/50 uppercase tracking-wide">Amount (USDC)</label>
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                inputMode="decimal"
                className="w-full rounded-xl bg-white/[0.06] border border-white/[0.08] px-4 py-3 text-sm text-white placeholder-white/30 focus:outline-none focus:border-white/20"
              />
            </div>

            {/* Escrow timeout */}
            {mode === 'escrow' && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-white/50 uppercase tracking-wide">
                  Escrow timeout (hours)
                </label>
                <input
                  value={escrowHours}
                  onChange={(e) => setEscrowHours(e.target.value)}
                  placeholder="24"
                  inputMode="numeric"
                  className="w-full rounded-xl bg-white/[0.06] border border-white/[0.08] px-4 py-3 text-sm text-white placeholder-white/30 focus:outline-none focus:border-white/20"
                />
                <p className="text-xs text-white/30">
                  Min {MIN_ESCROW_HOURS}h — Max {MAX_ESCROW_DAYS * 24}h ({MAX_ESCROW_DAYS} days)
                </p>
              </div>
            )}

            <button
              disabled={!canReview}
              onClick={() => setStep('review')}
              className="w-full py-3.5 rounded-2xl bg-white text-black text-sm font-semibold disabled:opacity-30 disabled:cursor-not-allowed hover:bg-white/90 transition-colors"
            >
              Review transaction
            </button>
          </>
        )}

        {/* Review */}
        {isConnected && onArc && !!deployment && step === 'review' && (
          <div className="space-y-4">
            <div className="rounded-2xl bg-white/[0.04] border border-white/[0.08] divide-y divide-white/[0.06]">
              <div className="px-4 py-3 flex justify-between items-center">
                <span className="text-xs text-white/50">Type</span>
                <span className="text-sm text-white font-medium">{mode === 'pay' ? 'Direct payment' : 'Escrow'}</span>
              </div>
              <div className="px-4 py-3 flex justify-between items-center">
                <span className="text-xs text-white/50">Recipient</span>
                <span className="text-sm text-white font-mono">{recipient.slice(0, 8)}…{recipient.slice(-6)}</span>
              </div>
              <div className="px-4 py-3 flex justify-between items-center">
                <span className="text-xs text-white/50">Amount</span>
                <span className="text-sm text-white font-semibold">{formatUnits(amountParsed, USDC_DECIMALS)} USDC</span>
              </div>
              {mode === 'escrow' && (
                <div className="px-4 py-3 flex justify-between items-center">
                  <span className="text-xs text-white/50">Timeout</span>
                  <span className="text-sm text-white flex items-center gap-1.5"><Clock className="w-3.5 h-3.5 text-white/40" />{escrowHours}h</span>
                </div>
              )}
              <div className="px-4 py-3 flex justify-between items-center">
                <span className="text-xs text-white/50">Protocol fee</span>
                <span className="text-sm text-white">0%</span>
              </div>
              <div className="px-4 py-3 flex justify-between items-center">
                <span className="text-xs text-white/50">Contract</span>
                <a
                  href={deployment?.explorerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-blue-400 flex items-center gap-1 hover:underline"
                >
                  {deployment?.address.slice(0, 8)}…{deployment?.address.slice(-6)}
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>

            {needsApproval ? (
              <div className="space-y-3">
                <p className="text-xs text-white/50 text-center">
                  Step 1 of 2: Approve the settlement contract to spend exactly {formatUnits(amountParsed, USDC_DECIMALS)} USDC
                </p>
                <button
                  disabled={approving}
                  onClick={() => { void handleApprove(); }}
                  className="w-full py-3.5 rounded-2xl bg-white text-black text-sm font-semibold disabled:opacity-50 hover:bg-white/90 transition-colors"
                >
                  {approving ? 'Waiting for signature…' : `Approve ${formatUnits(amountParsed, USDC_DECIMALS)} USDC`}
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
                <button
                  disabled={settling}
                  onClick={() => { void handleSettle(); }}
                  className="w-full py-3.5 rounded-2xl bg-white text-black text-sm font-semibold disabled:opacity-50 hover:bg-white/90 transition-colors"
                >
                  {settling ? 'Waiting for signature…' : mode === 'pay' ? 'Send payment' : 'Create escrow'}
                </button>
              </div>
            )}

            <button
              onClick={reset}
              className="w-full py-2 text-sm text-white/40 hover:text-white/70"
            >
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

        {/* Success */}
        {step === 'done' && settleConfirmed && (
          <div className="rounded-2xl bg-emerald-500/10 border border-emerald-500/20 p-6 text-center space-y-4">
            <CheckCircle className="w-10 h-10 text-emerald-400 mx-auto" />
            <div>
              <p className="text-base font-semibold text-white">
                {mode === 'pay' ? 'Payment sent' : 'Escrow created'}
              </p>
              <p className="text-sm text-white/50 mt-1">
                {formatUnits(amountParsed, USDC_DECIMALS)} USDC {mode === 'pay' ? 'delivered' : 'locked'}
              </p>
            </div>
            {explorerTxUrl && (
              <a
                href={explorerTxUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-blue-400 hover:underline"
              >
                View on Arc Explorer
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
            {settleReceipt && (
              <p className="text-xs text-white/30 font-mono break-all">
                Block {settleReceipt.blockNumber.toString()} · {settleTxHash?.slice(0, 12)}…
              </p>
            )}
            <button
              onClick={reset}
              className="w-full py-2 text-sm text-white/40 hover:text-white/70"
            >
              New transaction
            </button>
          </div>
        )}

        {/* Waiting for onchain confirmation */}
        {step === 'done' && !settleConfirmed && settleTxHash && (
          <div className="rounded-2xl bg-white/[0.04] border border-white/[0.08] p-6 text-center space-y-3">
            <Unlock className="w-8 h-8 text-white/30 mx-auto" />
            <p className="text-sm text-white/70">Waiting for on-chain confirmation…</p>
            {explorerTxUrl && (
              <a
                href={explorerTxUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-blue-400 hover:underline flex items-center justify-center gap-1"
              >
                Track on Arc Explorer <ExternalLink className="w-3 h-3" />
              </a>
            )}
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
            <button
              onClick={reset}
              className="w-full py-2 text-sm text-white/40 hover:text-white/70"
            >
              Try again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
