import {
  bigint,
  check,
  index,
  numeric,
  pgTable,
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
