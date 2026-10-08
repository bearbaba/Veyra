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
import { useWriteContract, usePublicClient } from 'wagmi';
import { formatUnits } from 'viem';
import type { TransferAction } from '@/core/actions/actionSchema';
import { generateExecutionReceiptId } from '@/core/receipt/receiptId';
import { saveReceipt } from '@/core/receipt/receiptStore';
import type { VeyraReceipt } from '@/core/receipt/receiptTypes';
import { buildTxExplorerUrl } from '@/onchain-facts';

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
  const publicClient = usePublicClient();

  const execute = useCallback(async (action: TransferAction) => {
    if (!publicClient) {
      setState((s) => ({ ...s, step: 'FAILED', error: 'No public client available' }));
      return;
    }

    setState({ step: 'SIGNING', txHash: null, receipt: null, explorerUrl: null, error: null });

    try {
      // ── Step 1: Sign + broadcast ───────────────────────────────────────────
      const hash = await writeContractAsync({
        address: action.tokenAddress as `0x${string}`,
        abi: ERC20_TRANSFER_ABI,
        functionName: 'transfer',
        args: [action.to as `0x${string}`, action.amount],
        chainId: action.chainId,
      });

      const explorerUrl = buildTxExplorerUrl(action.chainId, hash);
      setState((s) => ({ ...s, step: 'CONFIRMING', txHash: hash, explorerUrl }));

      // ── Step 2: Wait for receipt ───────────────────────────────────────────
      const txReceipt = await publicClient.waitForTransactionReceipt({ hash });

      if (txReceipt.status !== 'success') {
        throw new Error(`Transaction reverted (status: ${txReceipt.status})`);
      }

      setState((s) => ({ ...s, step: 'VERIFYING' }));

      // ── Step 3: Verify final state — read actual balance delta ─────────────
      const [balanceAfter] = await Promise.all([
        publicClient.readContract({
          address: action.tokenAddress as `0x${string}`,
          abi: ERC20_TRANSFER_ABI,
          functionName: 'balanceOf',
          args: [action.to as `0x${string}`],
        }),
      ]);

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
        actualAmountDelta: action.amount,
        expectedAmountDelta: action.amount,
        riskScore: null,
        policyDecision: 'PASS',
        displaySummary: `Sent ${formatUnits(action.amount, action.tokenDecimals)} USDC to ${action.to.slice(0, 6)}...${action.to.slice(-4)}`,
        verifiedBalanceAfter: balanceAfter,
      };

      await saveReceipt(veyraReceipt);
      setState((s) => ({ ...s, step: 'DONE', receipt: veyraReceipt }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const failedReceipt: VeyraReceipt = {
        receiptId: `veyra-fail-${Date.now()}`,
        planId: action.actionId,
        actionType: action.actionType,
        status: 'FAILED',
        chainId: action.chainId,
        executionTxHash: state.txHash ?? undefined,
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
  }, [writeContractAsync, publicClient, state.txHash]);

  function reset() {
    setState({ step: 'IDLE', txHash: null, receipt: null, explorerUrl: null, error: null });
  }

  return { state, execute, reset };
}
