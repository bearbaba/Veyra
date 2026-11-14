import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadCircleServices, validateCircleFilters } from '../core/agent/circleDiscoveryEndpoint.js';

import {
  atomicUsdcToDecimal, normalizeCircleDiscovery, previewServiceSpend,
} from '../core/agent/circleServiceDiscovery.js';

const good = {
  resource: 'https://api.example.com/v1/weather',
  metadata: {
    provider: { name: 'Weather Example', description: 'Forecast data', category: 'WEB_SEARCH_RESEARCH' },
    description: 'Hourly weather',
    supportsCircleGateway: true,
  },
  accepts: [
    { scheme: 'exact', network: 'eip155:8453', asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', amount: '8000' },
  ],
};

afterEach(() => { vi.unstubAllGlobals(); });

describe('Circle public API proxy response', () => {
  it('uses only the fixed Circle endpoint and normalizes server-filtered semantic matches', async () => {
    const fetchMock = vi.fn((_url: RequestInfo | URL) => Promise.resolve(new Response(JSON.stringify({ items: [good] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })));
    vi.stubGlobal('fetch', fetchMock);
    const filters = validateCircleFilters('best realtime coin data', 'FINANCIAL_ANALYSIS', '0.01', 'arc');
    expect(filters).not.toBeNull();
    if (!filters) return;
    const response = await loadCircleServices(filters);
    expect(response.mode).toBe('DISCOVERY_ONLY');
    expect(response.services).toHaveLength(0); // The upstream mock ignored category; local category guard holds.
    const callUrl = fetchMock.mock.calls[0]?.[0];
    expect(typeof callUrl).toBe('string');
    if (typeof callUrl !== 'string') throw new Error('Expected a fixed HTTP URL');
    expect(callUrl).toContain('https://api.circle.com/v2/x402/discovery/resources?');
    expect(new URL(callUrl).searchParams.get('query')).toBe('best realtime coin data');
    expect(new URL(callUrl).searchParams.get('category')).toBe('FINANCIAL_ANALYSIS');
    expect(new URL(callUrl).searchParams.get('maxUsdPrice')).toBe('0.01');
    expect(new URL(callUrl).searchParams.get('network')).toBe('arc');
  });

  it('keeps Circle semantic query matches even when no substring is present', async () => {
    const fetched = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ items: [good] }), { status: 200 })));
    vi.stubGlobal('fetch', fetched);
    const filters = validateCircleFilters('weather api', 'WEB_SEARCH_RESEARCH', '0.01');
    if (!filters) throw new Error('Unexpected filters');
    const result = await loadCircleServices(filters);
    expect(result.services).toHaveLength(1);
    expect(result.services[0]?.priceUsdc).toBe('0.008');
  });
});

describe('Circle marketplace discovery is read only', () => {
  it('normalizes a Circle listing using the canonical USDC address and exact decimals', () => {
    const items = normalizeCircleDiscovery({ items: [good] });
    expect(items).toHaveLength(1);
    expect(items[0]?.priceUsdc).toBe('0.008');
    expect(items[0]?.gateway).toBe(true);
    expect(items[0]?.x402).toBe(true);
    expect(items[0]?.category).toBe('WEB_SEARCH_RESEARCH');
  });

  it('does not infer vanilla x402 support from exact scheme when Circle marks it disabled', () => {
    const listing = {
      ...good,
      metadata: { ...good.metadata, supportsVanillax402: false },
    };
    const item = normalizeCircleDiscovery({ items: [listing] })[0];
    expect(item?.gateway).toBe(true);
    expect(item?.x402).toBe(false);
  });

  it('does not label arbitrary tokens as USDC or present a trusted price', () => {
    const changed = { ...good, accepts: [{ ...good.accepts[0], asset: '0x0000000000000000000000000000000000000001' }] };
    const item = normalizeCircleDiscovery({ items: [changed] })[0];
    expect(item?.amountAtomic).toBeNull();
    expect(item?.priceUsdc).toBeNull();
    expect(previewServiceSpend(item?.amountAtomic ?? null, '1', '1').status).toBe('UNKNOWN_PRICE');
  });

  it('drops non-HTTPS URLs and deduplicates services', () => {
    const bad = { ...good, resource: 'javascript:alert(1)' };
    expect(normalizeCircleDiscovery({ items: [bad, good, good] })).toHaveLength(1);
  });

  it('filters by category, search and maximum quoted USDC', () => {
    expect(normalizeCircleDiscovery({ items: [good] }, { query: 'forecast' })).toHaveLength(1);
    expect(normalizeCircleDiscovery({ items: [good] }, { category: 'CREATIVE' })).toHaveLength(0);
    expect(normalizeCircleDiscovery({ items: [good] }, { maxUsdPrice: '0.007' })).toHaveLength(0);
    expect(normalizeCircleDiscovery({ items: [good] }, { maxUsdPrice: '0.008' })).toHaveLength(1);
  });

  it('uses integer amounts for budget previews, never number floating point', () => {
    expect(atomicUsdcToDecimal('1')).toBe('0.000001');
    expect(atomicUsdcToDecimal('1000001')).toBe('1.000001');
    expect(previewServiceSpend('8000', '3', '0.024')).toEqual({
      status: 'WITHIN_DRAFT_BUDGET', totalUsdc: '0.024',
    });
    expect(previewServiceSpend('8000', '3', '0.023999').status).toBe('OVER_DRAFT_BUDGET');
    expect(previewServiceSpend('8000', '101', '1').status).toBe('INVALID_INPUT');
    expect(previewServiceSpend('8000', '1', '0').status).toBe('INVALID_INPUT');
  });

  it('accepts the additional shopping category seen in Circle live data', () => {
    expect(validateCircleFilters('', 'TRAVEL_SHOPPING', '', 'base')).toMatchObject({
      category: 'TRAVEL_SHOPPING', network: 'base',
    });
    const listing = {
      ...good,
      metadata: { ...good.metadata, provider: { ...good.metadata.provider, category: 'TRAVEL_SHOPPING' } },
    };
    expect(normalizeCircleDiscovery({ items: [listing] }, { category: 'TRAVEL_SHOPPING' })).toHaveLength(1);
  });

  it('rejects unsafe proxy inputs and normalizes valid filters', () => {
    expect(validateCircleFilters('weather', 'CREATIVE', '0.1')).toEqual({
      query: 'weather', category: 'CREATIVE', maxUsdPrice: '0.1', network: '',
    });
    expect(validateCircleFilters(['multi'], '', '')).toBeNull();
    expect(validateCircleFilters('hi', 'UNKNOWN_CATEGORY', '')).toBeNull();
    expect(validateCircleFilters('hi', '', '1001')).toBeNull();
    expect(validateCircleFilters('hi', '', '-1')).toBeNull();
    expect(validateCircleFilters('hi', '', '', 'ethereum;malicious')).toBeNull();
    expect(validateCircleFilters('hi', '', '', ['arc'])).toBeNull();
    expect(validateCircleFilters('x'.repeat(101), '', '')).toBeNull();
  });

  it('supports the alternate resources response without trusting unknown metadata', () => {
    expect(normalizeCircleDiscovery({ resources: [good] })).toHaveLength(1);
    expect(normalizeCircleDiscovery({ items: 'malformed' })).toEqual([]);
  });
});
