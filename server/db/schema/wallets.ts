import {
  bigint,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { walletProofSchemeEnum, walletStatusEnum, walletTypeEnum } from './enums.js';
import { veyraUsers } from './identity.js';

// ── wallet_bindings ─────────────────────────────────────────────────────────
// Removals are revocations (status → REVOKED, revoked_at set) — never deletes (amendment 7).
// Postgres trigger fires on INSERT and on status → REVOKED to increment identity_revision.
export const walletBindings = pgTable(
  'wallet_bindings',
  {
    walletId:          text('wallet_id').primaryKey(),
    veyraUserId:       text('veyr_user_id').notNull().references(() => veyraUsers.veyraUserId),
    walletAddress:     text('wallet_address').notNull(),
    chainId:           bigint('chain_id', { mode: 'number' }).notNull(),
    walletType:        walletTypeEnum('wallet_type').notNull().default('EOA'),
    proofScheme:       walletProofSchemeEnum('proof_scheme').notNull(),
    proofVersion:      text('proof_version').notNull(),
    proofChallengeId:  text('proof_challenge_id').notNull(),
    proofNonce:        text('proof_nonce').notNull(),
    proofSignature:    text('proof_signature').notNull(),
    proofMessageHash:  text('proof_message_hash').notNull(),
    issuedAt:          timestamp('issued_at', { withTimezone: true }).notNull(),
    verifiedAt:        timestamp('verified_at', { withTimezone: true }).notNull(),
    revokedAt:         timestamp('revoked_at', { withTimezone: true }),
    status:            walletStatusEnum('status').notNull().default('ACTIVE'),
    createdAt:         timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt:         timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Partial unique index added via supplemental migration (Drizzle doesn't support WHERE in uniqueIndex).
    uniqueIndex('uix_wallet_bindings_address_chain').on(t.walletAddress, t.chainId),
    index('ix_wallet_bindings_user').on(t.veyraUserId),
    index('ix_wallet_bindings_address_lower').on(t.walletAddress, t.chainId),
  ],
);
