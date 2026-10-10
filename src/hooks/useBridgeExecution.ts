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
  verifyCctpSourceTransactionBinding,
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
import { saveReceiptWithRemoteSync } from '../core/receipt/receiptSync';
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
  try {
    const mirrored = await persistBridgeCheckpointRemote(checkpoint);
    if (!mirrored) return { mode: 'UNAVAILABLE' };

    const result = await relayBridgeReceiveRemote(checkpoint.planId);
    if (result.mode === 'UNAVAILABLE') return result;
    if (result.mode === 'ALREADY_RECEIVED') return result;

    return {
      mode: 'TX_HASH',
      txHash: result.txHash as Hash,
    };
  } catch {
    // Remote durability/relay is an optimization for the user experience.
    // The locally checkpointed user-signed recovery path remains authoritative
    // and safe, so transient BFF/DB/network failures fall back to self-relay.
    return { mode: 'UNAVAILABLE' };
  }
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
  ) => {
    abortRef.current = false;

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
        approveTxHash = await approveTokenMessenger(walletClient, sourcePublicClient, action);
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

      if (abortRef.current) return;

      // ── Step 3: Verify source tx receipt ─────────────────────────────────
      const [sourceReceipt, sourceTransaction] = await Promise.all([
        sourcePublicClient.waitForTransactionReceipt({
          hash: burnTxHash,
          timeout: 60_000,
        }),
        sourcePublicClient.getTransaction({ hash: burnTxHash }),
      ]);
      const sourceBinding = verifyCctpSourceTransactionBinding(
        {
          from: sourceTransaction.from,
          to: sourceTransaction.to,
          input: sourceTransaction.input,
        },
        {
          sender: getAddress(action.from),
          recipient: getAddress(action.to),
          tokenAddress: getAddress(action.tokenAddress),
          amount: action.amount,
          destinationChainId: action.destinationChainId,
        },
      );
      if (!sourceBinding.verified) {
        setState({
          phase: 'FAILED',
          burnTxHash,
          error: `Source CCTP binding failed: ${sourceBinding.detail}`,
        });
        return;
      }

      const sourceEvidence = verifyCctpSourceReceiptEvidence(sourceReceipt);
      if (!sourceEvidence.verified) {
        setState({
          phase: 'FAILED',
          burnTxHash,
          error: `Source CCTP verification failed: ${sourceEvidence.detail}`,
        });
        return;
      }
      setState({ phase: 'BRIDGE_UNCONFIRMED', approveTxHash, burnTxHash });
      await persistRecoveryCheckpoint({
        ...checkpointBase,
        stage: 'SOURCE_CONFIRMED',
        updatedAt: Date.now(),
      });

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
        syncRevision:         1,
        syncPending:          true,
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
        executionContext: {
          surface: 'BRIDGE',
          providerId: 'cctp-v2-bridge',
          routeId:
            `bridge:cctp-v2-bridge:${action.sourceChainId}:${action.destinationChainId}:${action.tokenAddress.toLowerCase()}`,
          environment: VEYRA_ENV === 'mainnet' ? 'mainnet' : 'testnet',
          senderAddress: action.from,
          recipientSnapshotId: null,
          recipientAddress: action.to,
          recipientChainId: action.destinationChainId,
          assetId: 'usdc',
          tokenAddress: action.tokenAddress,
          tokenDecimals: action.tokenDecimals,
        },
      };

      const syncedReceipt = await saveReceiptWithRemoteSync(veyraReceipt);
      await persistRecoveryCheckpoint({
        ...checkpointBase,
        stage: 'VERIFIED',
        attestationMessage: attestation.message,
        attestationSignature: attestation.attestation,
        receiveTxHash,
        updatedAt: Date.now(),
      });

      setState({
        phase: 'VERIFIED',
        approveTxHash,
        burnTxHash,
        receiveTxHash,
        receipt: syncedReceipt,
      });



    } catch (err) {
      if (actionReservationHeld && !sourceSubmissionStarted) {
        try {
          await releaseActionExecutionReservation(action.actionId);
        } catch {
          // Preserve the original error. A failed release remains fail-closed.
        }
      }

      setState((prev) => ({
        ...prev,
        phase: 'FAILED',
        error: err instanceof Error ? err.message : 'Bridge execution failed',
      }));
    }
  }, [walletClient, sourcePublicClient, switchChainAsync]);

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
      let sourceTransaction;
      try {
        [sourceReceipt, sourceTransaction] = await Promise.all([
          sourcePublicClient.getTransactionReceipt({
            hash: burnTxHash,
          }),
          sourcePublicClient.getTransaction({
            hash: burnTxHash,
          }),
        ]);
      } catch {
        setState({
          phase: 'BRIDGE_PENDING',
          burnTxHash,
          error: 'Source burn is still pending or not yet indexed. Retry recovery later.',
        });
        return;
      }

      const sourceBinding = verifyCctpSourceTransactionBinding(
        {
          from: sourceTransaction.from,
          to: sourceTransaction.to,
          input: sourceTransaction.input,
        },
        {
          sender: getAddress(current.walletAddress),
          recipient: getAddress(current.recipientAddress),
          tokenAddress: getAddress(current.tokenAddress),
          amount,
          destinationChainId: current.destinationChainId,
        },
      );
      if (!sourceBinding.verified) {
        setState({
          phase: 'FAILED',
          burnTxHash,
          error:
            `Persisted source burn failed route binding: ${sourceBinding.detail}`,
        });
        return;
      }

      const sourceEvidence = verifyCctpSourceReceiptEvidence(sourceReceipt);
      if (!sourceEvidence.verified) {
        setState({
          phase: 'FAILED',
          burnTxHash,
          error:
            `Persisted source burn failed CCTP verification: ${sourceEvidence.detail}`,
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

      const sourceDomain = chainIdToCctpDomain(current.sourceChainId);

      if (current.stage === 'SOURCE_CONFIRMED') {
        setState({ phase: 'BRIDGE_UNCONFIRMED', burnTxHash });

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
      }

      if (current.stage === 'DESTINATION_BROADCAST') {
        if (!current.receiveTxHash) {
          throw new Error('Recovery checkpoint is missing destination transaction hash.');
        }

        const receiveTxHash = current.receiveTxHash as Hash;
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
          syncRevision: 1,
          syncPending: true,
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
          executionContext: {
            surface: 'BRIDGE',
            providerId: 'cctp-v2-bridge',
            routeId:
              `bridge:cctp-v2-bridge:${current.sourceChainId}:${current.destinationChainId}:${current.tokenAddress.toLowerCase()}`,
            environment: VEYRA_ENV === 'mainnet' ? 'mainnet' : 'testnet',
            senderAddress: current.walletAddress,
            recipientSnapshotId: null,
            recipientAddress: current.recipientAddress,
            recipientChainId: current.destinationChainId,
            assetId: 'usdc',
            tokenAddress: current.tokenAddress,
            tokenDecimals: 6,
          },
        };

        const syncedReceipt = await saveReceiptWithRemoteSync(receipt);
        current = {
          ...current,
          stage: 'VERIFIED',
          updatedAt: Date.now(),
        };
        await persistRecoveryCheckpoint(current);

        setState({
          phase: 'VERIFIED',
          burnTxHash,
          receiveTxHash,
          receipt: syncedReceipt,
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
    resumeBridge,
    loadRecoveryCandidates,
    reset,
  };
}
