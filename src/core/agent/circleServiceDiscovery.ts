/**
 * Circle public x402 Discovery: read-only, untrusted marketplace metadata.
 *
 * This module deliberately has no wallet, signer or payment interface.
 * All quoted amounts are verified against Veyra's canonical USDC registry.
 */
import { getUsdc } from '../../onchain-facts.js';

export const CIRCLE_DISCOVERY_CATEGORIES = [
  'SOCIAL_INTELLIGENCE',
  'FINANCIAL_ANALYSIS',
  'WEB_SEARCH_RESEARCH',
  'PREDICTION_MARKETS',
  'CREATIVE',
  'INFRASTRUCTURE',
] as const;

export type CircleServiceCategory = typeof CIRCLE_DISCOVERY_CATEGORIES[number];

export interface CircleServicePreview {
  id: string;
  provider: string;
  title: string;
  description: string;
  category: string;
  network: string;
  /** Untrusted displayed price, independently checked against canonical USDC. */
  amountAtomic: string | null;
  priceUsdc: string | null;
  gateway: boolean;
  x402: boolean;
}

export interface CircleDiscoveryFilters {
  query?: string;
  category?: string;
  maxUsdPrice?: string;
}

export interface ServiceSpendPreview {
  status: 'WITHIN_DRAFT_BUDGET' | 'OVER_DRAFT_BUDGET' | 'UNKNOWN_PRICE' | 'INVALID_INPUT';
  totalUsdc: string | null;
}

function record(raw: unknown): Record<string, unknown> | null {
  return raw !== null && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : null;
}

function safeText(value: unknown, max = 160): string {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '';
}

function safeHttpsUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 600) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.username === '' && url.password === '' && url.hostname.length > 3
      ? url.href
      : null;
  } catch {
    return null;
  }
}

/** Converts integer atomic USDC to fixed-point display, without Number rounding. */
export function atomicUsdcToDecimal(amount: string): string | null {
  if (!/^(0|[1-9]\d{0,24})$/.test(amount)) return null;
  const atoms = BigInt(amount);
  const whole = atoms / 1_000_000n;
  const fraction = (atoms % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  return fraction ? String(whole) + '.' + fraction : String(whole);
}

function parseUsdcToAtomic(amount: string): bigint | null {
  if (!/^(0|[1-9]\d{0,10})(?:\.\d{1,6})?$/.test(amount)) return null;
  const [whole, fraction = ''] = amount.split('.');
  return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0') || '0');
}

function verifiedUsdcQuote(raw: unknown): { amount: string; network: string } | null {
  const quote = record(raw);
  if (!quote || typeof quote.network !== 'string' || !/^eip155:\d{1,10}$/.test(quote.network)) return null;
  const chainId = Number(quote.network.slice(7));
  const usdc = getUsdc(chainId);
  if (!usdc || usdc.decimals !== 6 || typeof quote.asset !== 'string') return null;
  if (quote.asset.toLowerCase() !== usdc.address.toLowerCase()) return null;
  const amount = quote.amount ?? quote.maxAmountRequired;
  if (typeof amount !== 'string' || atomicUsdcToDecimal(amount) === null) return null;
  return { amount, network: quote.network };
}

function normalizeEntry(raw: unknown): CircleServicePreview | null {
  const entry = record(raw);
  if (!entry) return null;
  const id = safeHttpsUrl(entry.resource);
  if (!id) return null;
  const meta = record(entry.metadata);
  const providerRecord = record(meta?.provider);
  const provider = safeText(providerRecord?.name ?? meta?.provider ?? entry.serviceName, 70) || new URL(id).hostname;
  const title = safeText(meta?.description ?? entry.description ?? entry.serviceName, 120) || new URL(id).pathname.slice(0, 120);
  const description = safeText(providerRecord?.description ?? entry.description ?? meta?.description, 240) || 'Paid API endpoint';
  const category = safeText(providerRecord?.category ?? meta?.category, 60) || 'OTHER';
  const quotes = Array.isArray(entry.accepts) ? entry.accepts.slice(0, 30) : [];
  const knownQuotes = quotes.map(verifiedUsdcQuote).filter((v): v is { amount: string; network: string } => v !== null);
  knownQuotes.sort((a, b) => {
    const aAmount = BigInt(a.amount), bAmount = BigInt(b.amount);
    return aAmount < bAmount ? -1 : aAmount > bAmount ? 1 : 0;
  });
  const cheapest = knownQuotes[0];
  const network = cheapest?.network ?? safeText(record(quotes[0])?.network, 55) || 'Network not verified';
  const gateway = meta?.supportsCircleGateway === true
    || quotes.some((q) => record(q)?.scheme === 'GatewayWalletBatched');
  const x402 = meta?.supportsVanillax402 === true || quotes.some((q) => record(q)?.scheme === 'exact');
  return {
    id, provider, title, description, category, network,
    amountAtomic: cheapest?.amount ?? null,
    priceUsdc: cheapest ? atomicUsdcToDecimal(cheapest.amount) : null,
    gateway,
    x402,
  };
}

/** Untrusted Circle response -> bounded, sanitized cards. Never executed as tools. */
export function normalizeCircleDiscovery(
  payload: unknown,
  filters: CircleDiscoveryFilters = {},
): CircleServicePreview[] {
  const data = record(payload);
  const items = Array.isArray(data?.items) ? data.items : Array.isArray(data?.resources) ? data.resources : [];
  const query = (filters.query ?? '').trim().toLowerCase();
  const category = (filters.category ?? '').trim().toUpperCase();
  const max = filters.maxUsdPrice ? parseUsdcToAtomic(filters.maxUsdPrice) : null;
  const seen = new Set<string>();
  const output: CircleServicePreview[] = [];
  for (const raw of items.slice(0, 250)) {
    const service = normalizeEntry(raw);
    if (!service || seen.has(service.id)) continue;
    const haystack = [service.provider, service.title, service.description, service.category, service.id].join(' ').toLowerCase();
    if (query && !haystack.includes(query)) continue;
    if (category && service.category !== category) continue;
    if (max !== null && (service.amountAtomic === null || BigInt(service.amountAtomic) > max)) continue;
    seen.add(service.id);
    output.push(service);
    if (output.length === 18) break;
  }
  return output;
}

/** Local draft check only; not an allowance, authorization, or executable quote. */
export function previewServiceSpend(
  amountAtomic: string | null,
  calls: string,
  budgetUsdc: string,
): ServiceSpendPreview {
  if (!/^[1-9]\d{0,2}$/.test(calls) || Number(calls) > 100) {
    return { status: 'INVALID_INPUT', totalUsdc: null };
  }
  const budget = parseUsdcToAtomic(budgetUsdc);
  if (budget === null || budget <= 0n) return { status: 'INVALID_INPUT', totalUsdc: null };
  if (amountAtomic === null || atomicUsdcToDecimal(amountAtomic) === null) {
    return { status: 'UNKNOWN_PRICE', totalUsdc: null };
  }
  const total = BigInt(amountAtomic) * BigInt(calls);
  return {
    status: total <= budget ? 'WITHIN_DRAFT_BUDGET' : 'OVER_DRAFT_BUDGET',
    totalUsdc: atomicUsdcToDecimal(String(total)),
  };
}
