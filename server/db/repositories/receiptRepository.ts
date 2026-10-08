/**
 * ReceiptRepository — activity_receipts and execution_events.
 *
 * Invariants (amendment 8):
 * - executionEvents: INSERT only. No update/delete methods exist here.
 * - activity_receipts: status transitions use UPDATE (receipts are mutable).
 * - dedup_key UNIQUE constraint enforced at DB level; this layer catches the PG error.
 */
import { and, eq, inArray, not } from 'drizzle-orm';
import type { DbClient } from '../client.js';
import { activityReceipts, executionEvents } from '../schema/payments.js';
import { newEventId, newReceiptId, isValidClientIntentId, newClientIntentId } from '../ids.js';
import { buildDedupKey, type DedupParams } from '../dedup.js';
import type { receiptStatusEnum, executionEventTypeEnum } from '../schema/enums.js';

export type ReceiptStatus = typeof receiptStatusEnum.enumValues[number];
export type EventType     = typeof executionEventTypeEnum.enumValues[number];

const TERMINAL_STATUSES: ReceiptStatus[] = [
  'COMPLETE', 'FAILED', 'INVALIDATED', 'DUPLICATE_DETECTED',
];

export interface CreateReceiptParams {
  // clientIntentId must be server-issued (amendment 5). If omitted, one is generated here.
  clientIntentId?:      string;
  senderUserId:         string;
  senderWalletId:       string;
  senderAddress:        string;
  senderChainId:        number;
  recipientSnapshotId:  string;
  recipientAddress:     string;
  recipientChainId:     number;
  amountRaw:            string;
  amountDecimals:       number;
  assetId:              string;
  tokenAddress:         string;
  providerId:           string;
  routeId:              string;
  quoteId?:             string;
  environment:          string;
  dedupParams:          Omit<DedupParams, 'clientIntentId'>;
}

/** Creates a new receipt. Validates/generates clientIntentId (amendment 5). */
export async function createReceipt(
  db: DbClient,
  params: CreateReceiptParams,
): Promise<string> {
  // Amendment 5: server issues clientIntentId; validate if caller provided one.
  let clientIntentId = params.clientIntentId;
  if (clientIntentId) {
    if (!isValidClientIntentId(clientIntentId)) {
      throw new Error(
        `Invalid clientIntentId format. Must be a UUID v4 (server-issued). Got: ${clientIntentId}`,
      );
    }
  } else {
    clientIntentId = newClientIntentId();
  }

  const dedupKey = buildDedupKey({ ...params.dedupParams, clientIntentId });
  const receiptId = newReceiptId();

  try {
    await db.insert(activityReceipts).values({
      receiptId,
      clientIntentId,
      senderUserId:        params.senderUserId,
      senderWalletId:      params.senderWalletId,
      senderAddress:       params.senderAddress.toLowerCase(),
      senderChainId:       params.senderChainId,
      recipientSnapshotId: params.recipientSnapshotId,
      recipientAddress:    params.recipientAddress,
      recipientChainId:    params.recipientChainId,
      amountRaw:           params.amountRaw,
      amountDecimals:      params.amountDecimals,
      assetId:             params.assetId,
      tokenAddress:        params.tokenAddress,
      providerId:          params.providerId,
      routeId:             params.routeId,
      quoteId:             params.quoteId,
      dedupKey,
      environment:         params.environment,
      status:              'INTENT_CAPTURED',
      revision:            1,
    });
  } catch (err: unknown) {
    // Postgres unique violation on dedup_key.
    if (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code: string }).code === '23505'
    ) {
      throw new DuplicateSendError(
        `Duplicate send detected. A receipt with the same dedup key already exists.`,
      );
    }
    throw err;
  }

  return receiptId;
}

export class DuplicateSendError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DuplicateSendError';
  }
}

/** Transitions a receipt to a new status. Increments revision. */
export async function transitionReceiptStatus(
  db: DbClient,
  receiptId: string,
  newStatus: ReceiptStatus,
  extra?: Partial<typeof activityReceipts.$inferInsert>,
): Promise<void> {
  const now = new Date();
  await db.update(activityReceipts)
    .set({
      status:    newStatus,
      updatedAt: now,
      revision:  sql`revision + 1`,
      completedAt: newStatus === 'COMPLETE'  ? now : undefined,
      failedAt:    newStatus === 'FAILED'    ? now : undefined,
      ...extra,
    })
    .where(eq(activityReceipts.receiptId, receiptId));
}

/** Appends an execution event. INSERT only — no update/delete (amendment 8). */
export async function appendEvent(
  db: DbClient,
  receiptId: string,
  eventType: EventType,
  actor: 'user' | 'bff' | 'relayer',
  payload: Record<string, unknown> = {},
): Promise<void> {
  await db.insert(executionEvents).values({
    eventId:    newEventId(),
    receiptId,
    eventType,
    actor,
    payload,
  });
}

/** Returns all non-terminal receipts for a sender (for resume on mount). */
export async function getResumableReceipts(db: DbClient, senderUserId: string) {
  return db
    .select()
    .from(activityReceipts)
    .where(
      and(
        eq(activityReceipts.senderUserId, senderUserId),
        not(inArray(activityReceipts.status, TERMINAL_STATUSES)),
      ),
    );
}

/** Returns a receipt by ID with all its execution events. */
export async function getReceiptWithEvents(db: DbClient, receiptId: string) {
  const [receipt] = await db
    .select()
    .from(activityReceipts)
    .where(eq(activityReceipts.receiptId, receiptId));

  if (!receipt) return null;

  const events = await db
    .select()
    .from(executionEvents)
    .where(eq(executionEvents.receiptId, receiptId))
    .orderBy(executionEvents.occurredAt);

  return { receipt, events };
}

import { sql } from 'drizzle-orm';
