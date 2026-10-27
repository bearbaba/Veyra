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
import { useAccount, usePublicClient, useWalletClient, useSwitchChain } from 'wagmi';
import { Globe, AlertTriangle, Info, ArrowRight, Loader2, CheckCircle, Lock } from 'lucide-react';
import { isAddress, parseUnits, type Address } from 'viem';
import {
  createBridgeActionFromRoute,
  evaluateBridgeAction,
} from '../../core/pipeline/bridgePipeline';
import { selectBridgeRoutes } from '../../core/router/routeEngine';
import { cctpV2BridgeProvider } from '../../providers/cctp/cctpBridgeProvider';
import type { PreflightResult } from '../../providers/bridge/bridgeProviderTypes';
import type { BridgeAction } from '../../core/actions/actionSchema';
import { simulateCctpSourceBurn, simulateExactCctpApproval } from '../../core/execution/cctpSourceSimulation';
import { approveTokenMessenger } from '../../providers/cctp/cctpV2Adapter';
import { assertExecutionReady } from '../../core/execution/executionReadiness';
import { IS_UI_ONLY_PREVIEW, VEYRA_ENV } from '../../lib/env';
import { useUnifiedSocial } from '../../features/social/UnifiedSocial';
import { VeyraIdentityAccess } from '../identity/VeyraIdentityAccess';
import {
  createBridgeActivityReceiptRemote, loadActivityReceiptsRemote,
  type ActivityReceiptRemoteRecord,
} from '../../lib/api/activityReceiptApi';
import { bridgeReceiptDisplayStatus, bridgeReceiptHasUnresolvedSource } from '../../core/bridge/bridgeActivityStatus';
import { formatRemoteActivityAmount } from '../../core/receipt/formatRemoteActivityAmount';
import { buildTxExplorerUrl } from '../../onchain-facts';
import { MANIFEST_CONSTANTS, findManifestEntry } from '../../providers/registry/providerManifest';
import { validateAgentBridgeDraft } from '../../core/agent/bridgeDraftGate';
import type { IntentCandidate } from '../../core/intent/intentSchema';
import { useBridgeExecution, type BridgeExecutionState } from '../../hooks/useBridgeExecution';
import { ensureWalletNetworkForSigning } from '../../core/wallet/ensureWalletNetworkForSigning';
import { bindAgentBridgeReceipt } from '../../core/agent/agentBridgeReceiptLink';
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
  | { phase: 'NETWORK_SWITCHING' }
  | { phase: 'APPROVAL_REQUIRED'; action: BridgeAction }
  | { phase: 'APPROVING_USDC' }
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
  const { address, isConnected, chainId, connector } = useAccount();
  const { data: walletClient } = useWalletClient();
  const { switchChainAsync } = useSwitchChain();
  const sourcePublicClient = usePublicClient({ chainId: MANIFEST_CONSTANTS.ARC_TESTNET_CHAIN_ID });
  const social = useUnifiedSocial();
  const bridgeExecution = useBridgeExecution();
  // A preview can display a CCTP route draft, but cannot advertise a
  // review/signing path without a trusted identity origin and wallet session.
  const bridgeOriginUnavailable = IS_UI_ONLY_PREVIEW || VEYRA_ENV === 'mainnet' ||
    social.identityOrigin === 'origin_blocked' || social.identityOrigin === 'offline';
  const bridgeIdentityReady = !bridgeOriginUnavailable && social.identityOrigin === 'ready' &&
    Boolean(social.session) && isConnected;

  const [amount, setAmount] = useState('');
  const [destChainId, setDestChainId] = useState<number>(MANIFEST_CONSTANTS.ETH_SEPOLIA_CHAIN_ID);
  const [recipientAddress, setRecipientAddress] = useState('');
  const [agentHandoff, setAgentHandoff] = useState<string | null>(null);
  const [bridgeState, setBridgeState] = useState<BridgeState>({ phase: 'INPUT' });
  const [recoveryCandidates, setRecoveryCandidates] = useState<BridgeRecoveryCheckpoint[]>([]);
  const hasUnfinishedBurn = recoveryCandidates.some((checkpoint) => checkpoint.stage !== 'VERIFIED');
  const owner = address?.toLowerCase() ?? '';
  const agentWalletKey = address ? [address.toLowerCase(), connector?.uid ?? ''].join(':') : null;
  const agentHandoffScope = social.session && agentWalletKey &&
    social.session.walletKey === agentWalletKey
    ? [agentWalletKey, social.session.profile.veyraUserId].join(':') : null;
  const sessionKey = social.session?.token ?? '';
  const [history, setHistory] = useState<{
    owner:string;token:string;records:ActivityReceiptRemoteRecord[];loading:boolean;error:string|null;
  }>({owner:'',token:'',records:[],loading:false,error:null});
  const currentHistory = owner && sessionKey && history.owner === owner && history.token === sessionKey
    ? history : null;
  const historyLoading = Boolean(sessionKey && (!currentHistory || currentHistory.loading));
  const historyError = !sessionKey || Boolean(currentHistory?.error);
  const ownBridges = (currentHistory?.records ?? []).filter(
    (r) => r.providerId === 'cctp-v2-bridge' && r.senderAddress.toLowerCase() === owner);
  const recentBridge = [...ownBridges].sort((a,b)=>
    (Date.parse(b.updatedAt)||0) - (Date.parse(a.updatedAt)||0))[0];
  const unresolvedBridge = ownBridges.find(bridgeReceiptHasUnresolvedSource);
  const newBridgeLocked = hasUnfinishedBurn || Boolean(unresolvedBridge) ||
    historyLoading || historyError;

  useEffect(()=>{
    if(!owner || !sessionKey)return;
    let active=true;
    setHistory({owner,token:sessionKey,records:[],loading:true,error:null});
    void loadActivityReceiptsRemote(100).then((records)=>{
      if(active)setHistory({owner,token:sessionKey,records,loading:false,error:null});
    }).catch(()=>{
      if(active)setHistory({owner,token:sessionKey,records:[],loading:false,
        error:'Previous Bridge activity could not be checked. New signing is paused until your history is available.'});
    });
    return ()=>{active=false;};
  },[owner,sessionKey]);

  useEffect(() => {
    // Agent proposals are read once and untrusted. Never auto-quote, approve,
    // sign or burn on navigation. The user must review the exact CCTP route.
    const raw = sessionStorage.getItem('veyra:agent-intent');
    if (!raw) return;
    sessionStorage.removeItem('veyra:agent-intent');
    try {
      const candidate = JSON.parse(raw) as IntentCandidate;
      const gate = validateAgentBridgeDraft(candidate);
      if (!gate.ok) {
        setAgentHandoff(gate.reason);
        return;
      }
      setAmount(gate.amount);
      setDestChainId(gate.destinationChainId);
      setRecipientAddress(gate.recipientAddress);
      setAgentHandoff('Draft imported from Agent. Source: Arc Testnet. Review the route and destination before signing.');
    } catch {
      setAgentHandoff('Agent draft was invalid. Enter and review the bridge details manually.');
    }
  }, []);

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

  async function selectArcForSourceSignature(expectedSender: string) {
    if (!walletClient || !walletClient.account ||
        walletClient.account.address.toLowerCase() !== expectedSender.toLowerCase()) {
      throw new Error('Your connected wallet changed. Review the sender again; nothing was submitted.');
    }
    // The wallet's real chain is authoritative. React's displayed chainId can
    // lag behind MetaMask after the user changes networks manually.
    await ensureWalletNetworkForSigning(
      () => walletClient.getChainId(),
      (requestedChainId) => switchChainAsync({ chainId: requestedChainId }),
      MANIFEST_CONSTANTS.ARC_TESTNET_CHAIN_ID,
      'Arc Testnet',
    );
    if (walletClient.account.address.toLowerCase() !== expectedSender.toLowerCase() ||
        await walletClient.getChainId() !== MANIFEST_CONSTANTS.ARC_TESTNET_CHAIN_ID) {
      throw new Error('Wallet account or network changed during selection. Nothing was signed.');
    }
  }

  async function assertNoUnresolvedSourceBurn() {
    if(!address || !social.session)
      throw new Error('Sign in to your Veyra ID before reviewing another Bridge.');
    // A fresh authenticated BFF fetch is required even if the UI list was
    // previously empty. Network/history errors cannot authorize another burn.
    const receipts = await loadActivityReceiptsRemote(100);
    if(receipts.some((r)=>r.senderAddress.toLowerCase()===address.toLowerCase() &&
          bridgeReceiptHasUnresolvedSource(r)) ||
       hasUnfinishedBurn ||
       (await bridgeExecution.loadRecoveryCandidates()).some((r)=>r.stage!=='VERIFIED')) {
      throw new Error('An earlier Bridge may still be pending. Verify the existing transaction in Activity. No new burn is permitted.');
    }
  }

  async function handleEvaluate() {
    if (!address || !amount || !recipientAddress) return;
    if (IS_UI_ONLY_PREVIEW || VEYRA_ENV === 'mainnet' ||
        social.identityOrigin !== 'ready' || !social.session) {
      setBridgeState({ phase: 'BLOCKED',
        reason: 'Bridge needs an authorized Veyra ID session and backend origin. This Preview cannot approve or burn USDC. Open an approved Testnet release.' });
      return;
    }
    if (!sourcePublicClient) {
      setBridgeState({ phase: 'BLOCKED', reason: 'Arc Testnet RPC unavailable. Bridge simulation cannot run.' });
      return;
    }

    // Match the Agent handoff requirements and reject invalid manual drafts
    // before spending RPC quota on route selection.
    if (!isAddress(recipientAddress) || !/^\d{1,18}(?:\.\d{1,6})?$/.test(amount)
      || parseUnits(amount, 6) <= 0n) {
      setBridgeState({ phase: 'BLOCKED', reason: 'Enter a valid recipient EVM wallet and a positive USDC amount (up to six decimals).' });
      return;
    }

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
      const simulation = await simulateCctpSourceBurn(sourcePublicClient, action);
      if (simulation.status === 'APPROVAL_REQUIRED') {
        setBridgeState({ phase: 'APPROVAL_REQUIRED', action });
        return;
      }
      if (simulation.status === 'BLOCKED') {
        setBridgeState({ phase: 'BLOCKED', reason: simulation.reason });
        return;
      }
      const evaluation = evaluateBridgeAction(action, simulation.proof);

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
    if (IS_UI_ONLY_PREVIEW || VEYRA_ENV === 'mainnet' ||
        social.identityOrigin !== 'ready' || !social.session || !sourcePublicClient) {
      setBridgeState({ phase: 'BLOCKED', reason: 'Bridge backend authorization and source RPC must be ready before execution.' });
      return;
    }

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
      await assertNoUnresolvedSourceBurn();
      // Only this explicit confirmation, never drafting/review, requests Arc.
      setBridgeState({ phase: 'NETWORK_SWITCHING' });
      await selectArcForSourceSignature(executionAction.from);
      setBridgeState({ phase: 'EVALUATING' });
      const simulation = await simulateCctpSourceBurn(sourcePublicClient, executionAction);
      if (simulation.status !== 'READY') {
        throw new Error(simulation.status === 'BLOCKED' ? simulation.reason
          : 'CCTP allowance changed since review. Approve again, then review a fresh route.');
      }
      const executionEvaluation = evaluateBridgeAction(executionAction, simulation.proof);
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

      // Presentation-only receipt link. The BFF's authenticated receipt, not
      // this local marker, determines whether destination mint succeeded.
      bindAgentBridgeReceipt(agentHandoffScope, activityReceipt.receiptId, {
        amountRaw:executionAction.amount.toString(),
        destinationChainId:executionAction.destinationChainId,
        recipientAddress:executionAction.to,
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

  async function handleApproveExactUsdc(
    review: Extract<BridgeState, { phase: 'APPROVAL_REQUIRED' }>,
  ) {
    const action = review.action;
    // Approval is a separate real on-chain permission. Never issue it from
    // blocked Preview, a stale wallet/session or the wrong chain.
    if (IS_UI_ONLY_PREVIEW || VEYRA_ENV === 'mainnet' ||
        social.identityOrigin !== 'ready' || !social.session ||
        !address || !walletClient || !sourcePublicClient ||
        address.toLowerCase() !== action.from.toLowerCase() ||
        walletClient.account?.address.toLowerCase() !== action.from.toLowerCase()) {
      setBridgeState({ phase: 'BLOCKED', reason: 'Cannot approve without an authorized Veyra ID, exact wallet and Arc Testnet RPC.' });
      return;
    }
    setBridgeState({ phase: 'NETWORK_SWITCHING' });
    try {
      await assertNoUnresolvedSourceBurn();
      await selectArcForSourceSignature(action.from);
      setBridgeState({ phase: 'APPROVING_USDC' });
      if (await walletClient.getChainId() !== MANIFEST_CONSTANTS.ARC_TESTNET_CHAIN_ID)
        throw new Error('Wallet chain changed before approval. No approval was submitted.');
      assertExecutionReady({
        action,providerId:'cctp-v2-bridge',providerCapability:'BRIDGE',
        assetAddress:action.tokenAddress,runtimeEnvironment:VEYRA_ENV,
      });
      const fresh=await simulateCctpSourceBurn(sourcePublicClient,action);
      if (fresh.status === 'BLOCKED') throw new Error(fresh.reason);
      if (fresh.status === 'READY') {
        await handleEvaluate();
        return;
      }
      await simulateExactCctpApproval(sourcePublicClient,action);
      // The adapter submits exactly action.amount allowance; wallet explicitly
      // signs this separate approval and the confirmation receipt is checked.
      await approveTokenMessenger(walletClient,sourcePublicClient,action);
      await handleEvaluate(); // New route, new eth_call, new policy review.
    } catch (error) {
      setBridgeState({ phase:'FAILED',
        error:error instanceof Error?error.message:'USDC approval was not confirmed. Check your wallet activity before retrying.' });
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
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-full border px-3 py-1.5 font-semibold"
            style={{borderColor:'var(--border-strong)',color:'var(--success)',background:'var(--surface)'}}>
            Arc → Sepolia / Base · Available
          </span>
          <span className="rounded-full border px-3 py-1.5"
            aria-label="Reverse bridge from Sepolia or Base to Arc coming soon, unavailable for signing"
            style={{borderColor:'var(--border)',color:'var(--muted)'}}>
            Sepolia / Base → Arc · Coming soon
          </span>
        </div>
      </div>
      {recentBridge && (
        <section aria-label="Recent verified Bridge activity" className="rounded-2xl border p-4 space-y-2"
          style={{borderColor:'var(--border-strong)',background:'var(--surface)'}}>
          <p className="text-xs font-semibold uppercase tracking-wide" style={{color:'var(--muted)'}}>
            Recent Bridge · not this draft
          </p>
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-bold" style={{
              color:bridgeReceiptDisplayStatus(recentBridge.status).success?'var(--success)':'var(--warning)'
            }}>{bridgeReceiptDisplayStatus(recentBridge.status).label}</p>
            <p className="text-sm font-semibold" style={{color:'var(--ink)'}}>
              {formatRemoteActivityAmount(recentBridge)}
            </p>
          </div>
          <p className="text-xs leading-5" style={{color:'var(--muted)'}}>
            {recentBridge.senderChainId} → {recentBridge.recipientChainId}.
            {recentBridge.status==='COMPLETE'
              ? ' Veyra reports verified destination settlement.'
              : ' Source confirmation alone is not proof that USDC arrived.'}
          </p>
          {recentBridge.burnTxHash && <a target="_blank" rel="noopener noreferrer"
            className="block break-all text-xs underline underline-offset-2" style={{color:'var(--accent)'}}
            href={buildTxExplorerUrl(recentBridge.burnChainId ?? recentBridge.senderChainId,recentBridge.burnTxHash)}>
            Source: {recentBridge.burnTxHash}</a>}
          {(recentBridge.settlementReceiveTxHash || recentBridge.receiveTxHash) &&
            <a target="_blank" rel="noopener noreferrer"
              className="block break-all text-xs underline underline-offset-2" style={{color:'var(--accent)'}}
              href={buildTxExplorerUrl(recentBridge.receiveChainId ?? recentBridge.recipientChainId,
                (recentBridge.settlementReceiveTxHash ?? recentBridge.receiveTxHash)!)}>
              Destination: {recentBridge.settlementReceiveTxHash ?? recentBridge.receiveTxHash}
            </a>}
        </section>
      )}
      {isConnected && (historyLoading || historyError) && (
        <p role="status" className="rounded-xl border p-3 text-xs leading-5"
          style={{borderColor:'var(--border)',color:'var(--warning)'}}>
          {historyLoading ? 'Checking previously submitted Bridges before allowing a new transfer…'
            : currentHistory?.error ?? 'Sign in to Veyra ID to view Bridge history and authorize a new Bridge.'}
        </p>
      )}
      {agentHandoff && (
        <p role="status" className="rounded-xl border px-3 py-3 text-xs leading-5"
          style={{ borderColor: 'var(--border-strong)', background: 'var(--surface)', color: 'var(--ink-2)' }}>
          {agentHandoff}
        </p>
      )}
      {!bridgeIdentityReady && (
        <div role="status" className="rounded-xl border px-4 py-3 text-sm leading-6"
          style={{ background:'var(--surface)', borderColor:bridgeOriginUnavailable?'var(--warning)':'var(--border)' }}>
          <p className="font-semibold" style={{color:'var(--ink)'}}>
            {bridgeOriginUnavailable ? 'Bridge signing unavailable on this Preview'
              : social.identityOrigin === 'checking' ? 'Checking the Testnet connection'
              : 'Sign in to Veyra ID before bridging'}
          </p>
          <p className="mt-1 text-xs" style={{color:'var(--muted)'}}>
            {bridgeOriginUnavailable
              ? 'This Preview is not authorized by the Veyra ID backend. You may edit the route, but cannot approve or burn here. Your draft has not been submitted.'
              : 'You can prepare the amount and destination first. Signing requires your verified wallet session on an approved Testnet domain.'}
          </p>
          {!bridgeOriginUnavailable && social.identityOrigin === 'ready' && !social.session &&
            <div className="mt-3"><VeyraIdentityAccess /></div>}
          {bridgeOriginUnavailable && (
            <a href="https://veyra-unified-testnet-v2.vercel.app"
              target="_blank" rel="noopener noreferrer"
              className="mt-2 inline-block text-xs font-semibold underline underline-offset-4"
              style={{color:'var(--accent)'}}>
              Open the stable Testnet V2 site (separate release)
            </a>
          )}
        </div>
      )}

      {hasUnfinishedBurn && bridgeExecution.state.phase === 'IDLE' && (
        <div role="status" className="rounded-xl border px-4 py-3 text-xs leading-5"
          style={{borderColor:'var(--warning)',color:'var(--ink)'}}>
          A source burn already exists for this wallet. Resume its destination receive below; do not start another burn.
        </div>
      )}
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
      ) : bridgeState.phase === 'INPUT' || bridgeState.phase === 'EVALUATING' || bridgeState.phase === 'BLOCKED' || bridgeState.phase === 'FAILED' ? (
        <>
          {/* Route */}
          <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--border-strong)' }}>
            <div className="px-4 py-3" style={{ background: 'var(--surface)' }}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs uppercase tracking-wider font-medium" style={{ color: 'var(--muted)' }}>From</span>
                <span className="text-xs font-semibold" style={{ color: 'var(--accent)' }}>Arc Testnet</span>
              </div>
              <input
                type="text"
                inputMode="decimal"
                aria-label="USDC amount to bridge"
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
                  onChange={(e) => { setDestChainId(Number(e.target.value)); setBridgeState({ phase:'INPUT' }); }}
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
                aria-label="Destination wallet address"
                autoComplete="off"
                spellCheck={false}
                value={recipientAddress}
                onChange={(e) => { setRecipientAddress(e.target.value); setBridgeState({ phase:'INPUT' }); }}
                placeholder="Recipient 0x... (destination chain)"
                className="w-full bg-transparent text-sm outline-none"
                style={{ color: 'var(--ink-2)' }}
              />
            </div>
          </div>

          {chainId !== MANIFEST_CONSTANTS.ARC_TESTNET_CHAIN_ID && (
            <p role="status" className="text-xs leading-5" style={{ color:'var(--muted)' }}>
              Prepare this route on your current network. Veyra asks your wallet
              to switch to Arc Testnet only when you approve USDC or confirm
              the Bridge. Changing the network does not sign or send money.
            </p>
          )}

          {/* Blocked */}
          {(bridgeState.phase === 'BLOCKED' || bridgeState.phase === 'FAILED') && bridgeIdentityReady && (
            <div role="alert" className="flex items-start gap-2 rounded-xl p-3.5"
              style={{ background: 'var(--danger-muted)', border: '1px solid var(--border)' }}>
              <AlertTriangle className="size-4 mt-0.5 shrink-0" style={{ color: 'var(--danger)' }} />
              <div className="min-w-0">
                <p className="text-sm leading-5" style={{ color: 'var(--danger)' }}>
                  {bridgeState.phase === 'BLOCKED' ? bridgeState.reason
                    : bridgeState.error.includes('SIMULATION_REQUIRED')
                      ? 'Bridge simulation was not accepted by the Testnet receipt service. No source burn was submitted in this review.'
                      : bridgeState.error}
                </p>
                <p className="mt-1 text-xs" style={{ color: 'var(--muted)' }}>
                  Your amount, destination network and wallet address are preserved. Review them and retry only after checking your wallet Activity for an existing transaction.
                </p>
              </div>
            </div>
          )}

          <button
            onClick={() => void handleEvaluate()}
            disabled={!amount || !recipientAddress || !isAddress(recipientAddress) ||
              !/^\d{1,18}(?:\.\d{1,6})?$/.test(amount) || Number(amount) <= 0 ||
              !bridgeIdentityReady || newBridgeLocked || bridgeState.phase === 'EVALUATING'}
            className="w-full rounded-2xl py-3.5 font-semibold text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: 'var(--accent)', color: '#0d1b2f' }}
          >
            {bridgeState.phase === 'EVALUATING' ? (
              <><Loader2 className="inline size-4 mr-2 animate-spin" />Checking route…</>
            ) : unresolvedBridge || hasUnfinishedBurn ? 'Verify previous Bridge in Activity'
              : historyLoading ? 'Checking Bridge history…'
              : historyError ? 'History unavailable'
              : bridgeOriginUnavailable ? 'Bridge unavailable on this Preview'
              : !bridgeIdentityReady ? 'Sign in to review bridge'
              : bridgeState.phase === 'FAILED' || bridgeState.phase === 'BLOCKED' ? 'Check again'
              : 'Review bridge'}
          </button>
        </>
      ) : bridgeState.phase === 'NETWORK_SWITCHING' ? (
        <div role="status" className="flex items-center gap-3 rounded-xl border p-4 text-sm"
          style={{ borderColor:'var(--border)', background:'var(--surface)', color:'var(--ink)' }}>
          <Loader2 className="size-4 shrink-0 animate-spin" />
          <span>Confirm the switch to Arc Testnet in your wallet. No payment has been signed.</span>
        </div>
      ) : bridgeState.phase === 'APPROVAL_REQUIRED' ? (
        <div className="space-y-3 rounded-2xl border p-4" style={{ borderColor:'var(--border-strong)', background:'var(--surface)' }}>
          <div className="flex items-start gap-2">
            <Info className="mt-0.5 size-4 shrink-0" style={{ color:'var(--accent)' }}/>
            <div>
              <p className="text-sm font-bold" style={{ color:'var(--ink)' }}>USDC allowance required</p>
              <p className="mt-1 text-xs leading-5" style={{ color:'var(--muted)' }}>
                Before Veyra can simulate the exact CCTP burn, authorize only {amount} USDC for Circle TokenMessengerV2 on Arc Testnet.
                This approval is a separate wallet transaction. No bridge burn will occur now.
              </p>
            </div>
          </div>
          <button type="button" onClick={() => void handleApproveExactUsdc(bridgeState)}
            disabled={newBridgeLocked}
            className="w-full rounded-xl py-3 text-sm font-bold disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background:'var(--accent)', color:'#0d1b2f' }}>
            {chainId === MANIFEST_CONSTANTS.ARC_TESTNET_CHAIN_ID
              ? `Approve exactly ${amount} USDC` : `Switch to Arc & approve ${amount} USDC`}
          </button>
          <button type="button" onClick={() => setBridgeState({phase:'INPUT'})}
            className="w-full rounded-xl border py-2 text-xs"
            style={{ borderColor:'var(--border)', color:'var(--muted)' }}>Back / edit details</button>
        </div>
      ) : bridgeState.phase === 'APPROVING_USDC' ? (
        <div role="status" className="flex items-center gap-2 rounded-xl border p-4 text-sm"
          style={{ borderColor:'var(--border)', color:'var(--muted)' }}>
          <Loader2 className="size-4 animate-spin"/> Waiting for your exact-amount USDC approval in the wallet…
        </div>
      ) : bridgeState.phase === 'REVIEW' ? (
        <BridgeReviewCard
          evaluation={bridgeState.evaluation}
          providerPreflight={bridgeState.providerPreflight}
          amount={amount}
          destName={selectedDest.name}
          onConfirm={() => void handleConfirmBridge(bridgeState)}
          sourceNetworkChangeNeeded={chainId !== MANIFEST_CONSTANTS.ARC_TESTNET_CHAIN_ID}
          disabled={!bridgeIdentityReady || newBridgeLocked}
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
      ) : null}

      {/* Provider info */}
      <div className="flex items-start gap-2 rounded-xl p-3" style={{ background: 'var(--surface-strong)', border: '1px solid var(--border)' }}>
        <Globe className="size-3.5 mt-0.5 shrink-0" style={{ color: 'var(--accent)' }} />
        <p className="text-xs" style={{ color: 'var(--muted)' }}>
          CCTP V2 (verified 2026-10-07). Standard transfer (minFinalityThreshold=2000).
          After your wallet signs a source burn, Veyra waits for Arc confirmation and Circle attestation before the destination mint on {selectedDest.name}.
          Timing depends on live network and relayer conditions; no USDC has moved just by opening this page.
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
  sourceNetworkChangeNeeded,
  disabled,
}: {
  evaluation: ReturnType<typeof evaluateBridgeAction>;
  providerPreflight: PreflightResult[];
  amount: string;
  destName: string;
  onConfirm: () => void;
  onCancel: () => void;
  sourceNetworkChangeNeeded: boolean;
  disabled: boolean;
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
        <button onClick={onConfirm} disabled={disabled}
          className="flex-1 rounded-xl py-2.5 text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed" style={{ background: 'var(--accent)', color: '#0d1b2f' }}>
          {disabled ? 'Check Bridge history first'
            : sourceNetworkChangeNeeded ? 'Switch to Arc & continue' : 'Initiate bridge'}
        </button>
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
        {checkpoint.stage === 'DESTINATION_BROADCAST'
          ? 'Verify recorded receive (no signing)' : 'Resume existing bridge'}
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
        <p className="break-all text-xs font-mono" style={{color:'var(--muted)'}}>
          Source burn: {state.burnTxHash}
        </p>
      )}
      {state.phase === 'FAILED' && state.burnTxHash && (
        <p role="alert" className="text-sm leading-6" style={{color:'var(--warning)'}}>
          Your source burn was submitted. Do not bridge again. Open recovery to continue receiving USDC from that same transaction.
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
          {state.phase === 'VERIFIED' ? 'Bridge again'
            : state.burnTxHash ? 'View existing burn recovery' : 'Edit bridge'}
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
