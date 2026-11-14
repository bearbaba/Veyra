/**
 * One read-only Circle Discovery integration used by Express and Vercel.
 * No arbitrary upstream URLs, cookies, credentials, wallet or signing actions.
 */
import {
  CIRCLE_DISCOVERY_CATEGORIES,
  normalizeCircleDiscovery,
  type CircleServicePreview,
} from './circleServiceDiscovery.js';

export interface ValidatedCircleFilters {
  query: string;
  category: string;
  maxUsdPrice: string;
}

export interface CircleDiscoveryResult {
  ok: true;
  mode: 'DISCOVERY_ONLY';
  source: 'Circle public x402 Discovery API';
  asOf: string;
  services: CircleServicePreview[];
}

export function validateCircleFilters(
  inputQuery: unknown,
  inputCategory: unknown,
  inputMaxUsdPrice: unknown,
): ValidatedCircleFilters | null {
  const query = inputQuery ?? '';
  const category = inputCategory ?? '';
  const maxUsdPrice = inputMaxUsdPrice ?? '';
  if (typeof query !== 'string' || query.length > 100
    || typeof category !== 'string'
    || (category !== '' && !CIRCLE_DISCOVERY_CATEGORIES.includes(category as typeof CIRCLE_DISCOVERY_CATEGORIES[number]))
    || typeof maxUsdPrice !== 'string'
    || (maxUsdPrice !== '' && (!/^(0|[1-9]\d{0,3})(?:\.\d{1,6})?$/.test(maxUsdPrice) || Number(maxUsdPrice) > 1000))) {
    return null;
  }
  return { query: query.trim(), category, maxUsdPrice };
}

export async function loadCircleServices(filters: ValidatedCircleFilters): Promise<CircleDiscoveryResult> {
  const params = new URLSearchParams({ limit: '100', type: 'http' });
  if (filters.query) params.set('query', filters.query);
  if (filters.category) params.set('category', filters.category);
  if (filters.maxUsdPrice) params.set('maxUsdPrice', filters.maxUsdPrice);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7000);
  try {
    const response = await fetch('https://api.circle.com/v2/x402/discovery/resources?' + params.toString(), {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error('Circle discovery unavailable: HTTP ' + response.status);
    const payload: unknown = await response.json();
    return {
      ok: true,
      mode: 'DISCOVERY_ONLY',
      source: 'Circle public x402 Discovery API',
      asOf: new Date().toISOString(),
      services: normalizeCircleDiscovery(payload, {
        query: filters.query,
        category: filters.category,
        maxUsdPrice: filters.maxUsdPrice,
      }),
    };
  } finally {
    clearTimeout(timeout);
  }
}
