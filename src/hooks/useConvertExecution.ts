/**
 * useConvertExecution
 *
 * Convert pipeline state: quote fetch → evaluation → sign → BFF trade → verify → receipt
 */

import { useState, useCallback } from 'react';
import type { ConvertAction } from '../core/actions/actionSchema';
import type { ConvertPipelineEvaluation, ConvertPipelineStatus } from '../core/pipeline/convertPipeline';
import { evaluateConvertAction } from '../core/pipeline/convertPipeline';
import type { StableFxQuoteResponse, StableFxTradeStatus } from '../providers/stablefx/stableFxAdapter';
import {
  fetchStableFxQuote,
  buildConvertActionFromQuote,
  createStableFxTrade,
  pollStableFxTrade,
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
  ) => {
    setState((prev) => ({ ...prev, status: 'SIGNING' }));

    let quoteReserved = false;
    let broadcastLocked = false;

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
        walletAddress,
        message: quote.typedData.message,
        signature,
      });

      setState((prev) => ({ ...prev, status: 'VERIFYING', trade }));

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

        if (finalTrade.status === 'complete' || finalTrade.status === 'failed') break;
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

      if (finalTrade.status !== 'complete') {
        const pendingReceipt: VeyraReceipt = {
          receiptId,
          planId: action.actionId,
          actionType: 'CONVERT',
          status: 'PENDING',
          chainId: action.chainId,
          createdAt: action.createdAt,
          actualAmountDelta: null,
          expectedAmountDelta: action.minAmountOut,
          riskScore: null,
          policyDecision: null,
          displaySummary: `Convert is still pending at provider status ${finalTrade.status}.`,
        };
        await saveReceipt(pendingReceipt);
        setState((prev) => ({
          ...prev,
          status: 'PENDING',
          trade: finalTrade,
          receipt: pendingReceipt,
          error: 'Conversion has not reached final provider completion yet.',
        }));
        return;
      }

      const actualOutput = parseUnits(finalTrade.to.amount, action.toTokenDecimals);
      const verification = verifyMinimumOutput(actualOutput, action.minAmountOut);

      if (!verification.verified) {
        const failedReceipt: VeyraReceipt = {
          receiptId,
          planId: action.actionId,
          actionType: 'CONVERT',
          status: 'FAILED',
          chainId: action.chainId,
          createdAt: action.createdAt,
          completedAt: Date.now(),
          actualAmountDelta: verification.actualAmount,
          expectedAmountDelta: action.minAmountOut,
          riskScore: null,
          policyDecision: null,
          displaySummary: `Convert verification failed: ${verification.detail}`,
        };
        await markQuoteUsed(quote.id);
        await saveReceipt(failedReceipt);
        setState((prev) => ({
          ...prev,
          status: 'FAILED',
          trade: finalTrade,
          receipt: failedReceipt,
          error: verification.detail,
        }));
        return;
      }

      const receipt: VeyraReceipt = {
        receiptId,
        planId: action.actionId,
        actionType: 'CONVERT',
        status: 'VERIFIED',
        chainId: action.chainId,
        createdAt: action.createdAt,
        completedAt: Date.now(),
        actualAmountDelta: verification.actualAmount,
        expectedAmountDelta: action.minAmountOut,
        riskScore: null,
        policyDecision: 'PASS',
        displaySummary: `Convert ${finalTrade.from.amount} ${finalTrade.from.currency} → ${finalTrade.to.amount} ${finalTrade.to.currency}`,
      };

      await markQuoteUsed(quote.id);
      await saveReceipt(receipt);
      setState((prev) => ({ ...prev, status: 'VERIFIED', trade: finalTrade, receipt }));
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

      setState((prev) => ({
        ...prev,
        status: 'FAILED',
        error: err instanceof Error ? err.message : 'Convert execution failed',
      }));
    }
  }, []);

  const reset = useCallback(() => { setState({ status: 'PENDING' }); }, []);

  return { state, fetchQuote, executeConvert, reset };
}
