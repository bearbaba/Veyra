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
import { saveReceipt } from '@/core/receipt/receiptStore';
import type { VeyraReceipt } from '@/core/receipt/receiptTypes';
import { buildTxExplorerUrl } from '@/onchain-facts';
import { verifyPaymentRecipient } from '@/lib/api/identityApi';
import { assertExecutionReady } from '@/core/execution/executionReadiness';
import { VEYRA_ENV } from '@/lib/env';
import {
  verifyErc20TransferReceiptEvidence,
  verifyExactTokenDelta,
} from '@/core/execution/receiptVerification';
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
      setState((s) => ({ ...s, step: 'CONFIRMING', txHash: hash, explorerUrl }));

      // ── Step 2: Wait for receipt ───────────────────────────────────────────
      const txReceipt = await publicClient.waitForTransactionReceipt({ hash });

      const transferEvidence = verifyErc20TransferReceiptEvidence({
        receipt: txReceipt,
        tokenAddress: action.tokenAddress,
        from: action.from,
        to: action.to,
        amount: action.amount,
      });
      if (!transferEvidence.verified) {
        throw new Error(
          `Transaction receipt verification failed: ${transferEvidence.detail}`,
        );
      }

      setState((s) => ({ ...s, step: 'VERIFYING' }));

      // ── Step 3: Verify final state — read actual balance delta ─────────────
      const balanceAfter = await publicClient.readContract({
        address: action.tokenAddress as `0x${string}`,
        abi: ERC20_TRANSFER_ABI,
        functionName: 'balanceOf',
        args: [action.to as `0x${string}`],
      });

      const verification = verifyExactTokenDelta(
        balanceBefore,
        balanceAfter,
        action.amount,
      );
      if (!verification.verified) {
        throw new Error(`Final-state verification failed: ${verification.detail}`);
      }

      // Build receipt
      const receiptId = generateExecutionReceiptId(action.chainId, hash);
      const veyraReceipt: VeyraReceipt = {
        receiptId,
        planId: action.actionId,
        actionType: action.actionType,
        status: 'VERIFIED',
        chainId: action.chainId,
        executionTxHash: hash,
        executionBlock: Number(txReceipt.blockNumber),
        createdAt: action.createdAt,
        completedAt: Date.now(),
        actualAmountDelta: verification.actualDelta,
        expectedAmountDelta: action.amount,
        riskScore: null,
        policyDecision: null,
        displaySummary: `Sent ${formatUnits(action.amount, action.tokenDecimals)} USDC to ${action.to.slice(0, 6)}...${action.to.slice(-4)}`,
        verifiedBalanceAfter: balanceAfter,
      };

      await saveReceipt(veyraReceipt);
      setState((s) => ({ ...s, step: 'DONE', receipt: veyraReceipt }));
    } catch (err) {
      if (actionReservationHeld && !submissionStarted) {
        try {
          await releaseActionExecutionReservation(action.actionId);
        } catch {
          // Preserve the original failure; inability to release is fail-closed.
        }
      }

      const msg = err instanceof Error ? err.message : String(err);
      const failedReceipt: VeyraReceipt = {
        receiptId: `veyra-fail-${Date.now()}`,
        planId: action.actionId,
        actionType: action.actionType,
        status: 'FAILED',
        chainId: action.chainId,
        executionTxHash: broadcastHash ?? undefined,
        createdAt: action.createdAt,
        completedAt: Date.now(),
        actualAmountDelta: null,
        expectedAmountDelta: action.amount,
        riskScore: null,
        policyDecision: null,
        displaySummary: `Transfer failed: ${msg}`,
        verifiedBalanceAfter: undefined,
      };
      await saveReceipt(failedReceipt);
      setState((s) => ({ ...s, step: 'FAILED', error: msg, receipt: failedReceipt }));
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
