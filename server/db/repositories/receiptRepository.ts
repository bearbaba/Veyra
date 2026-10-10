/**
 * ActivityReceipt repository.
 *
 * PostgreSQL is the system of record. Execution events are append-only and
 * every repository-managed status transition is validated and audited in the
 * same transaction.
 */
import {
  and,
  desc,
  eq,
  inArray,
  not,
  sql,
} from 'drizzle-orm';
import type { DbClient } from '../client.js';
import { activityReceipts, executionEvents } from '../schema/payments.js';
import {
  isValidClientIntentId,
  newClientIntentId,
  newEventId,
  newReceiptId,
} from '../ids.js';
import { buildDedupKey, type DedupParams } from '../dedup.js';
import type {
  executionEventTypeEnum,
  receiptStatusEnum,
} from '../schema/enums.js';

export type ReceiptStatus = (typeof receiptStatusEnum.enumValues)[number];
export type EventType = (typeof executionEventTypeEnum.enumValues)[number];

const TERMINAL_STATUSES = new Set<ReceiptStatus>([
  'COMPLETE',
  'FAILED',
  'INVALIDATED',
  'DUPLICATE_DETECTED',
  'CANCELLED',
]);

const ALLOWED_TRANSITIONS: Record<ReceiptStatus, ReadonlySet<ReceiptStatus>> = {
  INTENT_CAPTURED: new Set([
    'QUOTE_RESERVED',
    'PREFLIGHT_PASSED',
    'FAILED',
    'CANCELLED',
    'INVALIDATED',
    'DUPLICATE_DETECTED',
  ]),
  QUOTE_RESERVED: new Set([
    'PREFLIGHT_PASSED',
    'FAILED',
    'CANCELLED',
    'INVALIDATED',
    'DUPLICATE_DETECTED',
  ]),
  PREFLIGHT_PASSED: new Set([
    'SIGNED',
    'FAILED',
    'CANCELLED',
    'INVALIDATED',
  ]),
  SIGNED: new Set(['BROADCAST', 'FAILED', 'INVALIDATED']),
  BROADCAST: new Set([
    'CONFIRMING',
    'SOURCE_CONFIRMED',
    'CONFIRMED',
    'FAILED',
  ]),
  CONFIRMING: new Set(['CONFIRMED', 'FAILED']),
  SOURCE_CONFIRMED: new Set([
    'ATTESTATION_PENDING',
    'RECEIVE_PENDING',
    'FAILED',
  ]),
  ATTESTATION_PENDING: new Set([
    'RECEIVE_PENDING',
    'RECEIVE_FAILED_RETRYABLE',
    'FAILED',
  ]),
  RECEIVE_PENDING: new Set([
    'CONFIRMED',
    'RECEIVE_FAILED_RETRYABLE',
    'FAILED',
  ]),
  RECEIVE_FAILED_RETRYABLE: new Set([
    'RECEIVE_PENDING',
    'FAILED',
    'CANCELLED',
  ]),
  CONFIRMED: new Set(['COMPLETE', 'FAILED']),
  COMPLETE: new Set(),
  FAILED: new Set(),
  DUPLICATE_DETECTED: new Set(),
  INVALIDATED: new Set(),
  CANCELLED: new Set(),
};

export interface CreateReceiptParams {
  clientIntentId?: string;
  senderUserId: string;
  senderWalletId: string;
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
  providerVersion?: string;
  routeId: string;
  quoteId?: string;
  environment: string;
  surface?: 'PAY' | 'AGENT' | 'BRIDGE' | 'REQUEST';
  action?: string;
  routeOption?: Record<string, unknown>;
  policyResult?: Record<string, unknown>;
  preflightResults?: unknown[];
  resumePayload?: Record<string, unknown> | null;
  resumable?: boolean;
  dedupParams: Omit<DedupParams, 'clientIntentId'>;
}

export interface ReceiptTransitionExtra {
  burnTxHash?: string | null;
  burnChainId?: number | null;
  burnBlockNumber?: number | null;
  messageHash?: string | null;
  messageBytes?: string | null;
  attestationNonce?: string | null;
  receiveTxHash?: string | null;
  receiveChainId?: number | null;
  receiveBlockNumber?: number | null;
  failureReason?: string | null;
  resumePayload?: Record<string, unknown> | null;
  resumable?: boolean;
}

export interface ReceiptSyncInput extends ReceiptTransitionExtra {
  receiptId: string;
  revision: number;
  status: ReceiptStatus;
}

export class DuplicateSendError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DuplicateSendError';
  }
}

export class ReceiptTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReceiptTransitionError';
  }
}

export function isReceiptTransitionAllowed(
  from: ReceiptStatus,
  to: ReceiptStatus,
): boolean {
  if (from === to) return true;
  if (TERMINAL_STATUSES.has(from)) return false;
  return ALLOWED_TRANSITIONS[from].has(to);
}

function assertTransitionAllowed(
  from: ReceiptStatus,
  to: ReceiptStatus,
): void {
  if (isReceiptTransitionAllowed(from, to)) return;
  if (TERMINAL_STATUSES.has(from)) {
    throw new ReceiptTransitionError(
      `Receipt is terminal at ${from}; transition to ${to} is forbidden.`,
    );
  }
  throw new ReceiptTransitionError(
    `Invalid receipt transition ${from} -> ${to}.`,
  );
}

function transitionDates(status: ReceiptStatus, now: Date) {
  return {
    completedAt: status === 'COMPLETE' ? now : undefined,
    confirmedAt: status === 'CONFIRMED' ? now : undefined,
    failedAt: status === 'FAILED' ? now : undefined,
    cancelledAt: status === 'CANCELLED' ? now : undefined,
  };
}

function assertOptionalPositiveInteger(
  value: number | null | undefined,
  field: string,
): void {
  if (
    value !== undefined &&
    value !== null &&
    (!Number.isSafeInteger(value) || value < 0)
  ) {
    throw new ReceiptTransitionError(`${field} must be a non-negative safe integer.`);
  }
}

function assertOptionalTxHash(
  value: string | null | undefined,
  field: string,
): void {
  if (
    value !== undefined &&
    value !== null &&
    !/^0x[0-9a-fA-F]{64}$/.test(value)
  ) {
    throw new ReceiptTransitionError(`${field} must be a 32-byte EVM transaction hash.`);
  }
}

function assertUnchangedEvidence<T>(
  current: T | null,
  incoming: T | null | undefined,
  field: string,
  normalize: (value: T) => unknown = (value) => value,
): void {
  if (
    current !== null &&
    incoming !== undefined &&
    incoming !== null &&
    normalize(current) !== normalize(incoming)
  ) {
    throw new ReceiptTransitionError(
      `${field} is immutable once recorded for an ActivityReceipt.`,
    );
  }
}

function assertImmutableExecutionEvidence(
  current: typeof activityReceipts.$inferSelect,
  input: ReceiptSyncInput,
): void {
  assertOptionalTxHash(input.burnTxHash, 'burnTxHash');
  assertOptionalTxHash(input.receiveTxHash, 'receiveTxHash');
  assertOptionalPositiveInteger(input.burnChainId, 'burnChainId');
  assertOptionalPositiveInteger(input.burnBlockNumber, 'burnBlockNumber');
  assertOptionalPositiveInteger(input.receiveChainId, 'receiveChainId');
  assertOptionalPositiveInteger(input.receiveBlockNumber, 'receiveBlockNumber');

  assertUnchangedEvidence(
    current.burnTxHash,
    input.burnTxHash,
    'burnTxHash',
    (value) => value.toLowerCase(),
  );
  assertUnchangedEvidence(current.burnChainId, input.burnChainId, 'burnChainId');
  assertUnchangedEvidence(
    current.burnBlockNumber,
    input.burnBlockNumber,
    'burnBlockNumber',
  );
  assertUnchangedEvidence(
    current.receiveTxHash,
    input.receiveTxHash,
    'receiveTxHash',
    (value) => value.toLowerCase(),
  );
  assertUnchangedEvidence(
    current.receiveChainId,
    input.receiveChainId,
    'receiveChainId',
  );
  assertUnchangedEvidence(
    current.receiveBlockNumber,
    input.receiveBlockNumber,
    'receiveBlockNumber',
  );

  if (current.providerId !== 'cctp-v2-bridge' || current.action !== 'BRIDGE') {
    return;
  }

  const burnTxHash = input.burnTxHash ?? current.burnTxHash;
  const burnChainId = input.burnChainId ?? current.burnChainId;
  const burnBlockNumber =
    input.burnBlockNumber ?? current.burnBlockNumber;
  const receiveTxHash = input.receiveTxHash ?? current.receiveTxHash;
  const receiveChainId = input.receiveChainId ?? current.receiveChainId;
  const receiveBlockNumber =
    input.receiveBlockNumber ?? current.receiveBlockNumber;

  const requiresBurn = new Set<ReceiptStatus>([
    'BROADCAST',
    'SOURCE_CONFIRMED',
    'ATTESTATION_PENDING',
    'RECEIVE_PENDING',
    'RECEIVE_FAILED_RETRYABLE',
    'CONFIRMED',
    'COMPLETE',
  ]);
  if (requiresBurn.has(input.status)) {
    if (!burnTxHash || burnChainId !== current.senderChainId) {
      throw new ReceiptTransitionError(
        'CCTP receipt status requires the immutable source burn hash and source chain.',
      );
    }
  }

  if (
    new Set<ReceiptStatus>([
      'SOURCE_CONFIRMED',
      'ATTESTATION_PENDING',
      'RECEIVE_PENDING',
      'RECEIVE_FAILED_RETRYABLE',
      'CONFIRMED',
      'COMPLETE',
    ]).has(input.status) &&
    burnBlockNumber === null
  ) {
    throw new ReceiptTransitionError(
      'CCTP source-confirmed lifecycle requires burnBlockNumber.',
    );
  }

  if (
    new Set<ReceiptStatus>(['RECEIVE_PENDING', 'CONFIRMED', 'COMPLETE']).has(
      input.status,
    )
  ) {
    if (!receiveTxHash || receiveChainId !== current.recipientChainId) {
      throw new ReceiptTransitionError(
        'CCTP receive lifecycle requires the immutable destination transaction hash and destination chain.',
      );
    }
  }

  if (
    new Set<ReceiptStatus>(['CONFIRMED', 'COMPLETE']).has(input.status) &&
    receiveBlockNumber === null
  ) {
    throw new ReceiptTransitionError(
      'CCTP confirmed lifecycle requires receiveBlockNumber.',
    );
  }

  if (input.resumable === true && !burnTxHash) {
    throw new ReceiptTransitionError(
      'A CCTP ActivityReceipt cannot be resumable before a source burn hash exists.',
    );
  }

  if (input.resumePayload !== undefined && input.resumePayload !== null) {
    const payload = input.resumePayload as Record<string, unknown>;
    const inner =
      payload.payload &&
      typeof payload.payload === 'object' &&
      !Array.isArray(payload.payload)
        ? (payload.payload as Record<string, unknown>)
        : null;
    if (
      payload.provider !== 'cctp-v2-bridge' ||
      payload.version !== 1 ||
      inner?.planId !== current.routeId
    ) {
      throw new ReceiptTransitionError(
        'CCTP resumePayload is not bound to this ActivityReceipt route.',
      );
    }
  }

  if (
    input.status === 'COMPLETE' &&
    (input.resumable === true || input.resumePayload)
  ) {
    throw new ReceiptTransitionError(
      'A COMPLETE ActivityReceipt cannot remain resumable.',
    );
  }
}

function transitionValues(
  status: ReceiptStatus,
  extra: ReceiptTransitionExtra | undefined,
  now: Date,
) {
  return {
    status,
    updatedAt: now,
    lastWrittenAt: now,
    burnTxHash: extra?.burnTxHash,
    burnChainId: extra?.burnChainId,
    burnBlockNumber: extra?.burnBlockNumber,
    messageHash: extra?.messageHash,
    messageBytes: extra?.messageBytes,
    attestationNonce: extra?.attestationNonce,
    receiveTxHash: extra?.receiveTxHash,
    receiveChainId: extra?.receiveChainId,
    receiveBlockNumber: extra?.receiveBlockNumber,
    failureReason: extra?.failureReason,
    resumePayload: extra?.resumePayload,
    resumable: extra?.resumable,
    ...transitionDates(status, now),
  };
}

async function insertTransitionEvent(
  tx: Parameters<Parameters<DbClient['transaction']>[0]>[0],
  receiptId: string,
  actor: 'user' | 'bff' | 'relayer',
  fromStatus: ReceiptStatus,
  toStatus: ReceiptStatus,
  data: Record<string, unknown> = {},
): Promise<void> {
  await tx.insert(executionEvents).values({
    eventId: newEventId(),
    receiptId,
    eventType: 'STATUS_TRANSITION',
    actor,
    payload: {
      fromStatus,
      toStatus,
      ...data,
    },
  });
}

/** Creates the pre-execution system-of-record receipt. */
export async function createReceipt(
  db: DbClient,
  params: CreateReceiptParams,
): Promise<string> {
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
    clientIntentId,
  });
  const receiptId = newReceiptId();

  try {
    await db.transaction(async (tx) => {
      await tx.insert(activityReceipts).values({
        receiptId,
        clientIntentId,
        senderUserId: params.senderUserId,
        senderWalletId: params.senderWalletId,
        senderAddress: params.senderAddress.toLowerCase(),
        senderChainId: params.senderChainId,
        recipientSnapshotId: params.recipientSnapshotId ?? null,
        recipientAddress: params.recipientAddress.toLowerCase(),
        recipientChainId: params.recipientChainId,
        amountRaw: params.amountRaw,
        amountDecimals: params.amountDecimals,
        assetId: params.assetId,
        tokenAddress: params.tokenAddress.toLowerCase(),
        providerId: params.providerId,
        providerVersion: params.providerVersion ?? 'unknown',
        routeId: params.routeId,
        quoteId: params.quoteId,
        environment: params.environment,
        surface: params.surface ?? 'BRIDGE',
        action: params.action ?? 'BRIDGE',
        routeOption: params.routeOption ?? {},
        policyResult: params.policyResult ?? {},
        preflightResults: params.preflightResults ?? [],
        resumePayload: params.resumePayload ?? null,
        resumable: params.resumable ?? false,
        dedupKey,
        status: 'INTENT_CAPTURED',
        revision: 1,
        lastWrittenBy: 'bff',
      });

      await tx.insert(executionEvents).values({
        eventId: newEventId(),
        receiptId,
        eventType: 'INTENT_CAPTURED',
        actor: 'bff',
        payload: {
          routeId: params.routeId,
          providerId: params.providerId,
        },
      });
    });
  } catch (err: unknown) {
    if (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code: string }).code === '23505'
    ) {
      throw new DuplicateSendError(
        'Duplicate send detected. A receipt with the same dedup key already exists.',
      );
    }
    throw err;
  }

  return receiptId;
}

/**
 * Validated status transition. The receipt row and append-only transition event
 * are written atomically.
 */
export async function transitionReceiptStatus(
  db: DbClient,
  receiptId: string,
  newStatus: ReceiptStatus,
  extra?: ReceiptTransitionExtra,
  actor: 'user' | 'bff' | 'relayer' = 'bff',
): Promise<void> {
  await db.transaction(async (tx) => {
    const [current] = await tx
      .select({
        status: activityReceipts.status,
      })
      .from(activityReceipts)
      .where(eq(activityReceipts.receiptId, receiptId))
      .for('update');

    if (!current) {
      throw new ReceiptTransitionError(`Receipt not found: ${receiptId}`);
    }

    assertTransitionAllowed(current.status, newStatus);
    if (current.status === newStatus) return;

    const now = new Date();
    await tx
      .update(activityReceipts)
      .set({
        ...transitionValues(newStatus, extra, now),
        revision: sql`${activityReceipts.revision} + 1`,
        lastWrittenBy: actor,
      })
      .where(eq(activityReceipts.receiptId, receiptId));

    await insertTransitionEvent(
      tx,
      receiptId,
      actor,
      current.status,
      newStatus,
    );
  });
}

/** Append an execution-specific event without mutating prior audit history. */
export async function appendEvent(
  db: DbClient,
  receiptId: string,
  eventType: EventType,
  actor: 'user' | 'bff' | 'relayer',
  payload: Record<string, unknown> = {},
): Promise<void> {
  await db.insert(executionEvents).values({
    eventId: newEventId(),
    receiptId,
    eventType,
    actor,
    payload,
  });
}

/**
 * Revision-aware browser -> BFF reconciliation.
 *
 * Immutable receipt fields are never accepted from the sync payload. Only
 * lifecycle evidence may advance. A stale/equal browser revision gets the
 * server row back as an explicit conflict.
 */
export async function syncReceiptRevision(
  db: DbClient,
  senderUserId: string,
  input: ReceiptSyncInput,
): Promise<
  | { conflict: true; serverRecord: typeof activityReceipts.$inferSelect }
  | { conflict: false; serverRecord: typeof activityReceipts.$inferSelect }
> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(activityReceipts)
      .where(
        and(
          eq(activityReceipts.receiptId, input.receiptId),
          eq(activityReceipts.senderUserId, senderUserId),
        ),
      )
      .for('update');

    if (!current) {
      throw new ReceiptTransitionError('Receipt not found for authenticated user.');
    }

    if (input.revision !== current.revision + 1) {
      return { conflict: true as const, serverRecord: current };
    }

    assertTransitionAllowed(current.status, input.status);
    assertImmutableExecutionEvidence(current, input);

    const now = new Date();
    const [updated] = await tx
      .update(activityReceipts)
      .set({
        ...transitionValues(input.status, input, now),
        revision: input.revision,
        lastWrittenBy: 'browser',
      })
      .where(eq(activityReceipts.receiptId, input.receiptId))
      .returning();

    if (!updated) {
      throw new ReceiptTransitionError('Receipt reconciliation update failed.');
    }

    if (current.status !== input.status) {
      await insertTransitionEvent(
        tx,
        input.receiptId,
        'user',
        current.status,
        input.status,
        { source: 'browser-sync', revision: input.revision },
      );
    }

    return { conflict: false as const, serverRecord: updated };
  });
}

/** All non-terminal receipts for resume/hydration. */
export async function getResumableReceipts(
  db: DbClient,
  senderUserId: string,
) {
  return db
    .select()
    .from(activityReceipts)
    .where(
      and(
        eq(activityReceipts.senderUserId, senderUserId),
        not(
          inArray(activityReceipts.status, [
            'COMPLETE',
            'FAILED',
            'INVALIDATED',
            'DUPLICATE_DETECTED',
            'CANCELLED',
          ]),
        ),
      ),
    )
    .orderBy(desc(activityReceipts.updatedAt));
}

export async function listReceiptsForUser(
  db: DbClient,
  senderUserId: string,
  limit = 100,
) {
  const safeLimit = Math.max(1, Math.min(250, Math.trunc(limit)));
  return db
    .select()
    .from(activityReceipts)
    .where(eq(activityReceipts.senderUserId, senderUserId))
    .orderBy(desc(activityReceipts.updatedAt))
    .limit(safeLimit);
}

export async function getReceiptForUser(
  db: DbClient,
  senderUserId: string,
  receiptId: string,
) {
  const [receipt] = await db
    .select()
    .from(activityReceipts)
    .where(
      and(
        eq(activityReceipts.senderUserId, senderUserId),
        eq(activityReceipts.receiptId, receiptId),
      ),
    )
    .limit(1);

  return receipt ?? null;
}

export async function getReceiptByRouteIdForUser(
  db: DbClient,
  senderUserId: string,
  routeId: string,
) {
  const [receipt] = await db
    .select()
    .from(activityReceipts)
    .where(
      and(
        eq(activityReceipts.senderUserId, senderUserId),
        eq(activityReceipts.routeId, routeId),
      ),
    )
    .orderBy(desc(activityReceipts.updatedAt))
    .limit(1);

  return receipt ?? null;
}

/** Returns a receipt by ID with all append-only execution events. */
export async function getReceiptWithEvents(
  db: DbClient,
  receiptId: string,
) {
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
