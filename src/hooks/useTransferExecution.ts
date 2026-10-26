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
import { normalizeBetaHandle } from '../identity-beta/protocol';
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
} from '@/core/execution/receiptVerification';
import {
  lockActionExecution,
  markActionExecutionSubmissionStarted,
  releaseActionExecutionReservation,
  reserveActionExecution,
} from '@/core/execution/actionExecutionReplayStore';
import { MANIFEST_CONSTANTS } from '@/providers/registry/providerManifest';
import {evaluateTransferSafety,assertTransferSafety,REVIEWED_TRANSFER_ABI,assertSuccessfulTransferSimulation} from '@/core/execution/transferSafetyGate';
import {classifyTransferOutcome,isExplicitWalletRejection} from '@/core/execution/transferOutcome';

export type TransferStep =
  | 'IDLE'
  | 'PREPARING'
  | 'SIGNING'
  | 'BROADCAST'
  | 'CONFIRMING'
  | 'VERIFYING'
  | 'PENDING'
  | 'CANCELLED'
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

  const execute = useCallback(async (action: TransferAction, recipientGuard?: { snapshotId: string; expectedWalletId: string; expectedWalletAddress: string; expectedChainId: number; reviewToken: string; reviewedVeyraHandle?: string }, sessionToken?: string, confirmedAtReview = false) => {
    if (!publicClient) {
      setState((s) => ({ ...s, step: 'FAILED', error: 'No public client available' }));
      return;
    }

    setState({ step: 'PREPARING', txHash: null, receipt: null, explorerUrl: null, error: null });

    let actionReservationHeld = false;
    let submissionStarted = false;
    let broadcastHash: `0x${string}` | null = null;
    let chainReceiptReverted = false;
    let reviewedVeyraHandle: string | undefined;

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

      // Revalidate the frozen recipient with the same signed, wallet-bound
      // identity session used to prepare it. No stored or fallback token.
      // Missing/expired sessions must block before requesting a wallet signature.
      if (recipientGuard) {
        if (!sessionToken) throw new Error('Your Veyra ID session ended. Sign in and review the recipient again.');
        // DISPLAY label never enters signed recipient verification.
        const { reviewedVeyraHandle: label, ...verifiedGuard } = recipientGuard;
        await verifyPaymentRecipient(verifiedGuard, sessionToken);
        if (label) {
          const normalized=normalizeBetaHandle(label);
          if(normalized!==label ||
            verifiedGuard.expectedWalletAddress.toLowerCase()!==action.to.toLowerCase())
            throw new Error('Reviewed Veyra ID does not match the frozen recipient wallet.');
          reviewedVeyraHandle=normalized;
        }
      }

      // Wallet network is transport state, not product state. Read/plan works
      // cross-network; only request the actual source network when signing.
      if (chainId !== action.chainId) {
        await switchChainAsync({ chainId: action.chainId });
      }

      // Fail closed if action/provenance aged during recipient verification or
      // wallet chain switching. Re-simulate the actual token transfer from the
      // approved sender, and redo ALL deterministic policy/risk checks.
      assertExecutionReady({
        action,providerId:'arc-erc20-transfer',providerCapability:'TRANSFER',
        assetAddress:action.tokenAddress,runtimeEnvironment:VEYRA_ENV,
      });
      const simulation=await publicClient.simulateContract({
        address:action.tokenAddress as `0x${string}`,
        abi:REVIEWED_TRANSFER_ABI,
        functionName:'transfer',
        args:[action.to as `0x${string}`,action.amount],
        account:action.from as `0x${string}`,
      });
      assertSuccessfulTransferSimulation(simulation.result);
      assertTransferSafety(evaluateTransferSafety(action,true),confirmedAtReview);

      // ── Step 1: Sign + broadcast ───────────────────────────────────────────
      // Fail closed before opening the wallet request. A browser disappearance
      // around submission must never make the same deterministic action
      // executable again.
      await markActionExecutionSubmissionStarted(action.actionId);
      submissionStarted = true;
      setState((previous) => ({ ...previous, step: 'SIGNING' }));

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
      const pendingReceipt: VeyraReceipt = {
        receiptId: generateExecutionReceiptId(action.chainId, hash),
        planId: action.actionId,
        actionType: action.actionType,
        status: 'PENDING',
        chainId: action.chainId,
        ownerAddress: action.from,
        recipientAddress: action.to,
        recipientVeyraHandleAtReview: reviewedVeyraHandle,
        tokenAddress: action.tokenAddress,
        tokenDecimals: action.tokenDecimals,
        tokenSymbol: 'USDC',
        executionTxHash: hash,
        createdAt: action.createdAt,
        actualAmountDelta: null,
        expectedAmountDelta: action.amount,
        riskScore: null,
        policyDecision: null,
        displaySummary: 'Transaction submitted. Waiting for independent on-chain verification.',
      };
      setState((previous) => ({ ...previous, step: 'CONFIRMING',
        txHash: hash, explorerUrl, receipt: pendingReceipt }));
      // Persist the hash before waiting: closing the dialog or an RPC outage
      // must not erase a real submitted transfer from Activity.
      try { await saveReceipt(pendingReceipt); }
      catch { /* IndexedDB failure does not imply a failed on-chain payment. */ }

      // ── Step 2: Wait for receipt ───────────────────────────────────────────
      // Match read-only crash recovery: 12 canonical confirmations before
      // calling a transaction terminal. The UI stays CONFIRMING meanwhile.
      const txReceipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 12 });
      chainReceiptReverted = txReceipt.status === 'reverted';

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

      // ── Step 3: Confirm the exact transfer event in THIS transaction ──────
      // The verified Transfer(token, sender, recipient, amount) event above
      // identifies this specific payment. A before/after balance subtraction
      // could be wrong when the recipient has concurrent transactions.
      // A separate balance read is diagnostic only; it cannot demote verified
      // transaction evidence to PENDING when an RPC fails.
      let balanceAfter: bigint | undefined;
      try {
        balanceAfter = await publicClient.readContract({
          address: action.tokenAddress as `0x${string}`,
          abi: ERC20_TRANSFER_ABI,
          functionName: 'balanceOf',
          args: [action.to as `0x${string}`],
        });
      } catch {
        // The exact successful Transfer log remains authoritative.
      }

      // Build receipt
      const receiptId = generateExecutionReceiptId(action.chainId, hash);
      const veyraReceipt: VeyraReceipt = {
        receiptId,
        planId: action.actionId,
        actionType: action.actionType,
        status: 'VERIFIED',
        chainId: action.chainId,
        ownerAddress: action.from,
        recipientAddress: action.to,
        recipientVeyraHandleAtReview: reviewedVeyraHandle,
        tokenAddress: action.tokenAddress,
        tokenDecimals: action.tokenDecimals,
        tokenSymbol: 'USDC',
        executionTxHash: hash,
        executionBlock: Number(txReceipt.blockNumber),
        createdAt: action.createdAt,
        completedAt: Date.now(),
        actualAmountDelta: transferEvidence.transferAmount,
        expectedAmountDelta: action.amount,
        riskScore: null,
        policyDecision: null,
        displaySummary: reviewedVeyraHandle
          ? `Sent ${formatUnits(action.amount, action.tokenDecimals)} USDC to @${reviewedVeyraHandle}.veyra (ID at review)`
          : `Sent ${formatUnits(action.amount, action.tokenDecimals)} USDC to ${action.to.slice(0, 6)}...${action.to.slice(-4)}`,
        verifiedBalanceAfter: balanceAfter,
      };

      // A local storage failure is not a blockchain failure. Never rewrite an
      // independently VERIFIED payment as PENDING because IndexedDB is down.
      let persistenceWarning: string | null = null;
      try {
        await saveReceipt(veyraReceipt);
      } catch {
        persistenceWarning = 'Transfer verified on-chain, but local history could not be saved. Keep the explorer link.';
      }
      setState((s) => ({ ...s, step: 'DONE', receipt: veyraReceipt, error: persistenceWarning }));
    } catch (err) {
      if (actionReservationHeld && !submissionStarted) {
        try {
          await releaseActionExecutionReservation(action.actionId);
        } catch {
          // Preserve the original failure; inability to release is fail-closed.
        }
      }

      const msg = err instanceof Error ? err.message : String(err);
      // Ambiguous wallet/RPC outcomes must never be labeled as a confirmed
      // failure. Only RPC code 4001 proves explicit user cancellation.
      const outcomeKind = classifyTransferOutcome({
        submissionStarted,
        broadcastHash,
        revertedOnChain:chainReceiptReverted,
        userExplicitlyRejected:isExplicitWalletRejection(err),
      });
      const pending = outcomeKind === 'PENDING';
      const cancelled = outcomeKind === 'CANCELLED';
      const outcome: VeyraReceipt = {
        receiptId: broadcastHash
          ? generateExecutionReceiptId(action.chainId,broadcastHash)
          : submissionStarted ? `veyra-plan-${action.actionId}` : `veyra-fail-${Date.now()}`,
        planId:action.actionId,
        actionType:action.actionType,
        status:outcomeKind,
        chainId:action.chainId,
        ownerAddress:action.from,
        recipientAddress:action.to,
        recipientVeyraHandleAtReview:reviewedVeyraHandle,
        tokenAddress:action.tokenAddress,
        tokenDecimals:action.tokenDecimals,
        tokenSymbol:'USDC',
        executionTxHash:broadcastHash ?? undefined,
        createdAt:action.createdAt,
        completedAt:pending ? undefined : Date.now(),
        actualAmountDelta:null,
        expectedAmountDelta:action.amount,
        riskScore:null,
        policyDecision:null,
        displaySummary:pending
          ? broadcastHash
            ? 'Transaction submitted. Final confirmation is still unknown. Do not send again.'
            : 'Wallet submission result is unknown. Check your wallet activity before trying again.'
          : cancelled ? 'Wallet signature request rejected by the user.'
          : chainReceiptReverted ? 'Arc Testnet confirmed that the transfer reverted.'
          : 'Transfer was blocked before wallet submission.',
      };
      try { await saveReceipt(outcome); } catch { /* Keep the UI informative. */ }
      setState((previous) => ({
        ...previous,
        step:outcomeKind,
        txHash:broadcastHash,
        explorerUrl:broadcastHash ? buildTxExplorerUrl(action.chainId,broadcastHash) : null,
        error:pending ? broadcastHash
          ? 'Final verification is unavailable. Inspect the transaction before sending again.'
          : 'The wallet may have submitted this payment. Check wallet history before retrying.'
          : cancelled ? 'You rejected the wallet request. No confirmed transfer was submitted.'
          : chainReceiptReverted ? 'The on-chain transaction reverted.' : msg,
        receipt:outcome,
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
