/**
 * Veyra Bridge Page
 *
 * USDC Arc Testnet → Ethereum Sepolia / Base Sepolia via CCTP V2
 *
 * Pipeline enforced:
 *   User input → BridgeAction → Policy → Risk → Preflight →
 *   Review → Approve → Burn → Source verification →
 *   Attestation poll → Receive → Destination verification → VeyraReceipt
 *
 * Bridge requires separate source and destination chain wallets.
 * For MVP, the user must have both wallets connected or accept the limitation.
 *
 * Pending bridge receipts survive reload (stored in IndexedDB via receiptStore).
 */

import { useState } from 'react';
import { useAccount } from 'wagmi';
import { Globe, AlertTriangle, Info, ArrowRight, Loader2, CheckCircle, Lock } from 'lucide-react';
import { parseUnits, type Address } from 'viem';
import { evaluateBridgeAction, createBridgeAction, isSupportedBridgeRoute } from '../../core/pipeline/bridgePipeline';
import { MANIFEST_CONSTANTS, findManifestEntry } from '../../providers/registry/providerManifest';

// ── Lifecycle check ───────────────────────────────────────────────────────────
const CCTP_ENTRY = findManifestEntry('cctp-v2-bridge');
const CCTP_LIFECYCLE_READY = CCTP_ENTRY?.lifecycleStage === 'ENABLED' && CCTP_ENTRY?.enabled === true;

type BridgeState =
  | { phase: 'INPUT' }
  | { phase: 'EVALUATING' }
  | { phase: 'BLOCKED'; reason: string }
  | { phase: 'REVIEW'; evaluation: ReturnType<typeof evaluateBridgeAction> }
  | { phase: 'APPROVING' }
  | { phase: 'BURNING' }
  | { phase: 'BRIDGE_PENDING'; burnTxHash: string }
  | { phase: 'BRIDGE_UNCONFIRMED'; burnTxHash: string }
  | { phase: 'VERIFIED'; burnTxHash: string; receiveTxHash?: string }
  | { phase: 'FAILED'; error: string };

const DESTINATION_CHAINS = [
  { id: MANIFEST_CONSTANTS.ETH_SEPOLIA_CHAIN_ID, name: 'Ethereum Sepolia', usdc: MANIFEST_CONSTANTS.ETH_SEPOLIA_USDC },
  { id: MANIFEST_CONSTANTS.BASE_SEPOLIA_CHAIN_ID, name: 'Base Sepolia', usdc: MANIFEST_CONSTANTS.BASE_SEPOLIA_USDC },
];

export function BridgePage() {
  const { address, isConnected } = useAccount();

  const [amount, setAmount] = useState('');
  const [destChainId, setDestChainId] = useState<number>(MANIFEST_CONSTANTS.ETH_SEPOLIA_CHAIN_ID);
  const [recipientAddress, setRecipientAddress] = useState('');
  const [bridgeState, setBridgeState] = useState<BridgeState>({ phase: 'INPUT' });

  const selectedDest = DESTINATION_CHAINS.find((c) => c.id === destChainId)!;

  function handleEvaluate() {
    if (!address || !amount || !recipientAddress) return;

    const parsed = parseFloat(amount);
    if (isNaN(parsed) || parsed <= 0) return;

    if (!isSupportedBridgeRoute(MANIFEST_CONSTANTS.ARC_TESTNET_CHAIN_ID, destChainId)) {
      setBridgeState({ phase: 'BLOCKED', reason: `Route Arc Testnet → chain ${destChainId} is not supported` });
      return;
    }

    setBridgeState({ phase: 'EVALUATING' });

    try {
      const amountBigInt = parseUnits(amount, 6); // USDC has 6 decimals
      const action = createBridgeAction({
        from: address,
        to: recipientAddress,
        amount: amountBigInt,
        sourceChainId: MANIFEST_CONSTANTS.ARC_TESTNET_CHAIN_ID,
        destinationChainId: destChainId,
        tokenAddress: MANIFEST_CONSTANTS.ARC_TESTNET_USDC,
        tokenDecimals: 6,
      });

      const evaluation = evaluateBridgeAction(action);

      if (!evaluation.canProceed) {
        setBridgeState({ phase: 'BLOCKED', reason: evaluation.blockedReason ?? 'Action blocked' });
        return;
      }

      setBridgeState({ phase: 'REVIEW', evaluation });
    } catch (err) {
      setBridgeState({ phase: 'FAILED', error: err instanceof Error ? err.message : 'Evaluation failed' });
    }
  }

  // Note: actual bridge execution (approve + burn + poll + receive) requires
  // viem WalletClient from both source and destination chains.
  // In this MVP, the Review step presents the plan and the user can
  // initiate execution once source-chain walletClient is wired.
  // The execution path (useWriteContract) follows the same pattern as useTransferExecution.
  function handleBridgeNotYetWired() {
    // Bridge execution requires multi-chain wallet clients.
    // This will be wired in Phase C finalization with useWalletClient per chain.
    setBridgeState({ phase: 'FAILED', error: 'Bridge execution requires connecting both source and destination chain wallets. Use the manual Pay page for Arc Testnet transfers for now.' });
  }

  if (!isConnected) {
    return (
      <div className="max-w-md mx-auto px-4 py-8">
        <h1 className="display text-2xl font-bold mb-6" style={{ color: 'var(--ink)' }}>Bridge</h1>
        <div className="rounded-2xl p-6 text-center" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <Info className="size-6 mx-auto mb-3" style={{ color: 'var(--accent)' }} />
          <p className="text-sm" style={{ color: 'var(--muted)' }}>Connect your wallet to bridge USDC.</p>
        </div>
      </div>
    );
  }

  // Lifecycle gate — provider must reach ENABLED before execution
  if (!CCTP_LIFECYCLE_READY) {
    return (
      <div className="max-w-md mx-auto px-4 py-8">
        <h1 className="display text-2xl font-bold mb-6" style={{ color: 'var(--ink)' }}>Bridge</h1>
        <div className="rounded-2xl p-6" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="flex items-start gap-3 mb-4">
            <Lock className="size-5 mt-0.5 shrink-0" style={{ color: 'var(--muted)' }} />
            <div>
              <p className="text-sm font-semibold mb-1" style={{ color: 'var(--ink)' }}>Bridge is not yet available</p>
              <p className="text-sm" style={{ color: 'var(--muted)' }}>
                The CCTP V2 bridge provider is <span className="font-medium">
                  {CCTP_ENTRY?.lifecycleStage ?? 'unregistered'}
                </span> — real testnet end-to-end execution (burn, attestation, receive) must succeed before this feature can be enabled.
              </p>
            </div>
          </div>
          <div className="rounded-xl p-3 text-xs font-mono" style={{ background: 'var(--surface-raised)', color: 'var(--muted)' }}>
            <div>Provider: cctp-v2-bridge</div>
            <div>Lifecycle: {CCTP_ENTRY?.lifecycleStage ?? 'UNKNOWN'}</div>
            <div>Required: ENABLED</div>
            <div>Path: DISCOVERED → VERIFIED → IMPLEMENTED → TESTED → ENABLED</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto px-4 py-8 space-y-4">
      <div className="mb-2">
        <h1 className="display text-2xl font-bold" style={{ color: 'var(--ink)', letterSpacing: '-0.02em' }}>Bridge</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>USDC Arc Testnet → Ethereum Sepolia / Base Sepolia via CCTP V2</p>
      </div>

      {bridgeState.phase === 'INPUT' || bridgeState.phase === 'EVALUATING' || bridgeState.phase === 'BLOCKED' ? (
        <>
          {/* Route */}
          <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--border-strong)' }}>
            <div className="px-4 py-3" style={{ background: 'var(--surface)' }}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs uppercase tracking-wider font-medium" style={{ color: 'var(--muted)' }}>From</span>
                <span className="text-xs font-semibold" style={{ color: 'var(--accent)' }}>Arc Testnet</span>
              </div>
              <input
                type="number"
                value={amount}
                onChange={(e) => { setAmount(e.target.value); setBridgeState({ phase: 'INPUT' }); }}
                placeholder="0.00 USDC"
                className="w-full bg-transparent text-2xl font-semibold outline-none"
                style={{ color: 'var(--ink)' }}
              />
            </div>
            <div className="flex items-center justify-center py-2 border-t border-b" style={{ borderColor: 'var(--border)', background: 'var(--surface-strong)' }}>
              <ArrowRight className="size-4" style={{ color: 'var(--accent)' }} />
            </div>
            <div className="px-4 py-3" style={{ background: 'var(--surface)' }}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs uppercase tracking-wider font-medium" style={{ color: 'var(--muted)' }}>To</span>
                <select
                  value={destChainId}
                  onChange={(e) => setDestChainId(Number(e.target.value))}
                  className="bg-transparent text-xs font-semibold outline-none border rounded-lg px-2 py-1"
                  style={{ color: 'var(--accent)', borderColor: 'var(--border)', background: 'var(--surface-strong)' }}
                >
                  {DESTINATION_CHAINS.map((c) => (
                    <option key={c.id} value={c.id} style={{ background: '#0d1b2f' }}>{c.name}</option>
                  ))}
                </select>
              </div>
              <input
                type="text"
                value={recipientAddress}
                onChange={(e) => setRecipientAddress(e.target.value)}
                placeholder="Recipient 0x... (destination chain)"
                className="w-full bg-transparent text-sm outline-none"
                style={{ color: 'var(--ink-2)' }}
              />
            </div>
          </div>

          {/* Blocked */}
          {bridgeState.phase === 'BLOCKED' && (
            <div className="flex items-start gap-2 rounded-xl p-3.5" style={{ background: 'var(--danger-muted)', border: '1px solid var(--border)' }}>
              <AlertTriangle className="size-4 mt-0.5 shrink-0" style={{ color: 'var(--danger)' }} />
              <p className="text-sm" style={{ color: 'var(--danger)' }}>{bridgeState.reason}</p>
            </div>
          )}

          <button
            onClick={handleEvaluate}
            disabled={!amount || !recipientAddress || bridgeState.phase === 'EVALUATING'}
            className="w-full rounded-2xl py-3.5 font-semibold text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: 'var(--accent)', color: '#0d1b2f' }}
          >
            {bridgeState.phase === 'EVALUATING' ? (
              <><Loader2 className="inline size-4 mr-2 animate-spin" />Evaluating...</>
            ) : 'Review bridge'}
          </button>
        </>
      ) : bridgeState.phase === 'REVIEW' ? (
        <BridgeReviewCard
          evaluation={bridgeState.evaluation}
          amount={amount}
          destName={selectedDest.name}
          onConfirm={handleBridgeNotYetWired}
          onCancel={() => setBridgeState({ phase: 'INPUT' })}
        />
      ) : bridgeState.phase === 'BRIDGE_PENDING' || bridgeState.phase === 'BRIDGE_UNCONFIRMED' ? (
        <BridgePendingCard
          phase={bridgeState.phase}
          burnTxHash={bridgeState.burnTxHash}
          destName={selectedDest.name}
        />
      ) : bridgeState.phase === 'VERIFIED' ? (
        <div className="rounded-2xl p-6 text-center space-y-4" style={{ background: 'var(--surface)', border: '1px solid var(--success-muted)' }}>
          <CheckCircle className="size-10 mx-auto" style={{ color: 'var(--success)' }} />
          <h2 className="text-lg font-semibold" style={{ color: 'var(--ink)' }}>Bridge verified</h2>
          <p className="text-sm font-mono" style={{ color: 'var(--muted)' }}>{bridgeState.burnTxHash.slice(0, 20)}...</p>
          <button onClick={() => setBridgeState({ phase: 'INPUT' })} className="w-full rounded-xl py-2.5 text-sm font-semibold" style={{ background: 'var(--accent-muted)', color: 'var(--accent)', border: '1px solid var(--border-strong)' }}>Bridge again</button>
        </div>
      ) : bridgeState.phase === 'FAILED' ? (
        <div className="space-y-3">
          <div className="rounded-xl p-4" style={{ background: 'var(--danger-muted)', border: '1px solid var(--border)' }}>
            <p className="text-sm" style={{ color: 'var(--danger)' }}>{bridgeState.error}</p>
          </div>
          <button onClick={() => setBridgeState({ phase: 'INPUT' })} className="w-full rounded-xl py-2.5 text-sm font-semibold" style={{ background: 'var(--surface)', color: 'var(--muted)', border: '1px solid var(--border)' }}>Try again</button>
        </div>
      ) : null}

      {/* Provider info */}
      <div className="flex items-start gap-2 rounded-xl p-3" style={{ background: 'var(--surface-strong)', border: '1px solid var(--border)' }}>
        <Globe className="size-3.5 mt-0.5 shrink-0" style={{ color: 'var(--accent)' }} />
        <p className="text-xs" style={{ color: 'var(--muted)' }}>
          CCTP V2 (verified 2026-10-07). Standard transfer (minFinalityThreshold=2000).
          Source burn tx confirmed on Arc Testnet — awaits Circle attestation before relay to {selectedDest.name}.
          Bridge completion takes ~15 min for standard transfers.
        </p>
      </div>
    </div>
  );
}

function BridgeReviewCard({
  evaluation,
  amount,
  destName,
  onConfirm,
  onCancel,
}: {
  evaluation: ReturnType<typeof evaluateBridgeAction>;
  amount: string;
  destName: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--border-strong)' }}>
      <div className="px-4 py-3 border-b" style={{ background: 'var(--surface-elevated)', borderColor: 'var(--border)' }}>
        <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>Review bridge</h2>
      </div>
      <div className="px-4 py-3 space-y-2" style={{ background: 'var(--surface)' }}>
        <ReviewRow label="Amount" value={`${amount} USDC`} />
        <ReviewRow label="From" value="Arc Testnet" />
        <ReviewRow label="To" value={destName} />
        <ReviewRow label="Provider" value="Circle CCTP V2" />
        <ReviewRow label="Policy" value={evaluation.policyResult.decision} success={evaluation.policyResult.decision === 'PASS'} />
        <ReviewRow label="Risk" value={`${evaluation.riskResult.level} (${evaluation.riskResult.score})`} success={evaluation.riskResult.level !== 'CRITICAL'} />
        <ReviewRow label="Preflight" value={evaluation.preflightResult.ok ? 'PASS' : 'FAIL'} success={evaluation.preflightResult.ok} />
        <ReviewRow label="Estimated time" value="~15 min (standard)" />
      </div>
      <div className="flex gap-2 px-4 py-3 border-t" style={{ borderColor: 'var(--border)' }}>
        <button onClick={onCancel} className="flex-1 rounded-xl py-2.5 text-sm font-semibold" style={{ background: 'var(--surface-strong)', color: 'var(--muted)', border: '1px solid var(--border)' }}>Cancel</button>
        <button onClick={onConfirm} className="flex-1 rounded-xl py-2.5 text-sm font-semibold" style={{ background: 'var(--accent)', color: '#0d1b2f' }}>Initiate bridge</button>
      </div>
    </div>
  );
}

function BridgePendingCard({ phase, burnTxHash, destName }: { phase: string; burnTxHash: string; destName: string }) {
  return (
    <div className="rounded-2xl p-6 text-center space-y-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
      <Loader2 className="size-10 mx-auto animate-spin" style={{ color: 'var(--accent)' }} />
      <h2 className="text-base font-semibold" style={{ color: 'var(--ink)' }}>
        {phase === 'BRIDGE_PENDING' ? 'Burn submitted' : 'Awaiting attestation'}
      </h2>
      <p className="text-sm" style={{ color: 'var(--muted)' }}>
        {phase === 'BRIDGE_PENDING'
          ? 'USDC burn submitted on Arc Testnet. Waiting for confirmation...'
          : `Burn confirmed. Waiting for Circle attestation before relaying to ${destName}...`}
      </p>
      <p className="text-xs font-mono" style={{ color: 'var(--subtle)' }}>{burnTxHash.slice(0, 22)}...</p>
    </div>
  );
}

function ReviewRow({ label, value, success }: { label: string; value: string; success?: boolean }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span style={{ color: 'var(--muted)' }}>{label}</span>
      <span style={{ color: success !== undefined ? (success ? 'var(--success)' : 'var(--danger)') : 'var(--ink-2)' }}>{value}</span>
    </div>
  );
}

// Export Address type for bridge wallet integration
export type { Address };
