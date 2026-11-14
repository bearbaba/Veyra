import { describe, expect, it } from 'vitest';
import {
  buildCircleServiceSpendDraft,
  CIRCLE_SERVICE_DRAFT_TTL_MS,
  getCircleServiceDraftMessage,
  isCircleServiceDraftFresh,
} from '../core/agent/circleServiceSpendDraft.js';
import type { CircleServicePreview } from '../core/agent/circleServiceDiscovery.js';

const service: CircleServicePreview = {
  id: 'https://api.example.com/prices',
  provider: 'Example Crypto API',
  title: 'Crypto Spot Prices',
  description: 'Market data',
  category: 'FINANCIAL_ANALYSIS',
  network: 'eip155:8453',
  amountAtomic: '8000',
  priceUsdc: '0.008',
  gateway: true,
  x402: true,
};

describe('Circle service draft never authorizes payments', () => {
  it('prepares a bounded draft with a five-minute lifetime', () => {
    const result = buildCircleServiceSpendDraft(service, '3', '0.025', 'draft-1', 1700000000000);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft).toMatchObject({
      kind: 'CIRCLE_SERVICE_SPEND_DRAFT',
      status: 'REVIEW_REQUIRED',
      authorization: 'NOT_GRANTED',
      execution: 'DISABLED',
      totalUsdc: '0.024',
      budgetUsdc: '0.025',
      calls: 3,
    });
    expect(result.draft.expiresAt - result.draft.createdAt).toBe(CIRCLE_SERVICE_DRAFT_TTL_MS);
    expect(isCircleServiceDraftFresh(result.draft, 1700000000000 + CIRCLE_SERVICE_DRAFT_TTL_MS - 1)).toBe(true);
    expect(isCircleServiceDraftFresh(result.draft, 1700000000000 + CIRCLE_SERVICE_DRAFT_TTL_MS)).toBe(false);
    expect(getCircleServiceDraftMessage(result.draft)).toMatch(/No payment is authorized or sent/);
  });

  it('rejects spend beyond draft budget', () => {
    expect(buildCircleServiceSpendDraft(service, '4', '0.030', 'draft-2', 1700000000000)).toEqual({
      ok: false, reason: 'BUDGET_EXCEEDED',
    });
  });

  it('refuses unknown USDC quote or malformed call budget', () => {
    expect(buildCircleServiceSpendDraft({ ...service, amountAtomic: null, priceUsdc: null }, '1', '1', 'draft-3', 1700000000000)).toEqual({
      ok: false, reason: 'UNKNOWN_PRICE',
    });
    expect(buildCircleServiceSpendDraft(service, '0', '1', 'draft-4', 1700000000000)).toEqual({
      ok: false, reason: 'INVALID_BUDGET',
    });
    expect(buildCircleServiceSpendDraft(service, '101', '1', 'draft-5', 1700000000000)).toEqual({
      ok: false, reason: 'INVALID_BUDGET',
    });
  });

  it('rejects malformed, non-HTTPS and credential-bearing provider URLs', () => {
    for (const id of ['javascript:alert(1)', 'http://api.example.com', 'https://admin:secret@api.example.com/pay']) {
      expect(buildCircleServiceSpendDraft({ ...service, id }, '1', '1', 'draft-6', 1700000000000)).toEqual({
        ok: false, reason: 'INVALID_SERVICE',
      });
    }
  });

  it('does not treat an altered draft as fresh authorization', () => {
    const result = buildCircleServiceSpendDraft(service, '2', '1', 'draft-7', 1700000000000);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(isCircleServiceDraftFresh({ ...result.draft, authorization: 'NOT_GRANTED', execution: 'DISABLED', expiresAt: result.draft.expiresAt + 1 }, 1700000000000)).toBe(false);
    expect(isCircleServiceDraftFresh({ ...result.draft, status: 'REVIEW_REQUIRED', execution: 'DISABLED' }, 1700000000000)).toBe(true);
  });
});
