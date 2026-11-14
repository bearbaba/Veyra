/**
 * Non-executable spending draft, created from Circle catalog metadata.
 * The draft is an informational snapshot, not permission to move funds.
 */
import {
  previewServiceSpend,
  type CircleServicePreview,
} from './circleServiceDiscovery.js';

export const CIRCLE_SERVICE_DRAFT_TTL_MS = 5 * 60 * 1000;

export interface CircleServiceSpendDraft {
  kind: 'CIRCLE_SERVICE_SPEND_DRAFT';
  version: 1;
  draftId: string;
  source: 'CIRCLE_DISCOVERY';
  status: 'REVIEW_REQUIRED';
  authorization: 'NOT_GRANTED';
  execution: 'DISABLED';
  createdAt: number;
  expiresAt: number;
  serviceId: string;
  provider: string;
  serviceTitle: string;
  network: string;
  unitPriceUsdc: string;
  calls: number;
  budgetUsdc: string;
  totalUsdc: string;
  gateway: boolean;
  x402: boolean;
}

export type CircleDraftBuildResult =
  | { ok: true; draft: CircleServiceSpendDraft }
  | { ok: false; reason: 'INVALID_SERVICE' | 'UNKNOWN_PRICE' | 'INVALID_BUDGET' | 'BUDGET_EXCEEDED' };

function validServiceUrl(value: string): boolean {
  if (typeof value !== 'string' || value.length > 600) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function buildCircleServiceSpendDraft(
  service: CircleServicePreview,
  calls: string,
  budgetUsdc: string,
  draftId: string,
  nowMs: number,
): CircleDraftBuildResult {
  if (!service || !validServiceUrl(service.id)
    || typeof service.provider !== 'string' || !service.provider.trim()
    || typeof service.title !== 'string' || !service.title.trim()
    || typeof draftId !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(draftId)
    || !Number.isSafeInteger(nowMs) || nowMs < 0) {
    return { ok: false, reason: 'INVALID_SERVICE' };
  }

  const preview = previewServiceSpend(service.amountAtomic, calls, budgetUsdc);
  if (preview.status === 'UNKNOWN_PRICE') return { ok: false, reason: 'UNKNOWN_PRICE' };
  if (preview.status === 'INVALID_INPUT') return { ok: false, reason: 'INVALID_BUDGET' };
  if (preview.status === 'OVER_DRAFT_BUDGET') return { ok: false, reason: 'BUDGET_EXCEEDED' };
  if (!preview.totalUsdc || !service.priceUsdc) return { ok: false, reason: 'UNKNOWN_PRICE' };

  return {
    ok: true,
    draft: {
      kind: 'CIRCLE_SERVICE_SPEND_DRAFT',
      version: 1,
      draftId,
      source: 'CIRCLE_DISCOVERY',
      status: 'REVIEW_REQUIRED',
      authorization: 'NOT_GRANTED',
      execution: 'DISABLED',
      createdAt: nowMs,
      expiresAt: nowMs + CIRCLE_SERVICE_DRAFT_TTL_MS,
      serviceId: service.id,
      provider: service.provider.slice(0, 70),
      serviceTitle: service.title.slice(0, 120),
      network: service.network.slice(0, 55),
      unitPriceUsdc: service.priceUsdc,
      calls: Number(calls),
      budgetUsdc,
      totalUsdc: preview.totalUsdc,
      gateway: service.gateway,
      x402: service.x402,
    },
  };
}

export function isCircleServiceDraftFresh(
  draft: CircleServiceSpendDraft,
  atMs: number,
): boolean {
  return draft.kind === 'CIRCLE_SERVICE_SPEND_DRAFT'
    && draft.version === 1
    && draft.status === 'REVIEW_REQUIRED'
    && draft.authorization === 'NOT_GRANTED'
    && draft.execution === 'DISABLED'
    && Number.isSafeInteger(atMs)
    && Number.isSafeInteger(draft.createdAt)
    && Number.isSafeInteger(draft.expiresAt)
    && draft.expiresAt - draft.createdAt === CIRCLE_SERVICE_DRAFT_TTL_MS
    && atMs >= draft.createdAt
    && atMs < draft.expiresAt;
}

export function getCircleServiceDraftMessage(draft: CircleServiceSpendDraft): string {
  return `Prepared a non-executable service plan for ${draft.provider}. Estimated ${draft.totalUsdc} USDC for ${draft.calls} request(s), with a draft budget of ${draft.budgetUsdc} USDC. No payment is authorized or sent. Catalog pricing and merchant terms require fresh verification.`;
}
