/**
 * useConvertExecution
 *
 * Convert pipeline state: quote fetch → evaluation → sign → BFF trade → verify → receipt
 */

import { useState, useCallback } from 'react';
import type { ConvertAction } from '../core/actions/actionSchema';
import type { ConvertPipelineEvaluation, ConvertPipelineStatus } from '../core/pipeline/convertPipeline';
import { evaluateConvertAction } from '../core/pipeline/convertPipeline';
import { convertErrorState, canDiscardConvertDraft } from '../core/pipeline/convertRecoveryPolicy';
import type { StableFxQuoteResponse, StableFxTradeStatus } from '../providers/stablefx/stableFxAdapter';
import {
  fetchStableFxQuote,
  buildConvertActionFromQuote,
  createStableFxTrade,
  pollStableFxTrade,
  isStableFxProviderTradeComplete,
  fetchStableFxFundingPresign,
  submitStableFxFunding,
  type StableFxFundingPresign,
  type StableFxCurrency,
} from '../providers/stablefx/stableFxAdapter';
import type { VeyraReceipt } from '../core/receipt/receiptTypes';
import { generatePlanReceiptId } from '../core/receipt/receiptId';
import { parseUnits, type Address } from 'viem';
import { checkProviderEligibility } from '../providers/registry/providerRegistry';
import { VEYRA_ENV } from '../lib/env';
import { assertExecutionReady } from '../core/execution/executionReadiness';
import { verifyMinimumOutput } from '../core/execution/receiptVerification';
import { saveReceipt } from '../core/receipt/receiptStore';
import {
  markQuoteBroadcast,
  markQuoteUsed,
  releaseReservation,
  reserveQuote,
} from '../core/receipt/quoteReplayStore';

interface ConvertState {
  status: ConvertPipelineStatus;
  quote?: StableFxQuoteResponse;
  evaluation?: ConvertPipelineEvaluation;
  trade?: StableFxTradeStatus;
  receipt?: VeyraReceipt;
  error?: string;
  /** Wallet address used for this conversion — kept in state because ConvertAction has no `from` field. */
  walletAddress?: Address;
}

export function useConvertExecution() {
  const [state, setState] = useState<ConvertState>({ status: 'PENDING' });

  const fetchQuote = useCallback(async (
    fromCurrency: StableFxCurrency,
    toCurrency: StableFxCurrency,
    fromAmount: string,
    walletAddress: Address,
  ) => {
    setState({ status: 'VALIDATING' });
    try {
      const quote = await fetchStableFxQuote({ fromCurrency, toCurrency, fromAmount, recipientAddress: walletAddress });
      const action = buildConvertActionFromQuote(quote, fromCurrency, toCurrency, walletAddress);
      const evaluation = evaluateConvertAction(action);
      const providerEligibility = checkProviderEligibility(
        action.providerId,
        'CONVERT',
        action.chainId,
        action.fromTokenAddress,
        VEYRA_ENV,
      );

      if (!providerEligibility.eligible || providerEligibility.status !== 'ELIGIBLE') {
        setState({
          status: 'POLICY_BLOCKED',
          quote,
          evaluation,
          walletAddress,
          error: `Provider ${action.providerId} is not execution-ready: ${providerEligibility.status}. ${providerEligibility.detail}`,
        });
        return;
      }

      if (!evaluation.canProceed) {
        setState({ status: 'POLICY_BLOCKED', quote, evaluation, walletAddress, error: evaluation.blockedReason });
        return;
      }

      setState({ status: 'AWAITING_APPROVAL', quote, evaluation, walletAddress });
    } catch (err) {
      setState({ status: 'FAILED', error: err instanceof Error ? err.message : 'Quote fetch failed' });
    }
  }, []);

  const executeConvert = useCallback(async (
    action: ConvertAction,
    quote: StableFxQuoteResponse,
    walletAddress: Address,
    signTypedData: (typedData: StableFxQuoteResponse['typedData']) => Promise<string>,
    verifyAndApproveFunding: (presign: StableFxFundingPresign, trade: StableFxTradeStatus) => Promise<void>,
  ) => {
    setState((prev) => ({ ...prev, status: 'SIGNING' }));

    let quoteReserved = false;
    let broadcastLocked = false;
    let submittedTrade: StableFxTradeStatus | null = null;
    const idempotencyKey = crypto.randomUUID();

    try {
      assertExecutionReady({
        action,
        providerId: action.providerId,
        providerCapability: 'CONVERT',
        assetAddress: action.fromTokenAddress,
        runtimeEnvironment: VEYRA_ENV,
      });

      if (action.provenance.quoteId !== quote.id) {
        throw new Error('Reviewed Convert action is not bound to the supplied provider quote.');
      }

      const rawQuoteExpiry = new Date(quote.expiresAt).getTime();
      if (!Number.isFinite(rawQuoteExpiry)) {
        throw new Error('Provider quote has an invalid expiry timestamp.');
      }

      const reservation = await reserveQuote(quote.id, rawQuoteExpiry);
      if (!reservation.success) {
        throw new Error(`Provider quote cannot execute: ${reservation.reason}.`);
      }
      quoteReserved = true;

      const signature = await signTypedData(quote.typedData);

      setState((prev) => ({ ...prev, status: 'BROADCASTING' }));

      // Lock the quote before attempting the remote trade submission. If the
      // network outcome is uncertain after this point, the quote stays locked
      // as BROADCAST rather than risking a duplicate provider submission.
      await markQuoteBroadcast(quote.id);
      broadcastLocked = true;
      quoteReserved = false;

      // ConvertAction has no `from` field — walletAddress is passed explicitly as a param
      const trade = await createStableFxTrade({
        quoteId: quote.id,
        idempotencyKey,
        walletAddress,
        message: quote.typedData.message,
        signature,
      });

      submittedTrade = trade;
      // Persist the owner-scoped trade BEFORE the second signature or funding
      // request. A rejected funding signature must not erase a created trade.
      const fundingPendingReceipt: VeyraReceipt = {
        receiptId: generatePlanReceiptId(),
        planId: action.actionId,
        actionType: 'CONVERT',
        status: 'PENDING',
        chainId: action.chainId,
        ownerAddress: walletAddress,
        providerTradeId: trade.id,
        providerQuoteId: quote.id,
        providerIdempotencyKey: idempotencyKey,
        createdAt: action.createdAt,
        actualAmountDelta: null,
        expectedAmountDelta: action.minAmountOut,
        riskScore: null,
        policyDecision: null,
        displaySummary: 'StableFX trade created. Funding requires separate explicit wallet authorization.',
      };
      await saveReceipt(fundingPendingReceipt);
      setState((prev) => ({
        ...prev, status: 'VERIFYING', trade, receipt: fundingPendingReceipt,
      }));
      if (trade.status === 'pending_settlement') {
        const presign = await fetchStableFxFundingPresign(trade);
        // Validated on-chain token, spender code, gas, allowance and wallet
        // before showing a SECOND EIP-712 wallet signature for funding.
        await verifyAndApproveFunding(presign, trade);
        setState((prev) => ({ ...prev, status: 'SIGNING' }));
        const fundingSignature = await signTypedData(presign.typedData);
        setState((prev) => ({ ...prev, status: 'BROADCASTING' }));
        await submitStableFxFunding(trade, presign, fundingSignature);
      }
      setState((prev) => ({ ...prev, status: 'VERIFYING' }));

      // Poll for completion (up to 60s). Only network/status fetch errors
      // are treated as transient; lifecycle/receipt errors must never be swallowed.
      let finalTrade = trade;
      for (let i = 0; i < 12; i++) {
        await new Promise((r) => setTimeout(r, 5000));
        try {
          finalTrade = await pollStableFxTrade(trade.id);
        } catch {
          // Transient poll error — continue without changing replay state.
          continue;
        }

        if (isStableFxProviderTradeComplete(finalTrade) || finalTrade.status === 'failed') break;
      }

      if (finalTrade.status === 'failed') {
        await markQuoteUsed(quote.id);
        const failedReceipt: VeyraReceipt = {
          receiptId: generatePlanReceiptId(),
          planId: action.actionId,
          actionType: 'CONVERT',
          status: 'FAILED',
          chainId: action.chainId,
          createdAt: action.createdAt,
          completedAt: Date.now(),
          actualAmountDelta: null,
          expectedAmountDelta: action.minAmountOut,
          riskScore: null,
          policyDecision: null,
          displaySummary: 'Convert failed at the provider after submission.',
        };
        await saveReceipt(failedReceipt);
        setState((prev) => ({
          ...prev,
          status: 'FAILED',
          trade: finalTrade,
          receipt: failedReceipt,
          error: 'Trade failed on Circle',
        }));
        return;
      }

      const receiptId = generatePlanReceiptId();

      if (!isStableFxProviderTradeComplete(finalTrade)) {
        const pendingReceipt: VeyraReceipt = {
          receiptId,
          planId: action.actionId,
          actionType: 'CONVERT',
          status: 'PENDING',
          chainId: action.chainId,
          ownerAddress: walletAddress,
          providerTradeId: finalTrade.id,
          providerQuoteId: quote.id,
          providerIdempotencyKey: idempotencyKey,
          createdAt: action.createdAt,
          actualAmountDelta: null,
          expectedAmountDelta: action.minAmountOut,
          riskScore: null,
          policyDecision: null,
          displaySummary: `StableFX trade ${trade.id} has not settled. Awaiting owned blockchain evidence.`,
        };
        await saveReceipt(pendingReceipt);
        setState((prev) => ({
          ...prev,
          status: 'SETTLEMENT_PENDING',
          trade: finalTrade,
          receipt: pendingReceipt,
          error: 'Swap already submitted; awaiting settlement. Do not submit another trade.',
        }));
        return;
      }

      const actualOutput = parseUnits(finalTrade.to.amount, action.toTokenDecimals);
      const verification = verifyMinimumOutput(actualOutput, action.minAmountOut);

      if (!verification.verified) {
        // This discrepancy is provider-reported. Do not claim an on-chain
        // received amount or a final loss until the wallet settlement is read.
        const pendingReceipt: VeyraReceipt = {
          receiptId,
          planId: action.actionId,
          actionType: 'CONVERT',
          status: 'PENDING',
          chainId: action.chainId,
          ownerAddress: walletAddress,
          providerTradeId: finalTrade.id,
          providerQuoteId: quote.id,
          providerIdempotencyKey: idempotencyKey,
          createdAt: action.createdAt,
          actualAmountDelta: null,
          expectedAmountDelta: action.minAmountOut,
          riskScore: null,
          policyDecision: null,
          displaySummary: 'StableFX reported output below the reviewed minimum; on-chain settlement needs reconciliation.',
        };
        await markQuoteUsed(quote.id);
        await saveReceipt(pendingReceipt);
        setState((prev) => ({
          ...prev, status: 'SETTLEMENT_PENDING',
          trade: finalTrade,
          receipt: pendingReceipt,
          error: verification.detail + ' No second swap is submitted.',
        }));
        return;
      }

      // Circle's provider-level "complete" is not on-chain receipt evidence.
      // Until we verify the destination token transfer (or an exact, owner-
      // bound before/after balance delta), never manufacture a VERIFIED receipt.
      // Retain quote replay lock and the provider trade ID for reconciliation.
      const receipt: VeyraReceipt = {
        receiptId,
        planId: action.actionId,
        actionType: 'CONVERT',
        status: 'PENDING',
        chainId: action.chainId,
        ownerAddress: walletAddress,
          providerTradeId: finalTrade.id,
          providerQuoteId: quote.id,
          providerIdempotencyKey: idempotencyKey,
        createdAt: action.createdAt,
        actualAmountDelta: null,
        expectedAmountDelta: action.minAmountOut,
        riskScore: null,
        policyDecision: null,
        displaySummary: 'StableFX reports completion. Awaiting independent on-chain settlement verification before marking Swap successful.',
      };

      await markQuoteUsed(quote.id);
      await saveReceipt(receipt);
      setState((prev) => ({
        ...prev,
        status: 'SETTLEMENT_PENDING',
        trade: finalTrade,
        receipt,
        error: 'Provider reports completion; destination USDC/EURC receipt is not yet independently verified.',
      }));
    } catch (err) {
      // Only release a quote if execution definitely stopped before the
      // provider-submission boundary. Once BROADCAST is recorded, uncertainty
      // stays locked until reconciliation instead of permitting a double-submit.
      if (quoteReserved && !broadcastLocked) {
        try {
          await releaseReservation(quote.id);
        } catch {
          // Preserve the original execution error; replay protection remains
          // fail-closed if release itself cannot be confirmed.
        }
      }

      const nextStatus = convertErrorState(broadcastLocked);
      const errorDetail = err instanceof Error ? err.message : 'Convert execution failed';
      if (nextStatus === 'SETTLEMENT_PENDING') {
        // A POST timeout is not proof the provider rejected the trade.
        // Keep an owner-bound pending receipt and the quote in BROADCAST state.
        // Never suggest a second trade while reconciliation is unresolved.
        const pendingReceipt: VeyraReceipt = {
          receiptId: generatePlanReceiptId(),
          planId: action.actionId,
          actionType: 'CONVERT',
          status: 'PENDING',
          chainId: action.chainId,
          ownerAddress: walletAddress,
          providerTradeId: submittedTrade?.id,
          providerQuoteId: quote.id,
          providerIdempotencyKey: idempotencyKey,
          createdAt: action.createdAt,
          actualAmountDelta: null,
          expectedAmountDelta: action.minAmountOut,
          riskScore: null,
          policyDecision: null,
          displaySummary: submittedTrade
            ? 'StableFX trade exists; funding or settlement is unresolved. Do not submit another trade.'
            : 'Swap submission outcome unknown. Reconcile the provider trade before retry.',
        };
        try { await saveReceipt(pendingReceipt); }
        catch { /* Keep the execution locked even if local persistence is unavailable. */ }
        setState((prev) => ({
          ...prev,
          status: nextStatus,
          ...(submittedTrade ? { trade: submittedTrade } : {}),
          receipt: pendingReceipt,
          error: 'Swap may have reached Circle. ' + errorDetail + ' Do not submit another trade.',
        }));
        return;
      }
      setState((prev) => ({
        ...prev,
        status: nextStatus,
        error: errorDetail,
      }));
    }
  }, []);

  const reset = useCallback(() => {
    setState((prev) => canDiscardConvertDraft(prev.status) ? { status: 'PENDING' } : prev);
  }, []);

  return { state, fetchQuote, executeConvert, reset };
}
