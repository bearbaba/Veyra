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

import { useEffect, useState } from 'react';
import { useAccount } from 'wagmi';
import { Globe, AlertTriangle, Info, ArrowRight, Loader2, CheckCircle, Lock } from 'lucide-react';
import { parseUnits, type Address } from 'viem';
import {
  createBridgeActionFromRoute,
  evaluateBridgeAction,
} from '../../core/pipeline/bridgePipeline';
import { selectBridgeRoutes } from '../../core/router/routeEngine';
import { cctpV2BridgeProvider } from '../../providers/cctp/cctpBridgeProvider';
import type { PreflightResult } from '../../providers/bridge/bridgeProviderTypes';
import {
  createBridgeActivityReceiptRemote,
} from '../../lib/api/activityReceiptApi';
import { MANIFEST_CONSTANTS, findManifestEntry } from '../../providers/registry/providerManifest';
import { useBridgeExecution, type BridgeExecutionState } from '../../hooks/useBridgeExecution';
import {
  nextBridgeResumeInstruction,
  type BridgeRecoveryCheckpoint,
} from '../../core/execution/bridgeCheckpointStore';

// ── Lifecycle check ───────────────────────────────────────────────────────────
const CCTP_ENTRY = findManifestEntry('cctp-v2-bridge');
const CCTP_LIFECYCLE_READY = CCTP_ENTRY?.lifecycleStage === 'ENABLED' && CCTP_ENTRY?.enabled === true;

type BridgeState =
  | { phase: 'INPUT' }
  | { phase: 'EVALUATING' }
  | { phase: 'BLOCKED'; reason: string }
  | {
      phase: 'REVIEW';
      evaluation: ReturnType<typeof evaluateBridgeAction>;
      providerPreflight: PreflightResult[];
      clientIntentId: string;
    }
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
  const bridgeExecution = useBridgeExecution();

  const [amount, setAmount] = useState('');
  const [destChainId, setDestChainId] = useState<number>(MANIFEST_CONSTANTS.ETH_SEPOLIA_CHAIN_ID);
  const [recipientAddress, setRecipientAddress] = useState('');
  const [bridgeState, setBridgeState] = useState<BridgeState>({ phase: 'INPUT' });
  const [recoveryCandidates, setRecoveryCandidates] = useState<BridgeRecoveryCheckpoint[]>([]);

  useEffect(() => {
    let active = true;
    if (!isConnected) {
      setRecoveryCandidates([]);
      return () => { active = false; };
    }

    void bridgeExecution.loadRecoveryCandidates()
      .then((rows) => {
        if (active) setRecoveryCandidates(rows);
      })
      .catch(() => {
        if (active) setRecoveryCandidates([]);
      });

    return () => { active = false; };
  }, [isConnected, bridgeExecution.loadRecoveryCandidates]);

  const selectedDest = DESTINATION_CHAINS.find((c) => c.id === destChainId)!;

  async function handleEvaluate() {
    if (!address || !amount || !recipientAddress) return;

    const parsed = Number.parseFloat(amount);
    if (!Number.isFinite(parsed) || parsed <= 0) return;

    setBridgeState({ phase: 'EVALUATING' });

    try {
      const amountBigInt = parseUnits(amount, 6);
      const clientIntentId = crypto.randomUUID();
      const routeSelection = await selectBridgeRoutes({
        params: {
          clientIntentId,
          senderAddress: address,
          recipientSnapshotId:
            `direct:${recipientAddress.trim().toLowerCase()}`,
          destinationAddress: recipientAddress,
          sourceChainId: MANIFEST_CONSTANTS.ARC_TESTNET_CHAIN_ID,
          destinationChainId: destChainId,
          sourceTokenAddress: MANIFEST_CONSTANTS.ARC_TESTNET_USDC,
          amountIn: amountBigInt,
        },
        adapters: [cctpV2BridgeProvider],
        runtimeEnvironment: 'testnet',
      });

      const route = routeSelection.routes[0];
      if (!route) {
        const details = routeSelection.excludedProviders
          .map((item) => `${item.providerId}: ${item.reason}`)
          .join('; ');
        setBridgeState({
          phase: 'BLOCKED',
          reason:
            details || 'No lifecycle-enabled bridge route is available.',
        });
        return;
      }

      const providerPreflight =
        await cctpV2BridgeProvider.preflight(route);
      const hardBlock = providerPreflight.find(
        (check) => check.severity === 'HARD_BLOCK' && !check.passed,
      );
      if (hardBlock) {
        setBridgeState({
          phase: 'BLOCKED',
          reason: hardBlock.message,
        });
        return;
      }

      const action = createBridgeActionFromRoute({
        route,
        from: address,
        tokenDecimals: 6,
      });
      const evaluation = evaluateBridgeAction(action);

      if (!evaluation.canProceed) {
        setBridgeState({
          phase: 'BLOCKED',
          reason: evaluation.blockedReason ?? 'Action blocked',
        });
        return;
      }

      setBridgeState({
        phase: 'REVIEW',
        evaluation,
        providerPreflight,
        clientIntentId,
      });
    } catch (err) {
      setBridgeState({
        phase: 'FAILED',
        error: err instanceof Error ? err.message : 'Evaluation failed',
      });
    }
  }

  async function handleConfirmBridge(
    review: Extract<BridgeState, { phase: 'REVIEW' }>,
  ) {
    if (!address) return;

    setBridgeState({ phase: 'EVALUATING' });

    try {
      // Static CCTP routes still use a short freshness window. Re-quote at the
      // execution boundary and require the deterministic routeId/money fields
      // to remain identical to what the user reviewed.
      const refreshedSelection = await selectBridgeRoutes({
        params: {
          clientIntentId: review.clientIntentId,
          senderAddress: address,
          recipientSnapshotId:
            `direct:${review.evaluation.action.to.toLowerCase()}`,
          destinationAddress: review.evaluation.action.to,
          sourceChainId: review.evaluation.action.sourceChainId,
          destinationChainId: review.evaluation.action.destinationChainId,
          sourceTokenAddress: review.evaluation.action.tokenAddress,
          amountIn: review.evaluation.action.amount,
        },
        adapters: [cctpV2BridgeProvider],
        runtimeEnvironment: 'testnet',
      });
      const refreshedRoute = refreshedSelection.routes[0];
      if (
        !refreshedRoute ||
        refreshedRoute.routeId !== review.evaluation.action.actionId ||
        refreshedRoute.amountIn !== review.evaluation.action.amount ||
        refreshedRoute.destinationAddress.toLowerCase() !==
          review.evaluation.action.to.toLowerCase()
      ) {
        throw new Error(
          'Bridge route changed or expired since review. Review the route again.',
        );
      }

      const freshPreflight =
        await cctpV2BridgeProvider.preflight(refreshedRoute);
      const hardBlock = freshPreflight.find(
        (check) => check.severity === 'HARD_BLOCK' && !check.passed,
      );
      if (hardBlock) throw new Error(hardBlock.message);

      const executionAction = createBridgeActionFromRoute({
        route: refreshedRoute,
        from: address,
        tokenDecimals: review.evaluation.action.tokenDecimals,
      });
      const executionEvaluation = evaluateBridgeAction(executionAction);
      if (!executionEvaluation.canProceed) {
        throw new Error(
          executionEvaluation.blockedReason ??
            'Bridge execution is no longer policy-ready.',
        );
      }

      const activityReceipt = await createBridgeActivityReceiptRemote({
        clientIntentId: review.clientIntentId,
        routeId: executionAction.actionId,
        senderAddress: address,
        sourceChainId: executionAction.sourceChainId,
        destinationAddress: executionAction.to,
        destinationChainId: executionAction.destinationChainId,
        amountRaw: executionAction.amount.toString(),
        tokenAddress: executionAction.tokenAddress,
        policyResult: {
          decision: executionEvaluation.policyResult.decision,
          blockedBy: executionEvaluation.policyResult.blockedBy,
          confirmationRequired:
            executionEvaluation.policyResult.confirmationRequired,
        },
        preflightResults: freshPreflight,
      });

      await bridgeExecution.executeProviderRoute(
        cctpV2BridgeProvider,
        refreshedRoute,
        executionAction,
        address,
        activityReceipt,
      );
      setRecoveryCandidates(
        await bridgeExecution.loadRecoveryCandidates(),
      );
    } catch (error) {
      setBridgeState({
        phase: 'FAILED',
        error:
          error instanceof Error
            ? error.message
            : 'Could not create the durable Veyra activity receipt.',
      });
    }
  }

  async function handleResumeBridge(checkpoint: BridgeRecoveryCheckpoint) {
    await bridgeExecution.resumeProviderCheckpoint(
      cctpV2BridgeProvider,
      checkpoint,
    );
    setRecoveryCandidates(await bridgeExecution.loadRecoveryCandidates());
  }

  function handleBridgeAgain() {
    bridgeExecution.reset();
    setBridgeState({ phase: 'INPUT' });
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

      {recoveryCandidates.length > 0 && bridgeExecution.state.phase === 'IDLE' && (
        <BridgeRecoveryCard
          checkpoint={recoveryCandidates[0]}
          onResume={() => void handleResumeBridge(recoveryCandidates[0])}
        />
      )}

      {bridgeExecution.state.phase !== 'IDLE' ? (
        <BridgeExecutionCard
          state={bridgeExecution.state}
          onReset={handleBridgeAgain}
        />
      ) : bridgeState.phase === 'INPUT' || bridgeState.phase === 'EVALUATING' || bridgeState.phase === 'BLOCKED' ? (
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
            onClick={() => void handleEvaluate()}
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
          providerPreflight={bridgeState.providerPreflight}
          amount={amount}
          destName={selectedDest.name}
          onConfirm={() => void handleConfirmBridge(bridgeState)}
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
  providerPreflight,
  amount,
  destName,
  onConfirm,
  onCancel,
}: {
  evaluation: ReturnType<typeof evaluateBridgeAction>;
  providerPreflight: PreflightResult[];
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
        <ReviewRow
          label="Preflight"
          value={
            providerPreflight.every(
              (check) => check.severity !== 'HARD_BLOCK' || check.passed,
            )
              ? 'PASS'
              : 'FAIL'
          }
          success={providerPreflight.every(
            (check) => check.severity !== 'HARD_BLOCK' || check.passed,
          )}
        />
        <ReviewRow
          label="Provider checks"
          value={`${providerPreflight.filter((check) => check.passed).length}/${providerPreflight.length} passed`}
        />
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

function BridgeRecoveryCard({
  checkpoint,
  onResume,
}: {
  checkpoint: BridgeRecoveryCheckpoint;
  onResume: () => void;
}) {
  const instruction = nextBridgeResumeInstruction(checkpoint);

  return (
    <div className="rounded-2xl p-4 space-y-3" style={{ background: 'var(--surface)', border: '1px solid var(--warning)' }}>
      <div className="flex items-start gap-3">
        <AlertTriangle className="size-5 mt-0.5 shrink-0" style={{ color: 'var(--warning)' }} />
        <div className="min-w-0">
          <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>Bridge recovery available</p>
          <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
            A source burn already exists. Veyra will resume from that burn and will never submit another source burn for this recovery.
          </p>
        </div>
      </div>
      <div className="rounded-xl p-3 text-xs font-mono space-y-1" style={{ background: 'var(--surface-strong)', color: 'var(--muted)' }}>
        <div>Stage: {checkpoint.stage}</div>
        <div>Next: {instruction}</div>
        <div>Burn: {checkpoint.burnTxHash.slice(0, 18)}...</div>
      </div>
      <button
        onClick={onResume}
        className="w-full rounded-xl py-2.5 text-sm font-semibold"
        style={{ background: 'var(--accent-muted)', color: 'var(--accent)', border: '1px solid var(--border-strong)' }}
      >
        Resume safely
      </button>
    </div>
  );
}

function BridgeExecutionCard({
  state,
  onReset,
}: {
  state: BridgeExecutionState;
  onReset: () => void;
}) {
  const title: Record<BridgeExecutionState['phase'], string> = {
    IDLE: 'Ready',
    CHECKING_ALLOWANCE: 'Checking allowance',
    APPROVING: 'Approve USDC',
    APPROVE_CONFIRMED: 'Approval confirmed',
    BURNING: 'Submitting source burn',
    BRIDGE_PENDING: 'Source burn submitted',
    BRIDGE_UNCONFIRMED: 'Awaiting Circle attestation',
    SWITCHING_CHAIN: 'Preparing destination chain',
    RECEIVING: 'Receiving USDC',
    VERIFYING: 'Verifying destination balance',
    VERIFIED: 'Bridge verified',
    FAILED: 'Bridge needs attention',
  };

  const active = state.phase !== 'VERIFIED' && state.phase !== 'FAILED';

  return (
    <div className="rounded-2xl p-6 text-center space-y-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
      {state.phase === 'VERIFIED'
        ? <CheckCircle className="size-10 mx-auto" style={{ color: 'var(--success)' }} />
        : active
          ? <Loader2 className="size-10 mx-auto animate-spin" style={{ color: 'var(--accent)' }} />
          : <AlertTriangle className="size-10 mx-auto" style={{ color: 'var(--warning)' }} />}

      <h2 className="text-base font-semibold" style={{ color: 'var(--ink)' }}>{title[state.phase]}</h2>

      {state.error && (
        <p className="text-sm" style={{ color: state.phase === 'FAILED' ? 'var(--danger)' : 'var(--muted)' }}>
          {state.error}
        </p>
      )}

      {state.burnTxHash && (
        <p className="text-xs font-mono" style={{ color: 'var(--subtle)' }}>
          burn: {state.burnTxHash.slice(0, 22)}...
        </p>
      )}

      {state.receiveTxHash && (
        <p className="text-xs font-mono" style={{ color: 'var(--subtle)' }}>
          receive: {state.receiveTxHash.slice(0, 22)}...
        </p>
      )}

      {(state.phase === 'VERIFIED' || state.phase === 'FAILED') && (
        <button
          onClick={onReset}
          className="w-full rounded-xl py-2.5 text-sm font-semibold"
          style={{ background: 'var(--surface-strong)', color: 'var(--muted)', border: '1px solid var(--border)' }}
        >
          {state.phase === 'VERIFIED' ? 'Bridge again' : 'Back'}
        </button>
      )}
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
