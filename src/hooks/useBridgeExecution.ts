/**
 * useBridgeExecution
 *
 * Drives the full CCTP V2 bridge pipeline from the browser:
 *   approve → depositForBurn → source verify → attestation poll →
 *   receiveMessage → destination verify → VeyraReceipt
 *
 * Hard invariants:
 * - All wallet calls go through wagmi WalletClient (user signs every tx)
 * - No private keys, no server-side signing
 * - Provider must be ENABLED in lifecycle before any step runs
 * - Attestation is polled via the BFF (/api/cctp/attestation)
 * - Destination verification reads final chain state before VERIFIED
 * - Receipt is only written after deterministic verification succeeds
 * - VeyraReceipt shape matches the authoritative receiptTypes.ts
 */

import { useState, useCallback, useRef } from 'react';
import { usePublicClient, useWalletClient, useSwitchChain } from 'wagmi';
import { getAddress, createPublicClient, http, type Hash, type Address } from 'viem';
import {
  approveTokenMessenger,
  broadcastDepositForBurn,
  fetchCctpAttestation,
  broadcastReceiveMessage,
  verifyCctpDestinationReceiptEvidence,
  verifyCctpSourceReceiptEvidence,
  verifyDestinationBalance,
  readBalance,
  chainIdToCctpDomain,
} from '../providers/cctp/cctpV2Adapter';
import { findManifestEntry, MANIFEST_CONSTANTS } from '../providers/registry/providerManifest';
import { checkProviderEligibility } from '../providers/registry/providerRegistry';
import type { BridgeAction } from '../core/actions/actionSchema';
import { generateExecutionReceiptId } from '../core/receipt/receiptId';
import type { VeyraReceipt } from '../core/receipt/receiptTypes';
import { VEYRA_ENV } from '../lib/env';
import { assertExecutionReady } from '../core/execution/executionReadiness';
import { saveReceipt } from '../core/receipt/receiptStore';
import {
  loadResumableBridgeCheckpoints,
  reconcileBridgeRecoveryCandidates,
  saveBridgeCheckpoint,
  type BridgeRecoveryCheckpoint,
} from '../core/execution/bridgeCheckpointStore';
import {
  loadRemoteBridgeCheckpoints,
  persistBridgeCheckpointRemote,
  relayBridgeReceiveRemote,
} from '../lib/api/bridgeRecoveryApi';
import {
  lockActionExecution,
  markActionExecutionSubmissionStarted,
  releaseActionExecutionReservation,
  reserveActionExecution,
} from '../core/execution/actionExecutionReplayStore';
import {
  advanceActivityReceiptRemote,
  loadResumableActivityReceiptsRemote,
  type ActivityReceiptHandle,
  type ActivityReceiptStatus,
} from '../lib/api/activityReceiptApi';
import type {
  ActivityTrace,
  BridgeProviderAdapter,
  BridgeProviderExecutionRuntime,
  ResumePayload,
  RouteOption,
} from '../providers/bridge/bridgeProviderTypes';

// ── Types ─────────────────────────────────────────────────────────────────────

export type BridgeExecutionPhase =
  | 'IDLE'
  | 'CHECKING_ALLOWANCE'
  | 'APPROVING'
  | 'APPROVE_CONFIRMED'
  | 'BURNING'
  | 'BRIDGE_PENDING'
  | 'BRIDGE_UNCONFIRMED'
  | 'SWITCHING_CHAIN'
  | 'RECEIVING'
  | 'VERIFYING'
  | 'VERIFIED'
  | 'FAILED';

export interface BridgeExecutionState {
  phase: BridgeExecutionPhase;
  approveTxHash?: Hash;
  burnTxHash?: Hash;
  receiveTxHash?: Hash;
  receipt?: VeyraReceipt;
  error?: string;
  attestationAttempts?: number;
}

// ── Destination chain RPC map ─────────────────────────────────────────────────

const DEST_CHAIN_RPC: Record<number, string> = {
  [MANIFEST_CONSTANTS.ETH_SEPOLIA_CHAIN_ID]: 'https://ethereum-sepolia-rpc.publicnode.com',
  [MANIFEST_CONSTANTS.BASE_SEPOLIA_CHAIN_ID]: 'https://sepolia.base.org',
};

const DEST_CHAIN_USDC: Record<number, Address> = {
  [MANIFEST_CONSTANTS.ETH_SEPOLIA_CHAIN_ID]: MANIFEST_CONSTANTS.ETH_SEPOLIA_USDC,
  [MANIFEST_CONSTANTS.BASE_SEPOLIA_CHAIN_ID]: MANIFEST_CONSTANTS.BASE_SEPOLIA_USDC,
};

// ── Attestation poll loop ─────────────────────────────────────────────────────

const ATTESTATION_POLL_INTERVAL_MS = 10_000;
const ATTESTATION_MAX_ATTEMPTS     = 90; // 15 min max

// ── ERC-20 allowance ABI ──────────────────────────────────────────────────────

const ERC20_ALLOWANCE_ABI = [{
  name: 'allowance', type: 'function', stateMutability: 'view',
  inputs: [
    { name: 'owner',   type: 'address' },
    { name: 'spender', type: 'address' },
  ],
  outputs: [{ name: '', type: 'uint256' }],
}] as const;


async function persistRecoveryCheckpoint(
  checkpoint: BridgeRecoveryCheckpoint,
): Promise<void> {
  // Local persistence is required before execution advances. The authenticated
  // Postgres mirror is best-effort and must never block a valid chain recovery.
  await saveBridgeCheckpoint(checkpoint);
  void persistBridgeCheckpointRemote(checkpoint).catch(() => undefined);
}


type RemoteRelayAttempt =
  | { mode: 'UNAVAILABLE' }
  | { mode: 'TX_HASH'; txHash: Hash }
  | { mode: 'ALREADY_RECEIVED' };

async function tryAuthenticatedRemoteRelay(
  checkpoint: BridgeRecoveryCheckpoint,
): Promise<RemoteRelayAttempt> {
  const mirrored = await persistBridgeCheckpointRemote(checkpoint);
  if (!mirrored) return { mode: 'UNAVAILABLE' };

  const result = await relayBridgeReceiveRemote(checkpoint.planId);
  if (result.mode === 'UNAVAILABLE') return result;
  if (result.mode === 'ALREADY_RECEIVED') return result;

  return {
    mode: 'TX_HASH',
    txHash: result.txHash as Hash,
  };
}

interface BridgeActivityProgress {
  handle: ActivityReceiptHandle;
  status: ActivityReceiptStatus;
}

const BRIDGE_ACTIVITY_RANK: Partial<Record<ActivityReceiptStatus, number>> = {
  INTENT_CAPTURED: 0,
  QUOTE_RESERVED: 1,
  PREFLIGHT_PASSED: 2,
  SIGNED: 3,
  BROADCAST: 4,
  SOURCE_CONFIRMED: 5,
  ATTESTATION_PENDING: 6,
  RECEIVE_FAILED_RETRYABLE: 7,
  RECEIVE_PENDING: 8,
  CONFIRMED: 9,
  COMPLETE: 10,
};

function bridgeResumePayload(planId: string): Record<string, unknown> {
  return {
    provider: 'cctp-v2-bridge',
    version: 1,
    payload: { planId },
  };
}

async function advanceBridgeActivity(
  progress: BridgeActivityProgress,
  status: ActivityReceiptStatus,
  extra: Parameters<typeof advanceActivityReceiptRemote>[2] = {},
): Promise<BridgeActivityProgress> {
  const currentRank = BRIDGE_ACTIVITY_RANK[progress.status];
  const targetRank = BRIDGE_ACTIVITY_RANK[status];

  if (
    currentRank !== undefined &&
    targetRank !== undefined &&
    currentRank > targetRank
  ) {
    return progress;
  }

  let result = await advanceActivityReceiptRemote(
    progress.handle,
    status,
    extra,
  );

  // Another browser/device may have advanced the receipt revision first.
  // Adopt the server revision; retry only when the server is still behind the
  // requested lifecycle state.
  if (result.conflict) {
    const serverRank = BRIDGE_ACTIVITY_RANK[result.status];
    if (
      serverRank !== undefined &&
      targetRank !== undefined &&
      serverRank < targetRank
    ) {
      result = await advanceActivityReceiptRemote(
        result.handle,
        status,
        extra,
      );
    }
  }

  return {
    handle: result.handle,
    status: result.status,
  };
}

interface RecoveryActivityEvidence {
  planId: string;
  burnTxHash: string;
  sourceChainId: number;
  sourceBlockNumber?: number;
  receiveTxHash?: string;
  destinationChainId: number;
  destinationBlockNumber?: number;
}

async function loadBridgeActivityProgress(
  routeId: string,
): Promise<BridgeActivityProgress | null> {
  try {
    const receipts = await loadResumableActivityReceiptsRemote();
    const receipt = receipts.find((item) => item.routeId === routeId);
    if (!receipt) return null;
    return {
      handle: {
        receiptId: receipt.receiptId,
        revision: receipt.revision,
        status: receipt.status,
      },
      status: receipt.status,
    };
  } catch {
    return null;
  }
}

async function catchUpRecoveryActivity(
  progress: BridgeActivityProgress,
  target: ActivityReceiptStatus,
  evidence: RecoveryActivityEvidence,
): Promise<BridgeActivityProgress> {
  let current = progress;

  const advance = async (
    status: ActivityReceiptStatus,
    extra: Parameters<typeof advanceActivityReceiptRemote>[2],
  ) => {
    current = await advanceBridgeActivity(current, status, extra);
  };

  if (
    current.status === 'FAILED' ||
    current.status === 'INVALIDATED' ||
    current.status === 'DUPLICATE_DETECTED' ||
    current.status === 'CANCELLED' ||
    current.status === 'COMPLETE'
  ) {
    return current;
  }

  const targetRank = BRIDGE_ACTIVITY_RANK[target];
  if (targetRank === undefined) return current;

  const rank = () => BRIDGE_ACTIVITY_RANK[current.status] ?? -1;

  if (rank() < (BRIDGE_ACTIVITY_RANK.PREFLIGHT_PASSED ?? 2)) {
    await advance('PREFLIGHT_PASSED', {});
  }
  if (rank() < (BRIDGE_ACTIVITY_RANK.SIGNED ?? 3)) {
    await advance('SIGNED', { resumable: true });
  }
  if (rank() < (BRIDGE_ACTIVITY_RANK.BROADCAST ?? 4)) {
    await advance('BROADCAST', {
      burnTxHash: evidence.burnTxHash,
      burnChainId: evidence.sourceChainId,
      resumable: true,
      resumePayload: bridgeResumePayload(evidence.planId),
    });
  }
  if (
    targetRank >= (BRIDGE_ACTIVITY_RANK.SOURCE_CONFIRMED ?? 5) &&
    rank() < (BRIDGE_ACTIVITY_RANK.SOURCE_CONFIRMED ?? 5)
  ) {
    await advance('SOURCE_CONFIRMED', {
      burnTxHash: evidence.burnTxHash,
      burnChainId: evidence.sourceChainId,
      burnBlockNumber: evidence.sourceBlockNumber,
      resumable: true,
      resumePayload: bridgeResumePayload(evidence.planId),
    });
  }
  if (
    targetRank >= (BRIDGE_ACTIVITY_RANK.ATTESTATION_PENDING ?? 6) &&
    rank() < (BRIDGE_ACTIVITY_RANK.ATTESTATION_PENDING ?? 6)
  ) {
    await advance('ATTESTATION_PENDING', {
      resumable: true,
      resumePayload: bridgeResumePayload(evidence.planId),
    });
  }

  if (
    targetRank >= (BRIDGE_ACTIVITY_RANK.RECEIVE_PENDING ?? 8) &&
    current.status === 'RECEIVE_FAILED_RETRYABLE'
  ) {
    await advance('RECEIVE_PENDING', {
      receiveTxHash: evidence.receiveTxHash,
      receiveChainId: evidence.destinationChainId,
      resumable: true,
      resumePayload: bridgeResumePayload(evidence.planId),
    });
  } else if (
    targetRank >= (BRIDGE_ACTIVITY_RANK.RECEIVE_PENDING ?? 8) &&
    rank() < (BRIDGE_ACTIVITY_RANK.RECEIVE_PENDING ?? 8)
  ) {
    await advance('RECEIVE_PENDING', {
      receiveTxHash: evidence.receiveTxHash,
      receiveChainId: evidence.destinationChainId,
      resumable: true,
      resumePayload: bridgeResumePayload(evidence.planId),
    });
  }

  if (
    targetRank >= (BRIDGE_ACTIVITY_RANK.CONFIRMED ?? 9) &&
    rank() < (BRIDGE_ACTIVITY_RANK.CONFIRMED ?? 9)
  ) {
    await advance('CONFIRMED', {
      receiveTxHash: evidence.receiveTxHash,
      receiveChainId: evidence.destinationChainId,
      receiveBlockNumber: evidence.destinationBlockNumber,
      resumable: false,
      resumePayload: null,
    });
  }

  if (target === 'COMPLETE') {
    await advance('COMPLETE', {
      resumable: false,
      resumePayload: null,
    });
  }

  return current;
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useBridgeExecution() {
  const [state, setState] = useState<BridgeExecutionState>({ phase: 'IDLE' });
  const sourcePublicClient = usePublicClient({ chainId: MANIFEST_CONSTANTS.ARC_TESTNET_CHAIN_ID });
  const { data: walletClient } = useWalletClient();
  const { switchChainAsync } = useSwitchChain();
  const abortRef = useRef(false);

  const executeBridge = useCallback(async (
    action: BridgeAction,
    walletAddress: Address,
    activityReceipt: ActivityReceiptHandle,
  ) => {
    abortRef.current = false;
    let activityProgress: BridgeActivityProgress = {
      handle: activityReceipt,
      status: activityReceipt.status ?? 'PREFLIGHT_PASSED',
    };

    // Canonical final execution boundary. This runs before allowance checks or
    // any wallet signature and revalidates the action plus provider state.
    try {
      assertExecutionReady({
        action,
        providerId: 'cctp-v2-bridge',
        providerCapability: 'BRIDGE',
        assetAddress: action.tokenAddress,
        runtimeEnvironment: VEYRA_ENV,
      });
    } catch (error) {
      setState({
        phase: 'FAILED',
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    // ── Lifecycle gate ──────────────────────────────────────────────────────
    const eligibility = checkProviderEligibility(
      'cctp-v2-bridge',
      'BRIDGE',
      action.sourceChainId,
      undefined,
      VEYRA_ENV,
    );
    if (eligibility.status !== 'ELIGIBLE') {
      const entry = findManifestEntry('cctp-v2-bridge');
      setState({
        phase: 'FAILED',
        error: `cctp-v2-bridge is not execution-eligible: ${eligibility.status} (lifecycle: ${entry?.lifecycleStage ?? 'unknown'})`,
      });
      return;
    }

    if (!walletClient || !sourcePublicClient) {
      setState({ phase: 'FAILED', error: 'Wallet not connected' });
      return;
    }

    const actionFrom = getAddress(action.from);
    const requestedWallet = getAddress(walletAddress);
    const connectedWallet = walletClient.account?.address
      ? getAddress(walletClient.account.address)
      : null;
    if (
      requestedWallet !== actionFrom ||
      !connectedWallet ||
      connectedWallet !== actionFrom
    ) {
      setState({
        phase: 'FAILED',
        error:
          'Connected wallet does not match the deterministic bridge sender.',
      });
      return;
    }

    const destRpc        = DEST_CHAIN_RPC[action.destinationChainId];
    const destUsdcAddress = DEST_CHAIN_USDC[action.destinationChainId];
    if (!destRpc || !destUsdcAddress) {
      setState({ phase: 'FAILED', error: `No destination RPC/USDC for chain ${action.destinationChainId}` });
      return;
    }

    let sourceSubmissionStarted = false;
    let actionReservationHeld = false;

    try {
      const actionReservation = await reserveActionExecution({
        actionId: action.actionId,
        providerId: 'cctp-v2-bridge',
        operation: 'BRIDGE',
      });
      if (!actionReservation.success) {
        setState({
          phase: 'FAILED',
          error:
            `Bridge action "${action.actionId}" cannot execute again: ` +
            `${actionReservation.reason}. Resume/reconcile the existing execution instead.`,
        });
        return;
      }
      actionReservationHeld = true;

      // Read-only public client for the destination chain
      const destPublicClient = createPublicClient({
        transport: http(destRpc),
        chain: {
          id: action.destinationChainId,
          name: `chain-${action.destinationChainId}`,
          nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
          rpcUrls: { default: { http: [destRpc] } },
        },
      });

      // ── Snapshot destination balance BEFORE bridge ────────────────────────
      const recipientAddress = getAddress(action.to);
      const balanceBefore    = await readBalance(destPublicClient, destUsdcAddress, recipientAddress);

      // ── Step 1: Check allowance, approve if needed ────────────────────────
      setState({ phase: 'CHECKING_ALLOWANCE' });

      const allowance = await sourcePublicClient.readContract({
        address: getAddress(action.tokenAddress),
        abi: ERC20_ALLOWANCE_ABI,
        functionName: 'allowance',
        args: [walletAddress, getAddress(MANIFEST_CONSTANTS.CCTP_V2_TOKEN_MESSENGER)],
      });

      let approveTxHash: Hash | undefined;
      if (allowance < action.amount) {
        setState({ phase: 'APPROVING' });
        approveTxHash = await approveTokenMessenger(
          walletClient,
          sourcePublicClient,
          action,
        );

        const confirmedAllowance = await sourcePublicClient.readContract({
          address: getAddress(action.tokenAddress),
          abi: ERC20_ALLOWANCE_ABI,
          functionName: 'allowance',
          args: [
            walletAddress,
            getAddress(MANIFEST_CONSTANTS.CCTP_V2_TOKEN_MESSENGER),
          ],
        });
        if (confirmedAllowance < action.amount) {
          throw new Error(
            'USDC approval confirmed but allowance is still below the reviewed bridge amount.',
          );
        }

        setState({ phase: 'APPROVE_CONFIRMED', approveTxHash });
      }

      if (abortRef.current) {
        await releaseActionExecutionReservation(action.actionId);
        actionReservationHeld = false;
        return;
      }

      // ── Step 2: depositForBurn ────────────────────────────────────────────
      // Generate immutable recovery metadata BEFORE asking the wallet to burn.
      // The adapter returns the tx hash immediately after broadcast; Veyra then
      // persists SOURCE_BROADCAST before waiting for confirmation.
      const planId = action.actionId;
      const checkpointCreatedAt = Date.now();
      const checkpointMetadata: Omit<
        BridgeRecoveryCheckpoint,
        'stage' | 'updatedAt' | 'burnTxHash'
      > = {
        planId,
        sourceChainId: action.sourceChainId,
        destinationChainId: action.destinationChainId,
        walletAddress,
        recipientAddress,
        amount: action.amount.toString(),
        tokenAddress: action.tokenAddress,
        balanceBefore: balanceBefore.toString(),
        createdAt: checkpointCreatedAt,
      };

      setState({ phase: 'BURNING', approveTxHash });

      // Lock the deterministic action against a second fresh execution before
      // opening the irreversible source-burn wallet request. If the browser
      // disappears around submission, SUBMISSION_STARTED itself is fail-closed.
      await markActionExecutionSubmissionStarted(action.actionId);
      sourceSubmissionStarted = true;
      activityProgress = await advanceBridgeActivity(
        activityProgress,
        'SIGNED',
        {
          resumable: false,
        },
      );

      const burnTxHash = await broadcastDepositForBurn(walletClient, action);
      setState({ phase: 'BRIDGE_PENDING', approveTxHash, burnTxHash });

      const checkpointBase: Omit<
        BridgeRecoveryCheckpoint,
        'stage' | 'updatedAt'
      > = {
        ...checkpointMetadata,
        burnTxHash,
      };

      // Critical crash-safety boundary: persist the broadcast hash before any
      // receipt wait. A reload while the burn is pending can now recover from
      // the exact source tx instead of offering a second burn.
      await persistRecoveryCheckpoint({
        ...checkpointBase,
        stage: 'SOURCE_BROADCAST',
        updatedAt: Date.now(),
      });

      // The original fresh-execution path is now permanently closed for this
      // actionId. All later progress uses the persisted bridge checkpoint.
      await lockActionExecution(action.actionId);

      activityProgress = await advanceBridgeActivity(
        activityProgress,
        'BROADCAST',
        {
          burnTxHash,
          burnChainId: action.sourceChainId,
          resumable: true,
          resumePayload: bridgeResumePayload(planId),
        },
      );

      if (abortRef.current) return;

      // ── Step 3: Verify source tx receipt ─────────────────────────────────
      const sourceReceipt = await sourcePublicClient.waitForTransactionReceipt({
        hash: burnTxHash,
        timeout: 60_000,
      });
      const sourceEvidence = verifyCctpSourceReceiptEvidence(sourceReceipt, {
        burnToken: getAddress(action.tokenAddress),
        amount: action.amount,
        depositor: getAddress(action.from),
        mintRecipient: getAddress(action.to),
        destinationChainId: action.destinationChainId,
      });
      if (!sourceEvidence.verified) {
        if (sourceReceipt.status !== 'success') {
          activityProgress = await advanceBridgeActivity(
            activityProgress,
            'FAILED',
            {
              burnTxHash,
              burnChainId: action.sourceChainId,
              burnBlockNumber: Number(sourceReceipt.blockNumber),
              failureReason: sourceEvidence.detail,
              resumable: false,
            },
          );
          setState({
            phase: 'FAILED',
            burnTxHash,
            error: `Source CCTP transaction failed: ${sourceEvidence.detail}`,
          });
          return;
        }

        // The source transaction succeeded, so never terminal-fail or reopen
        // fresh execution merely because the exact CCTP evidence could not be
        // established. Keep the broadcast checkpoint resumable for explicit
        // reconciliation against authoritative chain/Circle state.
        setState({
          phase: 'BRIDGE_UNCONFIRMED',
          burnTxHash,
          error:
            `Source transaction succeeded but exact CCTP evidence is unverified: ${sourceEvidence.detail}. ` +
            'The source action remains locked and must be reconciled; no second burn will be submitted.',
        });
        return;
      }
      setState({ phase: 'BRIDGE_UNCONFIRMED', approveTxHash, burnTxHash });
      await persistRecoveryCheckpoint({
        ...checkpointBase,
        stage: 'SOURCE_CONFIRMED',
        updatedAt: Date.now(),
      });

      activityProgress = await advanceBridgeActivity(
        activityProgress,
        'SOURCE_CONFIRMED',
        {
          burnTxHash,
          burnChainId: action.sourceChainId,
          burnBlockNumber: Number(sourceReceipt.blockNumber),
          resumable: true,
          resumePayload: bridgeResumePayload(planId),
        },
      );
      activityProgress = await advanceBridgeActivity(
        activityProgress,
        'ATTESTATION_PENDING',
        {
          resumable: true,
          resumePayload: bridgeResumePayload(planId),
        },
      );

      if (abortRef.current) return;

      // ── Step 4: Poll attestation (via BFF proxy) ──────────────────────────
      const sourceDomain = chainIdToCctpDomain(action.sourceChainId);
      let attestation: { message: string; attestation: string } | null = null;
      let attempts = 0;

      while (attempts < ATTESTATION_MAX_ATTEMPTS) {
        if (abortRef.current) return;
        attempts++;
        try {
          const result = await fetchCctpAttestation(sourceDomain, burnTxHash);
          if (result.status === 'complete' && result.message && result.attestation) {
            attestation = { message: result.message, attestation: result.attestation };
            break;
          }
        } catch {
          // Non-fatal — keep polling
        }
        setState((prev) => ({ ...prev, attestationAttempts: attempts }));
        await new Promise<void>((r) => setTimeout(r, ATTESTATION_POLL_INTERVAL_MS));
      }

      if (!attestation) {
        setState({
          phase: 'BRIDGE_UNCONFIRMED',
          burnTxHash,
          error: `Attestation did not complete after ${ATTESTATION_MAX_ATTEMPTS} attempts. Bridge remains resumable from the persisted source burn.`,
        });
        return;
      }

      const attestationCheckpoint: BridgeRecoveryCheckpoint = {
        ...checkpointBase,
        stage: 'ATTESTATION_READY',
        attestationMessage: attestation.message,
        attestationSignature: attestation.attestation,
        updatedAt: Date.now(),
      };
      await persistRecoveryCheckpoint(attestationCheckpoint);
      activityProgress = await advanceBridgeActivity(
        activityProgress,
        'ATTESTATION_PENDING',
        {
          resumable: true,
          resumePayload: bridgeResumePayload(planId),
        },
      );

      if (abortRef.current) return;

      let receiveTxHash: Hash;
      let destinationReceipt;

      const remoteRelay = await tryAuthenticatedRemoteRelay(attestationCheckpoint);
      if (remoteRelay.mode === 'ALREADY_RECEIVED') {
        setState({
          phase: 'BRIDGE_UNCONFIRMED',
          burnTxHash,
          error:
            'CCTP destination message is already consumed, but the destination transaction hash is not yet reconciled. No new burn or receive will be submitted.',
        });
        return;
      }

      if (remoteRelay.mode === 'TX_HASH') {
        receiveTxHash = remoteRelay.txHash;
        setState({
          phase: 'RECEIVING',
          approveTxHash,
          burnTxHash,
          receiveTxHash,
        });
      } else {
        // Relay is unavailable (for example no authenticated session or no
        // testnet relay signer). Fall back to the user's destination wallet.
        setState({ phase: 'SWITCHING_CHAIN', approveTxHash, burnTxHash });
        try {
          await switchChainAsync({ chainId: action.destinationChainId });
        } catch {
          activityProgress = await advanceBridgeActivity(
            activityProgress,
            'RECEIVE_FAILED_RETRYABLE',
            {
              resumable: true,
              resumePayload: bridgeResumePayload(planId),
              failureReason: 'Destination chain switch failed.',
            },
          );
          setState({
            phase: 'FAILED',
            burnTxHash,
            error:
              `Could not switch to destination chain ${action.destinationChainId}. Bridge remains resumable from the persisted source burn.`,
          });
          return;
        }

        const connected = walletClient.account?.address;
        if (
          !connected ||
          connected.toLowerCase() !== recipientAddress.toLowerCase()
        ) {
          activityProgress = await advanceBridgeActivity(
            activityProgress,
            'RECEIVE_FAILED_RETRYABLE',
            {
              resumable: true,
              resumePayload: bridgeResumePayload(planId),
              failureReason:
                'Destination recipient wallet is not connected for self-relay.',
            },
          );
          setState({
            phase: 'FAILED',
            burnTxHash,
            error:
              `Connect the destination recipient wallet ${recipientAddress} to complete receiveMessage safely.`,
          });
          return;
        }

        setState({ phase: 'RECEIVING', approveTxHash, burnTxHash });
        receiveTxHash = await broadcastReceiveMessage(
          walletClient,
          action.destinationChainId,
          recipientAddress,
          attestation.message,
          attestation.attestation,
        );
      }

      // Persist the destination tx hash before waiting for confirmation. This
      // prevents a reload from submitting receiveMessage again just because the
      // original destination transaction was still pending.
      await persistRecoveryCheckpoint({
        ...checkpointBase,
        stage: 'DESTINATION_BROADCAST',
        attestationMessage: attestation.message,
        attestationSignature: attestation.attestation,
        receiveTxHash,
        updatedAt: Date.now(),
      });

      activityProgress = await advanceBridgeActivity(
        activityProgress,
        'RECEIVE_PENDING',
        {
          receiveTxHash,
          receiveChainId: action.destinationChainId,
          resumable: true,
          resumePayload: bridgeResumePayload(planId),
        },
      );

      if (abortRef.current) return;

      destinationReceipt = await destPublicClient.waitForTransactionReceipt({
        hash: receiveTxHash,
        timeout: 60_000,
      });
      const destinationEvidence = verifyCctpDestinationReceiptEvidence(
        destinationReceipt,
        recipientAddress,
        destUsdcAddress,
        action.amount,
      );
      if (!destinationEvidence.verified) {
        activityProgress = await advanceBridgeActivity(
          activityProgress,
          'RECEIVE_FAILED_RETRYABLE',
          {
            receiveTxHash,
            receiveChainId: action.destinationChainId,
            failureReason: destinationEvidence.detail,
            resumable: true,
            resumePayload: bridgeResumePayload(planId),
          },
        );
        setState({
          phase: 'FAILED',
          burnTxHash,
          receiveTxHash,
          error:
            `Destination CCTP receipt verification failed: ${destinationEvidence.detail}`,
        });
        return;
      }

      // ── Step 6: Verify destination balance delta ──────────────────────────
      setState({ phase: 'VERIFYING', approveTxHash, burnTxHash, receiveTxHash });

      const verification = await verifyDestinationBalance(
        destPublicClient,
        recipientAddress,
        destUsdcAddress,
        action.amount,
        balanceBefore,
      );

      if (!verification.verified) {
        activityProgress = await advanceBridgeActivity(
          activityProgress,
          'RECEIVE_FAILED_RETRYABLE',
          {
            receiveTxHash,
            receiveChainId: action.destinationChainId,
            receiveBlockNumber: Number(destinationReceipt.blockNumber),
            failureReason: verification.detail,
            resumable: true,
            resumePayload: bridgeResumePayload(planId),
          },
        );
        setState({
          phase: 'FAILED',
          burnTxHash,
          receiveTxHash,
          error: `Destination balance verification failed: ${verification.detail}`,
        });
        return;
      }

      // ── Step 7: Generate VeyraReceipt ─────────────────────────────────────
      const sourceReceiptObj = await sourcePublicClient.getTransactionReceipt({ hash: burnTxHash });
      const destReceiptObj = destinationReceipt;
      const receiptId = generateExecutionReceiptId(action.sourceChainId, burnTxHash);

      const veyraReceipt: VeyraReceipt = {
        receiptId,
        planId,
        actionType:           'BRIDGE',
        status:               'VERIFIED',
        chainId:              action.sourceChainId,
        executionTxHash:      burnTxHash,
        executionBlock:       Number(sourceReceiptObj.blockNumber),
        createdAt:            action.createdAt,
        completedAt:          Date.now(),
        actualAmountDelta:    verification.actualDelta,
        expectedAmountDelta:  action.amount,
        verifiedBalanceAfter: balanceBefore + verification.actualDelta,
        riskScore:            null,
        policyDecision:       null,
        bridgeTrace: {
          sourceChainId:        action.sourceChainId,
          destinationChainId:   action.destinationChainId,
          sourceTxHash:         burnTxHash,
          destinationTxHash:    receiveTxHash,
          sourceBlock:          Number(sourceReceiptObj.blockNumber),
          destinationBlock:     Number(destReceiptObj.blockNumber),
          bridgeStatus:         'VERIFIED',
        },
      };

      await saveReceipt(veyraReceipt);
      await persistRecoveryCheckpoint({
        ...checkpointBase,
        stage: 'VERIFIED',
        attestationMessage: attestation.message,
        attestationSignature: attestation.attestation,
        receiveTxHash,
        updatedAt: Date.now(),
      });

      activityProgress = await advanceBridgeActivity(
        activityProgress,
        'CONFIRMED',
        {
          receiveTxHash,
          receiveChainId: action.destinationChainId,
          receiveBlockNumber: Number(destReceiptObj.blockNumber),
          resumable: false,
          resumePayload: null,
        },
      );
      activityProgress = await advanceBridgeActivity(
        activityProgress,
        'COMPLETE',
        {
          resumable: false,
          resumePayload: null,
        },
      );

      setState({
        phase: 'VERIFIED',
        approveTxHash,
        burnTxHash,
        receiveTxHash,
        receipt: veyraReceipt,
      });



    } catch (err) {
      if (actionReservationHeld && !sourceSubmissionStarted) {
        try {
          await releaseActionExecutionReservation(action.actionId);
        } catch {
          // Preserve the original error. A failed release remains fail-closed.
        }

        try {
          activityProgress = await advanceBridgeActivity(
            activityProgress,
            'FAILED',
            {
              failureReason:
                err instanceof Error ? err.message : 'Bridge execution failed',
              resumable: false,
            },
          );
        } catch {
          // Preserve the original execution error.
        }
      }

      setState((prev) => ({
        ...prev,
        phase: 'FAILED',
        error: err instanceof Error ? err.message : 'Bridge execution failed',
      }));
    }
  }, [walletClient, sourcePublicClient, switchChainAsync]);

  const executeProviderRoute = useCallback(async (
    adapter: BridgeProviderAdapter,
    route: RouteOption,
    action: BridgeAction,
    walletAddress: Address,
    activityReceipt: ActivityReceiptHandle,
  ) => {
    if (
      action.actionId !== route.routeId ||
      action.providerId !== route.provider ||
      action.sourceChainId !== route.sourceChainId ||
      action.destinationChainId !== route.destinationChainId ||
      action.tokenAddress.toLowerCase() !==
        route.sourceTokenAddress.toLowerCase() ||
      action.amount !== route.amountIn ||
      action.to.toLowerCase() !== route.destinationAddress.toLowerCase()
    ) {
      throw new Error(
        '[bridgeExecution] Provider route is not bound to the deterministic BridgeAction.',
      );
    }

    const runtime: BridgeProviderExecutionRuntime = {
      providerId: adapter.providerId,
      execute: async (
        runtimeRoute: RouteOption,
        onProgress: (trace: ActivityTrace) => void,
      ) => {
        if (runtimeRoute.routeId !== route.routeId) {
          throw new Error(
            '[bridgeExecution] Provider runtime route changed after review.',
          );
        }
        onProgress({
          step: 'EXECUTION_BOUNDARY',
          timestamp: Date.now(),
          data: { routeId: route.routeId },
        });
        await executeBridge(action, walletAddress, activityReceipt);
      },
      resume: (
        _resumePayload: ResumePayload,
        _onProgress: (trace: ActivityTrace) => void,
      ) =>
        Promise.reject(
          new Error(
            '[bridgeExecution] Fresh execution runtime cannot resume a bridge.',
          ),
        ),
    };

    await adapter.execute(route, runtime, () => undefined);
  }, [executeBridge]);

  const resumeBridge = useCallback(async (
    checkpoint: BridgeRecoveryCheckpoint,
  ) => {
    abortRef.current = false;

    if (!walletClient || !sourcePublicClient) {
      setState({ phase: 'FAILED', error: 'Wallet not connected' });
      return;
    }

    if (checkpoint.sourceChainId !== MANIFEST_CONSTANTS.ARC_TESTNET_CHAIN_ID) {
      setState({
        phase: 'FAILED',
        error: `Unsupported recovery source chain ${checkpoint.sourceChainId}`,
      });
      return;
    }

    if (
      checkpoint.tokenAddress.toLowerCase() !==
      MANIFEST_CONSTANTS.ARC_TESTNET_USDC.toLowerCase()
    ) {
      setState({
        phase: 'FAILED',
        error: 'Recovery checkpoint token does not match Arc Testnet USDC.',
      });
      return;
    }

    const destRpc = DEST_CHAIN_RPC[checkpoint.destinationChainId];
    const destUsdcAddress = DEST_CHAIN_USDC[checkpoint.destinationChainId];
    if (!destRpc || !destUsdcAddress) {
      setState({
        phase: 'FAILED',
        error: `No destination RPC/USDC for chain ${checkpoint.destinationChainId}`,
      });
      return;
    }

    const burnTxHash = checkpoint.burnTxHash as Hash;
    const recipientAddress = getAddress(checkpoint.recipientAddress);
    const amount = BigInt(checkpoint.amount);
    const balanceBefore = BigInt(checkpoint.balanceBefore);
    let recoveryActivity = await loadBridgeActivityProgress(checkpoint.planId);

    if (amount <= 0n || balanceBefore < 0n) {
      setState({ phase: 'FAILED', error: 'Invalid recovery amount metadata.' });
      return;
    }

    const destPublicClient = createPublicClient({
      transport: http(destRpc),
      chain: {
        id: checkpoint.destinationChainId,
        name: `chain-${checkpoint.destinationChainId}`,
        nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
        rpcUrls: { default: { http: [destRpc] } },
      },
    });

    try {
      let current = checkpoint;

      // Every recovery source, including the authenticated server mirror, is
      // re-grounded in source-chain state before Veyra trusts any later stage.
      setState({
        phase: current.stage === 'SOURCE_BROADCAST'
          ? 'BRIDGE_PENDING'
          : 'BRIDGE_UNCONFIRMED',
        burnTxHash,
      });

      let sourceReceipt;
      try {
        sourceReceipt = await sourcePublicClient.getTransactionReceipt({
          hash: burnTxHash,
        });
      } catch {
        setState({
          phase: 'BRIDGE_PENDING',
          burnTxHash,
          error: 'Source burn is still pending or not yet indexed. Retry recovery later.',
        });
        return;
      }

      const sourceEvidence = verifyCctpSourceReceiptEvidence(sourceReceipt, {
        burnToken: getAddress(current.tokenAddress),
        amount: BigInt(current.amount),
        depositor: getAddress(current.walletAddress),
        mintRecipient: getAddress(current.recipientAddress),
        destinationChainId: current.destinationChainId,
      });
      if (!sourceEvidence.verified) {
        setState({
          phase: sourceReceipt.status === 'success'
            ? 'BRIDGE_UNCONFIRMED'
            : 'FAILED',
          burnTxHash,
          error:
            sourceReceipt.status === 'success'
              ? `Persisted source transaction succeeded but exact CCTP evidence remains unverified: ${sourceEvidence.detail}. No replay will be attempted.`
              : `Persisted source burn failed CCTP verification: ${sourceEvidence.detail}`,
        });
        return;
      }

      if (current.stage === 'SOURCE_BROADCAST') {
        current = {
          ...current,
          stage: 'SOURCE_CONFIRMED',
          updatedAt: Date.now(),
        };
        await persistRecoveryCheckpoint(current);
      }

      if (recoveryActivity) {
        try {
          recoveryActivity = await catchUpRecoveryActivity(
            recoveryActivity,
            'SOURCE_CONFIRMED',
            {
              planId: current.planId,
              burnTxHash,
              sourceChainId: current.sourceChainId,
              sourceBlockNumber: Number(sourceReceipt.blockNumber),
              destinationChainId: current.destinationChainId,
            },
          );
        } catch {
          // Never strand already-submitted funds because Activity persistence
          // is temporarily unavailable. Chain/checkpoint recovery remains live.
        }
      }

      const sourceDomain = chainIdToCctpDomain(current.sourceChainId);

      if (current.stage === 'SOURCE_CONFIRMED') {
        setState({ phase: 'BRIDGE_UNCONFIRMED', burnTxHash });

        if (recoveryActivity) {
          try {
            recoveryActivity = await catchUpRecoveryActivity(
              recoveryActivity,
              'ATTESTATION_PENDING',
              {
                planId: current.planId,
                burnTxHash,
                sourceChainId: current.sourceChainId,
                sourceBlockNumber: Number(sourceReceipt.blockNumber),
                destinationChainId: current.destinationChainId,
              },
            );
          } catch {
            // Activity mirror is additive during recovery.
          }
        }

        let attestation: { message: string; attestation: string } | null = null;
        let attempts = 0;

        while (attempts < ATTESTATION_MAX_ATTEMPTS) {
          if (abortRef.current) return;
          attempts++;
          try {
            const result = await fetchCctpAttestation(sourceDomain, burnTxHash);
            if (result.status === 'complete' && result.message && result.attestation) {
              attestation = {
                message: result.message,
                attestation: result.attestation,
              };
              break;
            }
          } catch {
            // Transient attestation error — checkpoint remains resumable.
          }

          setState((prev) => ({ ...prev, attestationAttempts: attempts }));
          await new Promise<void>((resolve) =>
            setTimeout(resolve, ATTESTATION_POLL_INTERVAL_MS),
          );
        }

        if (!attestation) {
          setState({
            phase: 'BRIDGE_UNCONFIRMED',
            burnTxHash,
            error: 'Attestation is not ready yet. The persisted source burn remains resumable.',
          });
          return;
        }

        current = {
          ...current,
          stage: 'ATTESTATION_READY',
          attestationMessage: attestation.message,
          attestationSignature: attestation.attestation,
          updatedAt: Date.now(),
        };
        await persistRecoveryCheckpoint(current);
      }

      // A persisted/server-restored attestation is never trusted by itself.
      // Re-fetch Circle's attestation for the immutable source burn and require
      // an exact match before any destination-chain signature.
      if (
        current.stage === 'ATTESTATION_READY' ||
        current.stage === 'DESTINATION_BROADCAST'
      ) {
        if (!current.attestationMessage || !current.attestationSignature) {
          throw new Error('Recovery checkpoint is missing attestation data.');
        }

        const authoritative = await fetchCctpAttestation(sourceDomain, burnTxHash);
        if (
          authoritative.status !== 'complete' ||
          !authoritative.message ||
          !authoritative.attestation
        ) {
          setState({
            phase: 'BRIDGE_UNCONFIRMED',
            burnTxHash,
            error: 'Circle attestation could not be revalidated. Recovery remains paused.',
          });
          return;
        }

        if (
          authoritative.message !== current.attestationMessage ||
          authoritative.attestation !== current.attestationSignature
        ) {
          throw new Error(
            'Persisted attestation does not match Circle attestation for the source burn.',
          );
        }
      }

      if (current.stage === 'ATTESTATION_READY') {
        let receiveTxHash: Hash;
        const remoteRelay = await tryAuthenticatedRemoteRelay(current);

        if (remoteRelay.mode === 'ALREADY_RECEIVED') {
          setState({
            phase: 'VERIFYING',
            burnTxHash,
            error:
              'CCTP destination message is already consumed, but its transaction hash still needs reconciliation. No duplicate receive will be submitted.',
          });
          return;
        }

        if (remoteRelay.mode === 'TX_HASH') {
          receiveTxHash = remoteRelay.txHash;
          setState({
            phase: 'RECEIVING',
            burnTxHash,
            receiveTxHash,
          });
        } else {
          const connected = walletClient.account?.address;
          if (
            !connected ||
            connected.toLowerCase() !== recipientAddress.toLowerCase()
          ) {
            setState({
              phase: 'FAILED',
              burnTxHash,
              error:
                `Connect the destination recipient wallet ${recipientAddress} to resume receiveMessage safely.`,
            });
            return;
          }

          setState({ phase: 'SWITCHING_CHAIN', burnTxHash });
          await switchChainAsync({ chainId: current.destinationChainId });

          setState({ phase: 'RECEIVING', burnTxHash });
          receiveTxHash = await broadcastReceiveMessage(
            walletClient,
            current.destinationChainId,
            recipientAddress,
            current.attestationMessage!,
            current.attestationSignature!,
          );
        }

        // Persist before any confirmation/read. If the page disappears now,
        // recovery resumes by verifying this exact destination tx.
        current = {
          ...current,
          stage: 'DESTINATION_BROADCAST',
          receiveTxHash,
          updatedAt: Date.now(),
        };
        await persistRecoveryCheckpoint(current);

        if (recoveryActivity) {
          try {
            recoveryActivity = await catchUpRecoveryActivity(
              recoveryActivity,
              'RECEIVE_PENDING',
              {
                planId: current.planId,
                burnTxHash,
                sourceChainId: current.sourceChainId,
                sourceBlockNumber: Number(sourceReceipt.blockNumber),
                receiveTxHash,
                destinationChainId: current.destinationChainId,
              },
            );
          } catch {
            // Activity mirror is additive during recovery.
          }
        }
      }

      if (current.stage === 'DESTINATION_BROADCAST') {
        if (!current.receiveTxHash) {
          throw new Error('Recovery checkpoint is missing destination transaction hash.');
        }

        const receiveTxHash = current.receiveTxHash as Hash;

        if (recoveryActivity) {
          try {
            recoveryActivity = await catchUpRecoveryActivity(
              recoveryActivity,
              'RECEIVE_PENDING',
              {
                planId: current.planId,
                burnTxHash,
                sourceChainId: current.sourceChainId,
                sourceBlockNumber: Number(sourceReceipt.blockNumber),
                receiveTxHash,
                destinationChainId: current.destinationChainId,
              },
            );
          } catch {
            // Activity mirror is additive during recovery.
          }
        }

        let destReceiptObj;
        try {
          destReceiptObj = await destPublicClient.getTransactionReceipt({
            hash: receiveTxHash,
          });
        } catch {
          setState({
            phase: 'VERIFYING',
            burnTxHash,
            receiveTxHash,
            error: 'Destination transaction is not indexed yet. Retry verification later.',
          });
          return;
        }

        const destinationEvidence = verifyCctpDestinationReceiptEvidence(
          destReceiptObj,
          recipientAddress,
          destUsdcAddress,
          amount,
        );
        if (!destinationEvidence.verified) {
          if (recoveryActivity) {
            try {
              recoveryActivity = await advanceBridgeActivity(
                recoveryActivity,
                'RECEIVE_FAILED_RETRYABLE',
                {
                  receiveTxHash,
                  receiveChainId: current.destinationChainId,
                  failureReason: destinationEvidence.detail,
                  resumable: true,
                  resumePayload: bridgeResumePayload(current.planId),
                },
              );
            } catch {
              // Recovery remains checkpoint-driven.
            }
          }

          setState({
            phase: 'FAILED',
            burnTxHash,
            receiveTxHash,
            error:
              `Persisted destination transaction failed CCTP verification: ${destinationEvidence.detail}`,
          });
          return;
        }

        setState({
          phase: 'VERIFYING',
          burnTxHash,
          receiveTxHash,
        });

        const verification = await verifyDestinationBalance(
          destPublicClient,
          recipientAddress,
          destUsdcAddress,
          amount,
          balanceBefore,
        );

        if (!verification.verified) {
          if (recoveryActivity) {
            try {
              recoveryActivity = await advanceBridgeActivity(
                recoveryActivity,
                'RECEIVE_FAILED_RETRYABLE',
                {
                  receiveTxHash,
                  receiveChainId: current.destinationChainId,
                  receiveBlockNumber: Number(destReceiptObj.blockNumber),
                  failureReason: verification.detail,
                  resumable: true,
                  resumePayload: bridgeResumePayload(current.planId),
                },
              );
            } catch {
              // Recovery remains checkpoint-driven.
            }
          }

          setState({
            phase: 'FAILED',
            burnTxHash,
            receiveTxHash,
            error: `Destination verification is not complete: ${verification.detail}. Checkpoint remains resumable.`,
          });
          return;
        }

        const receiptId = generateExecutionReceiptId(
          current.sourceChainId,
          burnTxHash,
        );

        const receipt: VeyraReceipt = {
          receiptId,
          planId: current.planId,
          actionType: 'BRIDGE',
          status: 'VERIFIED',
          chainId: current.sourceChainId,
          executionTxHash: burnTxHash,
          executionBlock: Number(sourceReceipt.blockNumber),
          createdAt: current.createdAt,
          completedAt: Date.now(),
          actualAmountDelta: verification.actualDelta,
          expectedAmountDelta: amount,
          verifiedBalanceAfter: balanceBefore + verification.actualDelta,
          riskScore: null,
          policyDecision: null,
          bridgeTrace: {
            sourceChainId: current.sourceChainId,
            destinationChainId: current.destinationChainId,
            sourceTxHash: burnTxHash,
            destinationTxHash: receiveTxHash,
            sourceBlock: Number(sourceReceipt.blockNumber),
            destinationBlock: Number(destReceiptObj.blockNumber),
            bridgeStatus: 'VERIFIED',
          },
        };

        await saveReceipt(receipt);
        current = {
          ...current,
          stage: 'VERIFIED',
          updatedAt: Date.now(),
        };
        await persistRecoveryCheckpoint(current);

        if (recoveryActivity) {
          try {
            recoveryActivity = await catchUpRecoveryActivity(
              recoveryActivity,
              'COMPLETE',
              {
                planId: current.planId,
                burnTxHash,
                sourceChainId: current.sourceChainId,
                sourceBlockNumber: Number(sourceReceipt.blockNumber),
                receiveTxHash,
                destinationChainId: current.destinationChainId,
                destinationBlockNumber: Number(destReceiptObj.blockNumber),
              },
            );
          } catch {
            // Receipt reconciliation can retry later; execution is already
            // authoritatively verified on-chain.
          }
        }

        setState({
          phase: 'VERIFIED',
          burnTxHash,
          receiveTxHash,
          receipt,
        });
      }
    } catch (error) {
      setState((prev) => ({
        ...prev,
        phase: 'FAILED',
        error: error instanceof Error ? error.message : 'Bridge recovery failed',
      }));
    }
  }, [walletClient, sourcePublicClient, switchChainAsync]);

  const resumeProviderCheckpoint = useCallback(async (
    adapter: BridgeProviderAdapter,
    checkpoint: BridgeRecoveryCheckpoint,
  ) => {
    const payload: ResumePayload = {
      provider: adapter.providerId,
      version: 1,
      payload: { planId: checkpoint.planId },
    };

    const runtime: BridgeProviderExecutionRuntime = {
      providerId: adapter.providerId,
      execute: (
        _routeOption: RouteOption,
        _onProgress: (trace: ActivityTrace) => void,
      ) =>
        Promise.reject(
          new Error(
            '[bridgeExecution] Recovery runtime cannot start a fresh bridge.',
          ),
        ),
      resume: async (
        runtimePayload: ResumePayload,
        onProgress: (trace: ActivityTrace) => void,
      ) => {
        if (runtimePayload.payload.planId !== checkpoint.planId) {
          throw new Error(
            '[bridgeExecution] Resume payload does not match the persisted checkpoint.',
          );
        }
        onProgress({
          step: 'RESUME_BOUNDARY',
          timestamp: Date.now(),
          data: { planId: checkpoint.planId },
        });
        await resumeBridge(checkpoint);
      },
    };

    await adapter.resume(payload, runtime, () => undefined);
  }, [resumeBridge]);

  const loadRecoveryCandidates = useCallback(async () => {
    const local = await loadResumableBridgeCheckpoints();
    let remote: BridgeRecoveryCheckpoint[] = [];

    try {
      remote = await loadRemoteBridgeCheckpoints();
    } catch {
      // Server recovery is additive. Local recovery remains available if the
      // BFF/database is offline.
    }

    const reconciled = reconcileBridgeRecoveryCandidates(local, remote);

    // Cache accepted remote-only/advanced checkpoints locally so subsequent
    // reloads do not depend on server availability.
    for (const checkpoint of reconciled) {
      await saveBridgeCheckpoint(checkpoint);
    }

    return reconciled;
  }, []);

  const reset = useCallback(() => {
    abortRef.current = true;
    setState({ phase: 'IDLE' });
  }, []);

  return {
    state,
    executeBridge,
    executeProviderRoute,
    resumeBridge,
    resumeProviderCheckpoint,
    loadRecoveryCandidates,
    reset,
  };
}
