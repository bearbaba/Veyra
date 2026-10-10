/**
 * ReceiptRepository — activity_receipts and execution_events.
 *
 * Invariants (amendment 8):
 * - executionEvents: INSERT only. No update/delete methods exist here.
 * - activity_receipts: status transitions use UPDATE (receipts are mutable).
 * - dedup_key UNIQUE constraint enforced at DB level; this layer catches the PG error.
 */
import { and, desc, eq, inArray, not, or, sql } from 'drizzle-orm';
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
  recipientSnapshotId?: string | null;
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

export interface ActivityReceiptSyncInput {
  receiptId: string;
  clientIntentId: string;
  localRevision: number;
  actionType: string;
  surface: string;
  senderAddress: string;
  senderChainId: number;
  recipientSnapshotId?: string | null;
  recipientAddress: string;
  recipientChainId: number;
  amountRaw: string;
  amountDecimals: number;
  assetId: string;
  tokenAddress: string;
  providerId: string;
  routeId: string;
  quoteId?: string;
  environment: string;
  status: ReceiptStatus;
  executionTxHash?: string;
  executionBlock?: number;
  actualAmountRaw?: string | null;
  balanceBeforeRaw?: string | null;
  verifiedBalanceAfter?: string | null;
  riskScore?: number | null;
  policyDecision?: string | null;
  displaySummary?: string | null;
  burnTxHash?: string;
  burnChainId?: number;
  burnBlockNumber?: number;
  receiveTxHash?: string;
  receiveChainId?: number;
  receiveBlockNumber?: number;
  failureReason?: string | null;
  createdAt?: number;
  completedAt?: number;
}

export class ReceiptSyncConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReceiptSyncConflictError';
  }
}

const RECEIPT_STATUS_RANK: Record<ReceiptStatus, number> = {
  INTENT_CAPTURED: 0,
  QUOTE_RESERVED: 1,
  PREFLIGHT_PASSED: 2,
  SIGNED: 3,
  BROADCAST: 4,
  CONFIRMING: 5,
  CONFIRMED: 6,
  RECEIVE_PENDING: 7,
  RECEIVE_FAILED_RETRYABLE: 8,
  COMPLETE: 100,
  FAILED: 100,
  DUPLICATE_DETECTED: 100,
  INVALIDATED: 100,
};

function isTerminalStatus(status: ReceiptStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export function reconcileReceiptStatus(
  serverStatus: ReceiptStatus,
  incomingStatus: ReceiptStatus,
): ReceiptStatus {
  if (isTerminalStatus(serverStatus)) return serverStatus;
  if (isTerminalStatus(incomingStatus)) return incomingStatus;
  return RECEIPT_STATUS_RANK[incomingStatus] >= RECEIPT_STATUS_RANK[serverStatus]
    ? incomingStatus
    : serverStatus;
}

function normalized(value: string | null | undefined): string | null {
  return value?.trim().toLowerCase() || null;
}

function assertImmutableReceiptMatch(
  existing: typeof activityReceipts.$inferSelect,
  input: ActivityReceiptSyncInput,
): void {
  const mismatches = [
    existing.clientIntentId !== input.clientIntentId ? 'clientIntentId' : null,
    normalized(existing.senderAddress) !== normalized(input.senderAddress)
      ? 'senderAddress'
      : null,
    existing.senderChainId !== input.senderChainId ? 'senderChainId' : null,
    (existing.recipientSnapshotId ?? null) !== (input.recipientSnapshotId ?? null)
      ? 'recipientSnapshotId'
      : null,
    normalized(existing.recipientAddress) !== normalized(input.recipientAddress)
      ? 'recipientAddress'
      : null,
    existing.recipientChainId !== input.recipientChainId
      ? 'recipientChainId'
      : null,
    existing.amountRaw !== input.amountRaw ? 'amountRaw' : null,
    existing.amountDecimals !== input.amountDecimals ? 'amountDecimals' : null,
    normalized(existing.assetId) !== normalized(input.assetId) ? 'assetId' : null,
    normalized(existing.tokenAddress) !== normalized(input.tokenAddress)
      ? 'tokenAddress'
      : null,
    existing.providerId !== input.providerId ? 'providerId' : null,
    existing.routeId !== input.routeId ? 'routeId' : null,
    existing.actionType !== input.actionType ? 'actionType' : null,
    existing.planId !== input.clientIntentId ? 'planId' : null,
  ].filter((value): value is string => value !== null);

  if (mismatches.length > 0) {
    throw new ReceiptSyncConflictError(
      `Receipt immutable fields changed: ${mismatches.join(', ')}`,
    );
  }
}

export interface ActivityReceiptSyncResult {
  conflict: boolean;
  record: typeof activityReceipts.$inferSelect;
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

  const dedupKey = buildDedupKey({
    ...params.dedupParams,
    recipientSnapshotId: params.recipientSnapshotId ?? null,
    recipientAddress: params.recipientAddress,
    clientIntentId,
  });
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

export async function syncActivityReceipt(
  db: DbClient,
  ownerUserId: string,
  senderWalletId: string,
  input: ActivityReceiptSyncInput,
): Promise<ActivityReceiptSyncResult> {
  if (!isValidClientIntentId(input.clientIntentId)) {
    throw new ReceiptSyncConflictError('clientIntentId must be a UUID v4');
  }
  if (
    !input.receiptId.trim() ||
    !Number.isSafeInteger(input.localRevision) ||
    input.localRevision < 1
  ) {
    throw new ReceiptSyncConflictError(
      'receiptId and a positive localRevision are required',
    );
  }

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(activityReceipts)
      .where(
        or(
          eq(activityReceipts.receiptId, input.receiptId),
          eq(activityReceipts.clientIntentId, input.clientIntentId),
        ),
      )
      .limit(1)
      .for('update');

    if (existing) {
      if (existing.senderUserId !== ownerUserId) {
        throw new ReceiptSyncConflictError(
          'Receipt belongs to another Veyra user',
        );
      }
      if (existing.receiptId !== input.receiptId) {
        throw new ReceiptSyncConflictError(
          'clientIntentId is already bound to another receiptId',
        );
      }

      assertImmutableReceiptMatch(existing, input);

      if (existing.revision >= input.localRevision) {
        return { conflict: true, record: existing };
      }

      const status = reconcileReceiptStatus(existing.status, input.status);
      const now = new Date();
      const completedAt =
        input.completedAt !== undefined
          ? new Date(input.completedAt)
          : status === 'COMPLETE'
            ? existing.completedAt ?? now
            : existing.completedAt;
      const failedAt =
        status === 'FAILED' ? existing.failedAt ?? now : existing.failedAt;

      const [updated] = await tx
        .update(activityReceipts)
        .set({
          status,
          revision: input.localRevision,
          updatedAt: now,
          executionTxHash:
            input.executionTxHash ?? existing.executionTxHash,
          executionBlock: input.executionBlock ?? existing.executionBlock,
          actualAmountRaw: input.actualAmountRaw ?? existing.actualAmountRaw,
          balanceBeforeRaw: input.balanceBeforeRaw ?? existing.balanceBeforeRaw,
          verifiedBalanceAfter:
            input.verifiedBalanceAfter ?? existing.verifiedBalanceAfter,
          riskScore: input.riskScore ?? existing.riskScore,
          policyDecision: input.policyDecision ?? existing.policyDecision,
          displaySummary: input.displaySummary ?? existing.displaySummary,
          burnTxHash: input.burnTxHash ?? existing.burnTxHash,
          burnChainId: input.burnChainId ?? existing.burnChainId,
          burnBlockNumber:
            input.burnBlockNumber ?? existing.burnBlockNumber,
          receiveTxHash: input.receiveTxHash ?? existing.receiveTxHash,
          receiveChainId: input.receiveChainId ?? existing.receiveChainId,
          receiveBlockNumber:
            input.receiveBlockNumber ?? existing.receiveBlockNumber,
          failureReason: input.failureReason ?? existing.failureReason,
          completedAt,
          failedAt,
        })
        .where(eq(activityReceipts.receiptId, existing.receiptId))
        .returning();

      if (!updated) {
        throw new ReceiptSyncConflictError('Receipt update did not return a row');
      }

      await tx.insert(executionEvents).values({
        eventId: newEventId(),
        receiptId: updated.receiptId,
        eventType: 'RECEIPT_SYNCED',
        actor: 'bff',
        payload: {
          fromStatus: existing.status,
          toStatus: updated.status,
          localRevision: input.localRevision,
        },
      });

      return { conflict: false, record: updated };
    }

    const dedupKey = buildDedupKey({
      environment: input.environment,
      senderAddress: input.senderAddress,
      recipientSnapshotId: input.recipientSnapshotId ?? null,
      recipientAddress: input.recipientAddress,
      amountRaw: input.amountRaw,
      assetId: input.assetId,
      sourceChainId: input.senderChainId,
      destinationChainId: input.recipientChainId,
      providerId: input.providerId,
      clientIntentId: input.clientIntentId,
    });

    const createdAt =
      input.createdAt !== undefined ? new Date(input.createdAt) : new Date();
    const completedAt =
      input.completedAt !== undefined
        ? new Date(input.completedAt)
        : input.status === 'COMPLETE'
          ? new Date()
          : undefined;
    const failedAt = input.status === 'FAILED' ? new Date() : undefined;

    const [inserted] = await tx
      .insert(activityReceipts)
      .values({
        receiptId: input.receiptId,
        clientIntentId: input.clientIntentId,
        senderUserId: ownerUserId,
        senderWalletId,
        senderAddress: input.senderAddress.toLowerCase(),
        senderChainId: input.senderChainId,
        recipientSnapshotId: input.recipientSnapshotId ?? null,
        recipientAddress: input.recipientAddress.toLowerCase(),
        recipientChainId: input.recipientChainId,
        amountRaw: input.amountRaw,
        amountDecimals: input.amountDecimals,
        assetId: input.assetId.toLowerCase(),
        tokenAddress: input.tokenAddress.toLowerCase(),
        providerId: input.providerId,
        routeId: input.routeId,
        quoteId: input.quoteId,
        dedupKey,
        environment: input.environment,
        actionType: input.actionType,
        surface: input.surface,
        planId: input.clientIntentId,
        executionTxHash: input.executionTxHash,
        executionBlock: input.executionBlock,
        actualAmountRaw: input.actualAmountRaw ?? null,
        balanceBeforeRaw: input.balanceBeforeRaw ?? null,
        verifiedBalanceAfter: input.verifiedBalanceAfter ?? null,
        riskScore: input.riskScore ?? null,
        policyDecision: input.policyDecision ?? null,
        displaySummary: input.displaySummary ?? null,
        burnTxHash: input.burnTxHash,
        burnChainId: input.burnChainId,
        burnBlockNumber: input.burnBlockNumber,
        receiveTxHash: input.receiveTxHash,
        receiveChainId: input.receiveChainId,
        receiveBlockNumber: input.receiveBlockNumber,
        failureReason: input.failureReason ?? null,
        status: input.status,
        revision: input.localRevision,
        createdAt,
        completedAt,
        failedAt,
      })
      .returning();

    if (!inserted) {
      throw new ReceiptSyncConflictError('Receipt insert did not return a row');
    }

    await tx.insert(executionEvents).values({
      eventId: newEventId(),
      receiptId: inserted.receiptId,
      eventType: 'RECEIPT_SYNCED',
      actor: 'bff',
      payload: {
        fromStatus: null,
        toStatus: inserted.status,
        localRevision: input.localRevision,
      },
    });

    return { conflict: false, record: inserted };
  });
}

export async function getActivityReceiptsForUser(
  db: DbClient,
  ownerUserId: string,
  limit = 100,
) {
  const boundedLimit = Math.min(Math.max(Math.trunc(limit), 1), 200);
  return db
    .select()
    .from(activityReceipts)
    .where(eq(activityReceipts.senderUserId, ownerUserId))
    .orderBy(desc(activityReceipts.createdAt))
    .limit(boundedLimit);
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

