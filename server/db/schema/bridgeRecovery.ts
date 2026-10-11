import {
  bigint,
  integer,
  check,
  index,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { veyraUsers } from './identity.js';

/**
 * Durable server mirror for in-flight bridge recovery.
 *
 * Chain/provider state remains authoritative. This table exists so an
 * authenticated Veyra user can recover an in-flight bridge after browser
 * storage loss or on another device without ever creating a second source burn.
 */
export const bridgeRecoveryCheckpoints = pgTable(
  'bridge_recovery_checkpoints',
  {
    planId:             text('plan_id').primaryKey(),
    ownerUserId:        text('owner_user_id').notNull().references(() => veyraUsers.veyraUserId),
    stage:              text('stage').notNull(),
    burnTxHash:         text('burn_tx_hash').notNull(),
    sourceChainId:      bigint('source_chain_id', { mode: 'number' }).notNull(),
    destinationChainId: bigint('destination_chain_id', { mode: 'number' }).notNull(),
    walletAddress:      text('wallet_address').notNull(),
    recipientAddress:   text('recipient_address').notNull(),
    amountRaw:          numeric('amount_raw', { precision: 38, scale: 0 }).notNull(),
    tokenAddress:       text('token_address').notNull(),
    balanceBeforeRaw:   numeric('balance_before_raw', { precision: 38, scale: 0 }).notNull(),
    attestationMessage: text('attestation_message'),
    attestationSignature: text('attestation_signature'),
    receiveTxHash:      text('receive_tx_hash'),
    createdAt:          timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt:          timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uix_bridge_recovery_burn_tx_hash').on(t.burnTxHash),
    index('ix_bridge_recovery_owner_stage').on(t.ownerUserId, t.stage, t.updatedAt),
    check(
      'chk_bridge_recovery_stage',
      sql`${t.stage} IN ('SOURCE_BROADCAST','SOURCE_CONFIRMED','ATTESTATION_READY','DESTINATION_BROADCAST','VERIFIED')`,
    ),
  ],
);

/**
 * Durable fail-closed claim for the first destination relay submission.
 *
 * There is intentionally no automatic claim expiry: a crash after wallet
 * broadcast can leave the tx hash unknown, and releasing the claim could
 * cause a second receive transaction.
 */
export const bridgeDestinationSubmissionClaims = pgTable(
  'bridge_destination_submission_claims',
  {
    planId: text('plan_id').primaryKey()
      .references(() => bridgeRecoveryCheckpoints.planId),
    ownerUserId: text('owner_user_id').notNull()
      .references(() => veyraUsers.veyraUserId),
    attemptNumber: integer('attempt_number').notNull().default(1),
    receiveTxHash: text('receive_tx_hash'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('ix_destination_submission_owner').on(t.ownerUserId, t.createdAt),
    check('chk_destination_submission_first_attempt', sql`${t.attemptNumber} = 1`),
    check('chk_destination_submission_tx_hash',
      sql`${t.receiveTxHash} IS NULL OR ${t.receiveTxHash} ~ '^0x[0-9a-fA-F]{64}$'`),
  ],
);

/**
 * Append-only event records. PostgreSQL forbids UPDATE and DELETE via trigger
 * in migration 0008, so later recovery logic cannot erase past submissions.
 */
export const bridgeDestinationAttemptEvents = pgTable(
  'bridge_destination_attempt_events',
  {
    eventId: text('event_id').primaryKey(),
    planId: text('plan_id').notNull()
      .references(() => bridgeDestinationSubmissionClaims.planId),
    eventType: text('event_type').notNull(),
    receiveTxHash: text('receive_tx_hash'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uix_destination_attempt_one_event_per_type').on(t.planId, t.eventType),
    check('chk_destination_attempt_event_type',
      sql`${t.eventType} IN ('SUBMISSION_STARTED','BROADCAST_RECORDED')`),
    check('chk_destination_attempt_event_hash',
      sql`(${t.eventType} = 'SUBMISSION_STARTED' AND ${t.receiveTxHash} IS NULL)
        OR (${t.eventType} = 'BROADCAST_RECORDED' AND ${t.receiveTxHash} ~ '^0x[0-9a-fA-F]{64}$')`),
  ],
);

/**
 * Immutable server-verified proof for the first reverted destination receive.
 * A persisted revert DOES NOT itself authorize an additional relay call.
 * A separate future retry-claim gate must consume this proof.
 */
export const bridgeDestinationAttemptResolutions = pgTable(
  'bridge_destination_attempt_resolutions',
  {
    planId: text('plan_id').notNull()
      .references(() => bridgeDestinationSubmissionClaims.planId),
    attemptNumber: integer('attempt_number').notNull(),
    ownerUserId: text('owner_user_id').notNull()
      .references(() => veyraUsers.veyraUserId),
    receiveTxHash: text('receive_tx_hash').notNull(),
    destinationChainId: bigint('destination_chain_id', { mode: 'number' }).notNull(),
    destinationBlockNumber: bigint('destination_block_number', { mode: 'number' }).notNull(),
    destinationBlockHash: text('destination_block_hash').notNull(),
    confirmations: integer('confirmations').notNull(),
    outcome: text('outcome').notNull().default('REVERTED'),
    verifiedAt: timestamp('verified_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.planId, t.attemptNumber] }),
    index('ix_destination_resolution_owner').on(t.ownerUserId, t.verifiedAt),
    check('chk_destination_resolution_attempt', sql`${t.attemptNumber} = 1`),
    check('chk_destination_resolution_outcome', sql`${t.outcome} = 'REVERTED'`),
    check('chk_destination_resolution_hash', sql`${t.receiveTxHash} ~ '^0x[0-9a-fA-F]{64}$'`),
    check('chk_destination_resolution_block_hash', sql`${t.destinationBlockHash} ~ '^0x[0-9a-fA-F]{64}$'`),
    check('chk_destination_resolution_block_number', sql`${t.destinationBlockNumber} >= 0`),
    check('chk_destination_resolution_confirmations', sql`${t.confirmations} >= 12`),
  ],
);

/**
 * Second-attempt claim and separate immutable event history. The first receive
 * hash remains attached to its original checkpoint/ActivityReceipt.
 */
export const bridgeDestinationRetryAttempts = pgTable(
  'bridge_destination_retry_attempts',
  {
    planId: text('plan_id').notNull()
      .references(() => bridgeDestinationSubmissionClaims.planId),
    attemptNumber: integer('attempt_number').notNull().default(2),
    ownerUserId: text('owner_user_id').notNull()
      .references(() => veyraUsers.veyraUserId),
    receiveTxHash: text('receive_tx_hash'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.planId, t.attemptNumber] }),
    index('ix_destination_retry_owner').on(t.ownerUserId, t.createdAt),
    check('chk_destination_retry_attempt_number', sql`${t.attemptNumber} = 2`),
    check('chk_destination_retry_tx_hash',
      sql`${t.receiveTxHash} IS NULL OR ${t.receiveTxHash} ~ '^0x[0-9a-fA-F]{64}$'`),
  ],
);

export const bridgeDestinationRetryEvents = pgTable(
  'bridge_destination_retry_events',
  {
    eventId: text('event_id').primaryKey(),
    planId: text('plan_id').notNull(),
    attemptNumber: integer('attempt_number').notNull(),
    eventType: text('event_type').notNull(),
    receiveTxHash: text('receive_tx_hash'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uix_destination_retry_one_event_per_type')
      .on(t.planId, t.attemptNumber, t.eventType),
    check('chk_destination_retry_event_type',
      sql`${t.eventType} IN ('SUBMISSION_STARTED','BROADCAST_RECORDED')`),
    check('chk_destination_retry_event_hash',
      sql`(${t.eventType} = 'SUBMISSION_STARTED' AND ${t.receiveTxHash} IS NULL)
        OR (${t.eventType} = 'BROADCAST_RECORDED' AND ${t.receiveTxHash} ~ '^0x[0-9a-fA-F]{64}$')`),
  ],
);
