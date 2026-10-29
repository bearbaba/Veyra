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

import { parseUnits, formatUnits, getAddress, isAddress, zeroAddress, type Address } from 'viem';
import { MANIFEST_CONSTANTS } from '../registry/providerManifest';
import type { ConvertAction } from '../../core/actions/actionSchema';
import { SECURITY_CONFIG } from '../../lib/securityConfig';
import { activeSignedIdentityToken } from '../../lib/api/liveIdentitySession';

// ── Types ────────────────────────────────────────────────────────────────────

export interface StableFxQuoteResponse {
  id: string;
  from: { currency: string; amount: string };
  to: { currency: string; amount: string };
  /** Provider's quoted FX rate; never calculate execution amounts from a float. */
  rate: string | number;
  fee: { currency: string; amount: string };
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
  status: 'pending_settlement' | 'taker_funded' | 'complete' | 'completed' | 'failed';
  from: { currency: string; amount: string };
  to: { currency: string; amount: string };
}

/** Circle API uses "completed" in the taker quickstart; older adapters
 * used "complete". Neither is proof of user-owned on-chain receipt alone. */
export function isStableFxProviderTradeComplete(trade:StableFxTradeStatus):boolean {
  return trade.status==='completed' || trade.status==='complete';
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

/** Only an in-memory session for the currently connected verified wallet can
 * authorize financial API calls; switching wallets clears this session. */
export function stableFxSignedSessionHeaders():Record<string,string>{
  const token=activeSignedIdentityToken();
  if(!token || token.length>8192 || /[^\x21-\x7e]/.test(token))
    throw Error('Connect and sign into your Veyra ID before requesting a Swap.');
  return {Authorization:`Bearer ${token}`};
}

// ── Quote fetching (via BFF) ──────────────────────────────────────────────────

export interface StableFxQuoteRequest {
  fromCurrency: StableFxCurrency;
  toCurrency: StableFxCurrency;
  fromAmount: string; // human-readable, e.g. "100.00"
  recipientAddress: Address;
}

/** A Circle response is untrusted until its signed payload is bound to this wallet,
 * exact chain, quote, input token and amount. No provider-owned calldata is accepted.
 * This is NOT an execution approval: spender bytecode, balance, allowance and
 * provider entitlement still need separate checks before enabling Swap.
 */
export function validateStableFxQuoteResponse(
  raw: unknown, request: StableFxQuoteRequest, fetchedAt: number,
): StableFxQuoteResponse {
  const object=(v:unknown,field:string):Record<string,unknown>=>{
    if(!v||typeof v!=='object'||Array.isArray(v))throw Error(`StableFX ${field} is not an object.`);
    return v as Record<string,unknown>;
  };
  const nonEmpty=(v:unknown,field:string):string=>{
    if(typeof v!=='string'||!v.trim()||v.length>256)throw Error(`StableFX ${field} is missing or invalid.`);
    return v;
  };
  const units=(v:unknown,field:string):bigint=>{
    if(typeof v!=='string'||!/^\d{1,18}(?:\.\d{1,6})?$/.test(v))throw Error(`StableFX ${field} is not a six-decimal amount.`);
    const amount=parseUnits(v,6);
    if(amount<0n)throw Error(`StableFX ${field} is negative.`);
    return amount;
  };
  const unitsBase=(v:unknown,field:string):bigint=>{
    if(!((typeof v==='string'&&/^\d+$/.test(v)) ||
         (typeof v==='number'&&Number.isSafeInteger(v)&&v>=0)))
      throw Error(`StableFX ${field} is not a safe unsigned base-unit amount.`);
    try{return BigInt(v);}catch{
      throw Error(`StableFX ${field} is malformed.`);
    }
  };
  const address=(v:unknown,field:string):string=>{
    if(typeof v!=='string'||!isAddress(v)||getAddress(v)===zeroAddress)throw Error(`StableFX ${field} is an invalid address.`);
    return getAddress(v).toLowerCase();
  };
  if(request.fromCurrency===request.toCurrency)throw Error('StableFX input/output currencies must differ.');
  const expectedIn=units(request.fromAmount,'requested amount');
  if(expectedIn===0n)throw Error('StableFX requested amount must be positive.');
  const recipient=address(request.recipientAddress,'recipient');
  const q=object(raw,'quote');
  const id=nonEmpty(q.id,'quote ID');
  if(!/^[a-zA-Z0-9_-]{8,100}$/.test(id))throw Error('StableFX quote ID is invalid.');
  const from=object(q.from,'from'), to=object(q.to,'to');
  if(from.currency!==request.fromCurrency||to.currency!==request.toCurrency)
    throw Error('StableFX quote currencies differ from the requested pair.');
  const fromAmount=units(from.amount,'input amount'),toAmount=units(to.amount,'output amount');
  if(fromAmount!==expectedIn||toAmount===0n)throw Error('StableFX quote amounts differ from the request.');
  const fee=object(q.fee,'fee');
  if(fee.currency!==request.fromCurrency||units(fee.amount,'fee amount')<0n)
    throw Error('StableFX fee is not denominated in the input currency.');
  const quotedRate=q.rate;
  if(!((typeof quotedRate==='string'&&/^\d+(?:\.\d+)?$/.test(quotedRate))||
       (typeof quotedRate==='number'&&Number.isFinite(quotedRate)))||
     Number(quotedRate)<=0)throw Error('StableFX provider rate is invalid.');
  const expiry=Date.parse(nonEmpty(q.expiresAt,'expiry'));
  if(!Number.isFinite(expiry)||expiry-Date.now()<=SECURITY_CONFIG.QUOTE_EXPIRY_BUFFER_MS)
    throw Error('StableFX quote expired or is too close to expiry.');
  if(!Number.isFinite(fetchedAt)||fetchedAt>Date.now()+5_000||Date.now()-fetchedAt>60_000)
    throw Error('StableFX quote fetch timestamp is stale.');
  const typed=object(q.typedData,'signed payload');
  const domain=object(typed.domain,'domain');
  if(domain.name!=='Permit2'||Number(domain.chainId)!==MANIFEST_CONSTANTS.ARC_TESTNET_CHAIN_ID)
    throw Error('StableFX quote requested a different EIP-712 domain or chain.');
  const permit2='0x000000000022D473030F116dDEE9F6B43aC78BA3';
  if(address(domain.verifyingContract,'Permit2 verifier')!==permit2.toLowerCase())
    throw Error('StableFX quote Permit2 verifier differs from the pinned contract.');
  if(typed.primaryType!=='PermitWitnessTransferFrom'||!typed.types||typeof typed.types!=='object')
    throw Error('StableFX quote EIP-712 message type is unsupported.');
  const message=object(typed.message,'signed message');
  const permitted=object(message.permitted,'permitted token');
  if(address(permitted.token,'permitted asset')!==currencyToAddress(request.fromCurrency).toLowerCase())
    throw Error('StableFX quote is signing a different token.');
  if((typeof permitted.amount!=='string'&&typeof permitted.amount!=='number')||
    (typeof permitted.amount==='number'&&!Number.isSafeInteger(permitted.amount)))
    throw Error('StableFX quote permission amount has an invalid or unsafe type.');
  let permission:bigint;
  try {permission=BigInt(permitted.amount);}catch{throw Error('StableFX quote permission amount is invalid.');}
  if(permission!==expectedIn)
    throw Error('StableFX quote permission is not bound to the reviewed amount.');
  address(message.spender,'spender');
  const witness=object(message.witness,'witness');
  if(address(witness.recipient,'witness recipient')!==recipient)
    throw Error('StableFX quote would deliver funds to a different wallet.');
  // Circle's signed consideration binds the FX quote, pair, and both amounts.
  // Do not sign a superficially valid Permit2 allowance for a different trade.
  const consideration=object(witness.consideration,'trade consideration');
  const base=address(consideration.base,'base asset');
  const quoteToken=address(consideration.quote,'quote asset');
  if(base!==currencyToAddress('EURC').toLowerCase() ||
     quoteToken!==currencyToAddress('USDC').toLowerCase())
    throw Error('StableFX signed consideration references another token pair.');
  const signedBase=unitsBase(consideration.baseAmount,'base amount');
  const signedQuote=unitsBase(consideration.quoteAmount,'quote amount');
  const expectedBase=request.fromCurrency==='EURC'?fromAmount:toAmount;
  const expectedQuote=request.fromCurrency==='USDC'?fromAmount:toAmount;
  if(signedBase!==expectedBase || signedQuote!==expectedQuote)
    throw Error('StableFX signed consideration amounts do not match the quote.');
  const normalizedQuoteId=(value:string)=>value.toLowerCase().replace(/^0x0*/,'').replace(/-/g,'');
  const signedQuoteId=nonEmpty(consideration.quoteId,'witness quote ID');
  if(normalizedQuoteId(signedQuoteId)!==normalizedQuoteId(id))
    throw Error('StableFX signed witness belongs to another quote.');
  const deadline=Number(message.deadline);
  if(!Number.isSafeInteger(deadline)||deadline*1000<=Date.now()+SECURITY_CONFIG.QUOTE_EXPIRY_BUFFER_MS)
    throw Error('StableFX Permit2 signature has expired.');
  const normal={
    id, from:{currency:request.fromCurrency,amount:from.amount as string},
    to:{currency:request.toCurrency,amount:to.amount as string},
    rate:quotedRate,
    fee:{currency:request.fromCurrency,amount:fee.amount as string},
    expiresAt:q.expiresAt as string,typedData:{
      domain,types:typed.types as Record<string,unknown>,
      primaryType:typed.primaryType,message,
    }, fetchedAt,
  } satisfies StableFxQuoteResponse;
  return normal;
}

export async function fetchStableFxQuote(req: StableFxQuoteRequest): Promise<StableFxQuoteResponse> {
  const res = await fetch('/api/stablefx/quote', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...stableFxSignedSessionHeaders() },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    const err = await res.json() as { error?: string };
    throw new Error(`StableFX quote failed: ${err.error ?? res.status}`);
  }
  const data = await res.json() as { ok?: boolean; quote?: unknown; fetchedAt?: unknown };
  if(data.ok!==true||!Number.isFinite(data.fetchedAt)||!data.quote)
    throw Error('StableFX BFF returned no validated provider quote.');
  return validateStableFxQuoteResponse(data.quote,req,data.fetchedAt as number);
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
  /** Fixed per attempt. Must be persisted before the remote trade submission. */
  idempotencyKey: string;
  walletAddress: Address;
  message: Record<string, unknown>;
  signature: string;
}

export async function createStableFxTrade(req: StableFxTradeRequest): Promise<StableFxTradeStatus> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(req.idempotencyKey)) {
    throw new Error('StableFX trade idempotency key is invalid.');
  }
  const idempotencyKey = req.idempotencyKey;
  const res = await fetch('/api/stablefx/trade', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...stableFxSignedSessionHeaders() },
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
  const data = await res.json() as { ok?: boolean; trade?: StableFxTradeStatus };
  if (data.ok !== true || !data.trade || typeof data.trade.id !== 'string' ||
      !data.trade.id || !data.trade.contractTradeId) {
    throw new Error('StableFX trade response is missing its settlement identifier.');
  }
  return data.trade;
}

// ── Explicit taker funding (second Permit2 signature) ────────────────────────

export interface StableFxFundingPresign {
  tradeId: string;
  contractTradeId: string;
  typedData: StableFxQuoteResponse['typedData'];
  deliverables?: Array<{ currency: string; amount: string }>;
  fetchedAt: number;
}

export function validateStableFxFundingPresign(
  raw: unknown,
  trade: StableFxTradeStatus,
): StableFxFundingPresign {
  const obj=(x:unknown):Record<string,unknown>=>{
    if(!x || typeof x!=='object' || Array.isArray(x)) throw Error('StableFX funding response is malformed.');
    return x as Record<string,unknown>;
  };
  const response=obj(raw);
  if(response.ok!==true || response.tradeId!==trade.id || String(response.contractTradeId)!==String(trade.contractTradeId))
    throw Error('StableFX funding presign is for a different trade.');
  const typed=obj(response.typedData);
  const domain=obj(typed.domain);
  const message=obj(typed.message);
  const permitted=obj(message.permitted);
  const witness=obj(message.witness);
  if(domain.name!=='Permit2' ||
     Number(domain.chainId)!==MANIFEST_CONSTANTS.ARC_TESTNET_CHAIN_ID ||
     typeof domain.verifyingContract!=='string' ||
     domain.verifyingContract.toLowerCase()!=='0x000000000022d473030f116ddee9f6b43ac78ba3' ||
     typed.primaryType!=='PermitWitnessTransferFrom' ||
     !typed.types || typeof typed.types!=='object') {
    throw Error('StableFX funding EIP-712 chain or Permit2 domain is invalid.');
  }
  if(String(witness.id)!==String(trade.contractTradeId))
    throw Error('StableFX funding witness references a different trade.');
  if(trade.from.currency!=='USDC' && trade.from.currency!=='EURC')
    throw Error('StableFX funding input currency is not supported.');
  const source=currencyToAddress(trade.from.currency);
  if(typeof permitted.token!=='string' || !isAddress(permitted.token) ||
     getAddress(permitted.token)!==getAddress(source))
    throw Error('StableFX funding would spend a different token.');
  const amount=parseUnits(trade.from.amount,6);
  if(amount<=0n || typeof permitted.amount!=='string' && typeof permitted.amount!=='number')
    throw Error('StableFX funding amount is invalid.');
  let permittedAmount:bigint;
  try {
    if(typeof permitted.amount==='number' && !Number.isSafeInteger(permitted.amount))
      throw Error('Unsafe funding amount.');
    permittedAmount=BigInt(permitted.amount);
  } catch { throw Error('StableFX funding permission amount is not exact.'); }
  if(permittedAmount!==amount)throw Error('StableFX funding permission differs from the reviewed input.');
  if(typeof message.spender!=='string'||!isAddress(message.spender)||
    getAddress(message.spender)===zeroAddress)
    throw Error('StableFX funding spender address is invalid.');
  if(!Number.isSafeInteger(Number(message.deadline))||
     Number(message.deadline)*1000 < Date.now()+SECURITY_CONFIG.QUOTE_EXPIRY_BUFFER_MS)
    throw Error('StableFX funding signature expired or expires too soon.');
  const fetchedAt=response.fetchedAt;
  if(typeof fetchedAt!=='number'||!Number.isFinite(fetchedAt)||
     fetchedAt>Date.now()+5000||Date.now()-fetchedAt>60_000)
    throw Error('StableFX funding presign is stale.');
  return {
    tradeId:trade.id,
    contractTradeId:trade.contractTradeId,
    typedData:{
      domain:domain,
      types:typed.types as Record<string,unknown>,
      primaryType:'PermitWitnessTransferFrom',
      message,
    },
    fetchedAt,
  };
}

export async function fetchStableFxFundingPresign(
  trade:StableFxTradeStatus,
):Promise<StableFxFundingPresign> {
  if(!/^[1-9]\d{0,40}$/.test(trade.contractTradeId))
    throw Error('StableFX trade has no valid contract trade identifier.');
  const res=await fetch('/api/stablefx/funding/presign',{
    method:'POST',headers:{'Content-Type':'application/json',...stableFxSignedSessionHeaders()},
    credentials:'same-origin',
    body:JSON.stringify({tradeId:trade.id,contractTradeId:trade.contractTradeId}),
  });
  if(!res.ok)throw Error('StableFX funding presign unavailable (HTTP '+res.status+').');
  return validateStableFxFundingPresign(await res.json(),trade);
}

/** Submission is intentionally non-retrying; a timeout is an unknown funding result. */
export async function submitStableFxFunding(
  trade:StableFxTradeStatus, presign:StableFxFundingPresign, signature:string,
):Promise<void>{
  if(presign.tradeId!==trade.id || presign.contractTradeId!==trade.contractTradeId ||
     !/^0x[0-9a-f]{130}$/i.test(signature))
    throw Error('StableFX funding signature or trade binding is invalid.');
  const res=await fetch('/api/stablefx/funding/submit',{
    method:'POST',headers:{'Content-Type':'application/json',...stableFxSignedSessionHeaders()},
    credentials:'same-origin',
    body:JSON.stringify({
      tradeId:trade.id,contractTradeId:trade.contractTradeId,
      permit2:presign.typedData.message,signature,
    }),
  });
  if(!res.ok)throw Error('StableFX funding submission is not confirmed; reconcile before retry (HTTP '+res.status+').');
  const payload=await res.json() as {ok?:boolean;fundingSubmitted?:boolean;status?:string};
  if(payload.ok!==true || payload.fundingSubmitted!==true || payload.status!=='SETTLEMENT_PENDING')
    throw Error('StableFX funding response did not confirm a pending settlement.');
}

// ── Trade status polling ─────────────────────────────────────────────────────

export async function pollStableFxTrade(tradeId: string): Promise<StableFxTradeStatus> {
  const res = await fetch(`/api/stablefx/trade/${tradeId}`,{headers:stableFxSignedSessionHeaders()});
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
