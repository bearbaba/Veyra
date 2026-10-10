import {
  bigint,
  boolean,
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  integer,
} from 'drizzle-orm/pg-core';
import {
  executionEventTypeEnum,
  intentStatusEnum,
  intentSurfaceEnum,
  quoteStatusEnum,
  receiptStatusEnum,
  revisionTriggerEnum,
} from './enums.js';
import { identitySnapshots } from './snapshots.js';
import { veyraUsers } from './identity.js';
import { walletBindings } from './wallets.js';

// ── activity_receipts ───────────────────────────────────────────────────────
// dedup_key covers 9 axes (amendment 4: environment; amendment 5: server-issued clientIntentId).
export const activityReceipts = pgTable(
  'activity_receipts',
  {
    receiptId:           text('receipt_id').primaryKey(),
    clientIntentId:      text('client_intent_id').notNull().unique(),
    senderUserId:        text('sender_user_id').notNull().references(() => veyraUsers.veyraUserId),
    senderWalletId:      text('sender_wallet_id').notNull().references(() => walletBindings.walletId),
    senderAddress:       text('sender_address').notNull(),
    senderChainId:       bigint('sender_chain_id', { mode: 'number' }).notNull(),
    recipientSnapshotId: text('recipient_snapshot_id').references(() => identitySnapshots.snapshotId),
    recipientAddress:    text('recipient_address').notNull(),
    recipientChainId:    bigint('recipient_chain_id', { mode: 'number' }).notNull(),
    amountRaw:           numeric('amount_raw', { precision: 38, scale: 0 }).notNull(),
    amountDecimals:      integer('amount_decimals').notNull(),
    assetId:             text('asset_id').notNull(),
    tokenAddress:        text('token_address').notNull(),
    providerId:          text('provider_id').notNull(),
    providerVersion:     text('provider_version').notNull().default('unknown'),
    routeId:             text('route_id').notNull(),
    quoteId:             text('quote_id'),
    surface:             text('surface').notNull().default('BRIDGE'),
    action:              text('action').notNull().default('BRIDGE'),
    routeOption:         jsonb('route_option').notNull().$defaultFn(() => ({})),
    policyResult:        jsonb('policy_result').notNull().$defaultFn(() => ({})),
    preflightResults:    jsonb('preflight_results').notNull().$defaultFn(() => ([])),
    resumePayload:       jsonb('resume_payload'),
    resumable:           boolean('resumable').notNull().default(false),
    lastWrittenBy:       text('last_written_by').notNull().default('bff'),
    lastWrittenAt:       timestamp('last_written_at', { withTimezone: true }).notNull().defaultNow(),
    // SHA-256 of 9-axis composite (amendment 4: environment included).
    dedupKey:            text('dedup_key').notNull().unique(),
    // Bridge-specific (nullable for same-chain payments)
    burnTxHash:          text('burn_tx_hash'),
    burnChainId:         bigint('burn_chain_id', { mode: 'number' }),
    burnBlockNumber:     bigint('burn_block_number', { mode: 'number' }),
    messageHash:         text('message_hash'),
    messageBytes:        text('message_bytes'),
    attestationNonce:    text('attestation_nonce'),
    receiveTxHash:       text('receive_tx_hash'),
    receiveChainId:      bigint('receive_chain_id', { mode: 'number' }),
    receiveBlockNumber:  bigint('receive_block_number', { mode: 'number' }),
    environment:         text('environment').notNull().default('testnet'),
    status:              receiptStatusEnum('status').notNull().default('INTENT_CAPTURED'),
    revision:            bigint('revision', { mode: 'number' }).notNull().default(1),
    createdAt:           timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt:           timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt:         timestamp('completed_at', { withTimezone: true }),
    confirmedAt:         timestamp('confirmed_at', { withTimezone: true }),
    failedAt:            timestamp('failed_at', { withTimezone: true }),
    cancelledAt:         timestamp('cancelled_at', { withTimezone: true }),
    failureReason:       text('failure_reason'),
  },
  (t) => [
    index('ix_activity_receipts_sender_status').on(t.senderUserId, t.status),
    index('ix_activity_receipts_dedup').on(t.dedupKey),
    index('ix_activity_receipts_relay_pending').on(t.status, t.updatedAt),
    index('ix_activity_receipts_env').on(t.environment, t.senderUserId),
    index('ix_activity_receipts_route_status').on(t.routeId, t.status),
    index('ix_activity_receipts_resumable').on(t.senderUserId, t.resumable, t.updatedAt),
  ],
);

// ── execution_events ────────────────────────────────────────────────────────
// Append-only audit log. UPDATE/DELETE blocked by Postgres trigger (amendment 8).
export const executionEvents = pgTable(
  'execution_events',
  {
    eventId:    text('event_id').primaryKey(),
    receiptId:  text('receipt_id').notNull().references(() => activityReceipts.receiptId),
    eventType:  executionEventTypeEnum('event_type').notNull(),
    actor:      text('actor'),
    payload:    jsonb('payload').notNull().$defaultFn(() => ({})),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('ix_execution_events_receipt_time').on(t.receiptId, t.occurredAt),
    index('ix_execution_events_type_time').on(t.eventType, t.occurredAt),
  ],
);

// ── identity_revisions ──────────────────────────────────────────────────────
// Append-only audit log. UPDATE/DELETE blocked by Postgres trigger (amendment 8).
export const identityRevisions = pgTable(
  'identity_revisions',
  {
    revisionId:      text('revision_id').primaryKey(),
    veyraUserId:     text('veyr_user_id').notNull().references(() => veyraUsers.veyraUserId),
    revisionNumber:  bigint('revision_number', { mode: 'number' }).notNull(),
    trigger:         revisionTriggerEnum('trigger').notNull(),
    detail:          jsonb('detail').notNull().$defaultFn(() => ({})),
    occurredAt:      timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('ix_identity_revisions_user_time').on(t.veyraUserId, t.occurredAt),
  ],
);

// ── route_quotes ──────────────────────────────────────────────────────────
export const routeQuotes = pgTable(
  'route_quotes',
  {
    quoteId:             text('quote_id').primaryKey(),
    providerId:          text('provider_id').notNull(),
    routeId:             text('route_id').notNull(),
    sourceChainId:       bigint('source_chain_id', { mode: 'number' }).notNull(),
    destinationChainId:  bigint('destination_chain_id', { mode: 'number' }).notNull(),
    sourceToken:         text('source_token').notNull(),
    destinationToken:    text('destination_token').notNull(),
    amountInRaw:         numeric('amount_in_raw', { precision: 38, scale: 0 }).notNull(),
    amountOutRaw:        numeric('amount_out_raw', { precision: 38, scale: 0 }).notNull(),
    feeRaw:              numeric('fee_raw', { precision: 38, scale: 0 }).notNull(),
    feeToken:            text('fee_token').notNull(),
    estimatedArrivalS:   integer('estimated_arrival_s').notNull(),
    providerExpiresAt:   timestamp('provider_expires_at', { withTimezone: true }).notNull(),
    veyraExpiresAt:      timestamp('veyra_ttl_expires_at', { withTimezone: true }).notNull(),
    status:              quoteStatusEnum('status').notNull().default('AVAILABLE'),
    rawQuote:            jsonb('raw_quote').notNull(),
    createdAt:           timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt:           timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('ix_route_quotes_route_status').on(t.routeId, t.status, t.veyraExpiresAt),
    index('ix_route_quotes_expiry_sweep').on(t.veyraExpiresAt),
  ],
);

// ── intents ──────────────────────────────────────────────────────────────────
export const intents = pgTable(
  'intents',
  {
    intentId:       text('intent_id').primaryKey(),
    clientIntentId: text('client_intent_id').notNull().unique(),
    veyraUserId:    text('veyr_user_id').notNull().references(() => veyraUsers.veyraUserId),
    surface:        intentSurfaceEnum('surface').notNull(),
    rawInput:       text('raw_input'),
    parsedAction:   jsonb('parsed_action').notNull(),
    recipientInput: text('recipient_input'),
    amountRaw:      numeric('amount_raw', { precision: 38, scale: 0 }),
    assetId:        text('asset_id'),
    status:         intentStatusEnum('status').notNull().default('PENDING'),
    receiptId:      text('receipt_id').references(() => activityReceipts.receiptId),
    policyResult:   jsonb('policy_result'),
    createdAt:      timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt:      timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('ix_intents_user_time').on(t.veyraUserId, t.createdAt),
  ],
);
