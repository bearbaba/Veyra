/**
 * Veyra Transfer Execution Hook
 *
 * Executes a validated, policy-passed, risk-passed TransferAction.
 * Steps:
 *   1. Reserve quote (replay protection)
 *   2. Sign ERC-20 transfer via wagmi writeContract
 *   3. Mark broadcast
 *   4. Wait for receipt
 *   5. Verify final chain state (token delta)
 *   6. Mark used / generate VeyraReceipt
 *
 * This is the ONLY path to execution for TRANSFER actions.
 * No other component calls writeContract directly.
 */

import { useState, useCallback } from 'react';
import { useWriteContract, usePublicClient, useAccount, useSwitchChain } from 'wagmi';
import { formatUnits } from 'viem';
import type { TransferAction } from '@/core/actions/actionSchema';
import { generateExecutionReceiptId } from '@/core/receipt/receiptId';
import { saveReceiptWithRemoteSync } from '@/core/receipt/receiptSync';
import type { VeyraReceipt } from '@/core/receipt/receiptTypes';
import { buildTxExplorerUrl } from '@/onchain-facts';
import { verifyPaymentRecipient } from '@/lib/api/identityApi';
import { assertExecutionReady } from '@/core/execution/executionReadiness';
import { VEYRA_ENV } from '@/lib/env';
import { recoverPendingTransferReceipt } from '@/core/execution/transferRecovery';
import {
  lockActionExecution,
  markActionExecutionSubmissionStarted,
  releaseActionExecutionReservation,
  reserveActionExecution,
} from '@/core/execution/actionExecutionReplayStore';
import { MANIFEST_CONSTANTS } from '@/providers/registry/providerManifest';

export type TransferStep =
  | 'IDLE'
  | 'SIGNING'
  | 'BROADCAST'
  | 'CONFIRMING'
  | 'VERIFYING'
  | 'DONE'
  | 'FAILED';

export interface TransferExecutionState {
  step: TransferStep;
  txHash: string | null;
  receipt: VeyraReceipt | null;
  explorerUrl: string | null;
  error: string | null;
}

const ERC20_TRANSFER_ABI = [
  {
    name: 'transfer',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to',    type: 'address' },
      { name: 'value', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

export function useTransferExecution() {
  const [state, setState] = useState<TransferExecutionState>({
    step: 'IDLE',
    txHash: null,
    receipt: null,
    explorerUrl: null,
    error: null,
  });

  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient({
    chainId: MANIFEST_CONSTANTS.ARC_TESTNET_CHAIN_ID,
  });
  const { address, chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();

  const execute = useCallback(async (action: TransferAction, recipientGuard?: { snapshotId: string; expectedWalletAddress: string; expectedChainId: number }) => {
    if (!publicClient) {
      setState((s) => ({ ...s, step: 'FAILED', error: 'No public client available' }));
      return;
    }

    setState({ step: 'SIGNING', txHash: null, receipt: null, explorerUrl: null, error: null });

    let actionReservationHeld = false;
    let submissionStarted = false;
    let broadcastHash: `0x${string}` | null = null;
    let pendingReceipt: VeyraReceipt | null = null;

    try {
      // Canonical final execution boundary. Re-check schema/provenance/provider
      // eligibility immediately before any wallet signature.
      assertExecutionReady({
        action,
        providerId: 'arc-erc20-transfer',
        providerCapability: 'TRANSFER',
        assetAddress: action.tokenAddress,
        runtimeEnvironment: VEYRA_ENV,
      });

      if (
        !address ||
        address.toLowerCase() !== action.from.toLowerCase()
      ) {
        throw new Error(
          'Connected wallet does not match the deterministic transfer sender.',
        );
      }

      const reservation = await reserveActionExecution({
        actionId: action.actionId,
        providerId: 'arc-erc20-transfer',
        operation: 'TRANSFER',
      });
      if (!reservation.success) {
        throw new Error(
          `Transfer action "${action.actionId}" cannot execute again: ${reservation.reason}.`,
        );
      }
      actionReservationHeld = true;

      // Revalidate a frozen Veyra identity immediately before wallet signature.
      // If profile/wallet/revision changed since review, execution fails closed.
      if (recipientGuard) await verifyPaymentRecipient(recipientGuard);

      // Wallet network is transport state, not product state. Read/plan works
      // cross-network; only request the actual source network when signing.
      if (chainId !== action.chainId) {
        await switchChainAsync({ chainId: action.chainId });
      }

      // Snapshot authoritative recipient balance before signing. A successful
      // transaction receipt alone is not sufficient for a VERIFIED Veyra receipt.
      const balanceBefore = await publicClient.readContract({
        address: action.tokenAddress as `0x${string}`,
        abi: ERC20_TRANSFER_ABI,
        functionName: 'balanceOf',
        args: [action.to as `0x${string}`],
      });

      // ── Step 1: Sign + broadcast ───────────────────────────────────────────
      // Fail closed before opening the wallet request. A browser disappearance
      // around submission must never make the same deterministic action
      // executable again.
      await markActionExecutionSubmissionStarted(action.actionId);
      submissionStarted = true;

      const hash = await writeContractAsync({
        address: action.tokenAddress as `0x${string}`,
        abi: ERC20_TRANSFER_ABI,
        functionName: 'transfer',
        args: [action.to as `0x${string}`, action.amount],
        chainId: action.chainId,
      });
      broadcastHash = hash;

      // Once the wallet returns a hash, permanently close fresh execution for
      // this actionId before waiting for confirmation.
      await lockActionExecution(action.actionId);

      const explorerUrl = buildTxExplorerUrl(action.chainId, hash);
      const receiptId = generateExecutionReceiptId(action.chainId, hash);
      pendingReceipt = {
        receiptId,
        planId: action.actionId,
        actionType: action.actionType,
        status: 'PENDING',
        syncRevision: 1,
        syncPending: true,
        chainId: action.chainId,
        executionTxHash: hash,
        createdAt: action.createdAt,
        actualAmountDelta: null,
        expectedAmountDelta: action.amount,
        riskScore: null,
        policyDecision: null,
        displaySummary:
          `Sent ${formatUnits(action.amount, action.tokenDecimals)} USDC to ${action.to.slice(0, 6)}...${action.to.slice(-4)} — verification pending`,
        transferTrace: {
          providerId: 'arc-erc20-transfer',
          tokenAddress: action.tokenAddress,
          tokenDecimals: action.tokenDecimals,
          fromAddress: action.from,
          recipientAddress: action.to,
          amountRaw: action.amount.toString(),
          balanceBeforeRaw: balanceBefore.toString(),
        },
        executionContext: {
          surface: 'PAY',
          providerId: 'arc-erc20-transfer',
          routeId:
            `transfer:arc-erc20-transfer:${action.chainId}:${action.tokenAddress.toLowerCase()}`,
          environment: VEYRA_ENV === 'mainnet' ? 'mainnet' : 'testnet',
          senderAddress: action.from,
          recipientSnapshotId: recipientGuard?.snapshotId ?? null,
          recipientAddress: action.to,
          recipientChainId: action.chainId,
          assetId: 'usdc',
          tokenAddress: action.tokenAddress,
          tokenDecimals: action.tokenDecimals,
        },
      };

      // Persist the deterministic tx hash and all verification context before
      // waiting. A tab/browser crash can now resume verification without ever
      // submitting the transfer again.
      pendingReceipt = await saveReceiptWithRemoteSync(pendingReceipt);
      setState((s) => ({
        ...s,
        step: 'CONFIRMING',
        txHash: hash,
        explorerUrl,
        receipt: pendingReceipt,
      }));

      // ── Step 2: Wait for receipt ───────────────────────────────────────────
      await publicClient.waitForTransactionReceipt({ hash });

      setState((s) => ({ ...s, step: 'VERIFYING' }));

      // ── Step 3: Reconcile from authoritative chain receipt evidence ────────
      const recovery = await recoverPendingTransferReceipt(
        publicClient,
        pendingReceipt,
      );

      if (recovery.status === 'PENDING') {
        const persisted = await saveReceiptWithRemoteSync(recovery.receipt);
        setState((s) => ({
          ...s,
          step: 'FAILED',
          error: recovery.detail,
          receipt: persisted,
        }));
        return;
      }

      const persisted = await saveReceiptWithRemoteSync(recovery.receipt);
      setState((s) => ({
        ...s,
        step: recovery.status === 'VERIFIED' ? 'DONE' : 'FAILED',
        error: recovery.status === 'FAILED' ? recovery.detail : null,
        receipt: persisted,
      }));
    } catch (err) {
      if (actionReservationHeld && !submissionStarted) {
        try {
          await releaseActionExecutionReservation(action.actionId);
        } catch {
          // Preserve the original failure; inability to release is fail-closed.
        }
      }

      const msg = err instanceof Error ? err.message : String(err);

      if (broadcastHash && pendingReceipt) {
        // Once a tx hash exists, a timeout/network/browser verification error is
        // not proof that the transfer failed. Preserve the pending receipt for
        // Activity/reload reconciliation instead of inventing a FAILED outcome.
        pendingReceipt = await saveReceiptWithRemoteSync(pendingReceipt);
        setState((s) => ({
          ...s,
          step: 'FAILED',
          error: `${msg} The submitted transfer remains pending verification.`,
          receipt: pendingReceipt,
        }));
        return;
      }

      setState((s) => ({
        ...s,
        step: 'FAILED',
        error: msg,
        receipt: null,
      }));
    }
  }, [
    address,
    chainId,
    publicClient,
    switchChainAsync,
    writeContractAsync,
  ]);

  function reset() {
    setState({ step: 'IDLE', txHash: null, receipt: null, explorerUrl: null, error: null });
  }

  return { state, execute, reset };
}
