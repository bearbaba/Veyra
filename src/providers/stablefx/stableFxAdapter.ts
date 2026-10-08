/**
 * Circle StableFX Adapter — CONVERT (USDC ↔ EURC)
 *
 * TRUST MODEL
 * ───────────
 * - Quote is fetched server-side by the BFF (Circle API key stays on server)
 * - Browser receives quote + Permit2 typedData for EIP-712 signing
 * - The browser signs typedData using the connected wallet (user consent required)
 * - After signing, the browser sends the signature back to the BFF to create the trade
 * - All amounts, addresses, and expiry times come from the Circle quote response
 *   and are treated as PROVIDER_QUOTE provenance (still deterministically validated by pipeline)
 *
 * VERIFIED
 * ────────
 * Source: https://developers.circle.com/stablefx/quickstarts/fx-trade-taker
 * Verified: 2026-10-07
 * Arc Testnet USDC:  0x3600000000000000000000000000000000000000
 * Arc Testnet EURC:  0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a
 * Sandbox API:       https://api-sandbox.circle.com
 */

import { parseUnits, formatUnits, type Address } from 'viem';
import { MANIFEST_CONSTANTS } from '../registry/providerManifest';
import type { ConvertAction } from '../../core/actions/actionSchema';
import { SECURITY_CONFIG } from '../../lib/securityConfig';

// ── Types ────────────────────────────────────────────────────────────────────

export interface StableFxQuoteResponse {
  id: string;
  from: { currency: string; amount: string };
  to: { currency: string; amount: string };
  exchangeRate: string;
  fee: string;
  expiresAt: string; // ISO-8601
  typedData: {
    domain: Record<string, unknown>;
    types: Record<string, unknown>;
    primaryType: string;
    message: Record<string, unknown>;
  };
  fetchedAt: number; // ms — added by BFF
}

export interface StableFxTradeStatus {
  id: string;
  contractTradeId: string;
  status: 'pending_settlement' | 'taker_funded' | 'complete' | 'failed';
  from: { currency: string; amount: string };
  to: { currency: string; amount: string };
}

export type StableFxCurrency = 'USDC' | 'EURC';

// ── Currency → Arc Testnet address map ───────────────────────────────────────
// Imported from manifest constants — never typed from memory

const CURRENCY_ADDRESS: Record<StableFxCurrency, Address> = {
  USDC: MANIFEST_CONSTANTS.ARC_TESTNET_USDC,
  EURC: MANIFEST_CONSTANTS.ARC_TESTNET_EURC,
};

export function currencyToAddress(currency: StableFxCurrency): Address {
  const addr = CURRENCY_ADDRESS[currency];
  if (!addr) throw new Error(`[stableFxAdapter] Unknown currency: ${currency}`);
  return addr;
}

// ERC-20 decimals for both are 6
const STABLEFX_DECIMALS = 6;

// ── Quote fetching (via BFF) ──────────────────────────────────────────────────

export interface StableFxQuoteRequest {
  fromCurrency: StableFxCurrency;
  toCurrency: StableFxCurrency;
  fromAmount: string; // human-readable, e.g. "100.00"
  recipientAddress: Address;
}

export async function fetchStableFxQuote(req: StableFxQuoteRequest): Promise<StableFxQuoteResponse> {
  const res = await fetch('/api/stablefx/quote', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    const err = await res.json() as { error?: string };
    throw new Error(`StableFX quote failed: ${err.error ?? res.status}`);
  }
  const data = await res.json() as { ok: boolean; quote: StableFxQuoteResponse; fetchedAt: number };
  const q = data.quote;
  q.fetchedAt = data.fetchedAt;
  return q;
}

// ── ConvertAction builder ────────────────────────────────────────────────────

/**
 * Build a ConvertAction from a StableFX quote.
 * All amounts come from the Circle quote — they are PROVIDER_QUOTE provenance.
 * minAmountOut applies the configured max slippage.
 */
export function buildConvertActionFromQuote(
  quote: StableFxQuoteResponse,
  fromCurrency: StableFxCurrency,
  toCurrency: StableFxCurrency,
  _walletAddress: Address, // kept for caller ergonomics; ConvertAction schema has no `from` field
): ConvertAction {
  const amountIn = parseUnits(quote.from.amount, STABLEFX_DECIMALS);
  const amountOut = parseUnits(quote.to.amount, STABLEFX_DECIMALS);

  // Apply slippage: minAmountOut = amountOut * (1 - slippage)
  const slippageBps = SECURITY_CONFIG.DEFAULT_MAX_SLIPPAGE_BPS;
  const minAmountOut = (amountOut * BigInt(10000 - slippageBps)) / 10000n;

  // Quote expiry from Circle response, minus the expiry buffer
  const quoteExpiresAt = new Date(quote.expiresAt).getTime() - SECURITY_CONFIG.QUOTE_EXPIRY_BUFFER_MS;

  return {
    actionType: 'CONVERT',
    actionId: crypto.randomUUID(),
    chainId: MANIFEST_CONSTANTS.ARC_TESTNET_CHAIN_ID,
    createdAt: Date.now(),
    provenance: {
      source: 'PROVIDER_QUOTE',
      fetchedAt: quote.fetchedAt,
      quoteId: quote.id,
      providerId: 'circle-stablefx',
    },
    fromTokenAddress: currencyToAddress(fromCurrency).toLowerCase(),
    toTokenAddress: currencyToAddress(toCurrency).toLowerCase(),
    fromTokenDecimals: STABLEFX_DECIMALS,
    toTokenDecimals: STABLEFX_DECIMALS,
    amountIn,
    minAmountOut,
    slippageBps,
    quoteExpiresAt,
    providerId: 'circle-stablefx',
  };
}

// ── Trade creation (browser sends signed Permit2 data via BFF) ───────────────

export interface StableFxTradeRequest {
  quoteId: string;
  walletAddress: Address;
  message: Record<string, unknown>;
  signature: string;
}

export async function createStableFxTrade(req: StableFxTradeRequest): Promise<StableFxTradeStatus> {
  const idempotencyKey = crypto.randomUUID();
  const res = await fetch('/api/stablefx/trade', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      idempotencyKey,
      quoteId: req.quoteId,
      address: req.walletAddress,
      message: req.message,
      signature: req.signature,
    }),
  });
  if (!res.ok) {
    const err = await res.json() as { error?: string };
    throw new Error(`StableFX trade creation failed: ${err.error ?? res.status}`);
  }
  const data = await res.json() as { ok: boolean; trade: StableFxTradeStatus };
  return data.trade;
}

// ── Trade status polling ─────────────────────────────────────────────────────

export async function pollStableFxTrade(tradeId: string): Promise<StableFxTradeStatus> {
  const res = await fetch(`/api/stablefx/trade/${tradeId}`);
  if (!res.ok) {
    throw new Error(`StableFX trade status poll failed: ${res.status}`);
  }
  const data = await res.json() as { ok: boolean; trade: StableFxTradeStatus };
  return data.trade;
}

// ── Simulation (preflight) ───────────────────────────────────────────────────

export interface ConvertSimulationResult {
  ok: boolean;
  amountIn: bigint;
  minAmountOut: bigint;
  quoteRate: string; // human-readable exchange rate
  detail?: string;
}

/**
 * Preflight simulation for a ConvertAction.
 * Verifies the quote is still fresh and the amounts are non-zero.
 * Does not call an RPC node (StableFX is offchain); real simulation
 * would require viem eth_call on the Permit2 contract — added when needed.
 */
export function simulateConvert(action: ConvertAction): ConvertSimulationResult {
  if (action.amountIn <= 0n) {
    return { ok: false, amountIn: action.amountIn, minAmountOut: action.minAmountOut, quoteRate: '0', detail: 'amountIn is zero' };
  }
  if (action.minAmountOut <= 0n) {
    return { ok: false, amountIn: action.amountIn, minAmountOut: action.minAmountOut, quoteRate: '0', detail: 'minAmountOut is zero' };
  }
  const now = Date.now();
  if (action.quoteExpiresAt <= now + SECURITY_CONFIG.QUOTE_EXPIRY_BUFFER_MS) {
    return { ok: false, amountIn: action.amountIn, minAmountOut: action.minAmountOut, quoteRate: '0', detail: 'Quote has expired' };
  }

  // Approximate rate
  const rate = Number(formatUnits(action.minAmountOut, action.toTokenDecimals)) /
               Number(formatUnits(action.amountIn, action.fromTokenDecimals));
  const quoteRate = rate.toFixed(6);

  return { ok: true, amountIn: action.amountIn, minAmountOut: action.minAmountOut, quoteRate };
}
