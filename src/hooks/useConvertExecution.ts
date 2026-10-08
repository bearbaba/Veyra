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
import type { Address } from 'viem';

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
    try {
      const signature = await signTypedData(quote.typedData);

      setState((prev) => ({ ...prev, status: 'BROADCASTING' }));

      // ConvertAction has no `from` field — walletAddress is passed explicitly as a param
      const trade = await createStableFxTrade({
        quoteId: quote.id,
        walletAddress,
        message: quote.typedData.message,
        signature,
      });

      setState((prev) => ({ ...prev, status: 'VERIFYING', trade }));

      // Poll for completion (up to 60s)
      let finalTrade = trade;
      for (let i = 0; i < 12; i++) {
        await new Promise((r) => setTimeout(r, 5000));
        try {
          finalTrade = await pollStableFxTrade(trade.id);
          if (finalTrade.status === 'complete' || finalTrade.status === 'taker_funded') break;
          if (finalTrade.status === 'failed') {
            setState((prev) => ({ ...prev, status: 'FAILED', trade: finalTrade, error: 'Trade failed on Circle' }));
            return;
          }
        } catch {
          // Transient poll error — continue
        }
      }

      const receiptId = generatePlanReceiptId();
      const receipt: VeyraReceipt = {
        receiptId,
        actionType: 'CONVERT',
        status: finalTrade.status === 'complete' ? 'VERIFIED' : 'PENDING',
        chainId: action.chainId,
        createdAt: action.createdAt,
        completedAt: Date.now(),
        actualAmountDelta: action.minAmountOut,
        expectedAmountDelta: action.minAmountOut,
        riskScore: null,
        policyDecision: null,
        displaySummary: `Convert ${finalTrade.from.amount} ${finalTrade.from.currency} → ${finalTrade.to.amount} ${finalTrade.to.currency}`,
      };

      setState((prev) => ({ ...prev, status: 'VERIFIED', trade: finalTrade, receipt }));
    } catch (err) {
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
