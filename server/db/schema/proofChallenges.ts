import {
  bigint,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import { walletProofSchemeEnum } from './enums.js';
import { veyraUsers } from './identity.js';

export const proofChallengeStatusEnum = pgEnum('proof_challenge_status', [
  'ISSUED',
  'CONSUMED',
  'EXPIRED',
  'REVOKED',
]);

// Single-use wallet ownership challenges. Challenges are immutable after issuance
// except for lifecycle fields (status/consumed_at). A consumed challenge can never
// be replayed to create another wallet binding.
export const proofChallenges = pgTable(
  'proof_challenges',
  {
    challengeId:     text('challenge_id').primaryKey(),
    veyraUserId:     text('veyr_user_id').notNull().references(() => veyraUsers.veyraUserId),
    walletAddress:   text('wallet_address').notNull(),
    chainId:         bigint('chain_id', { mode: 'number' }).notNull(),
    proofScheme:     walletProofSchemeEnum('proof_scheme').notNull(),
    proofVersion:    text('proof_version').notNull(),
    nonce:           text('nonce').notNull(),
    typedData:       jsonb('typed_data'),
    plainMessage:    text('plain_message').notNull(),
    messageHash:     text('message_hash').notNull(),
    issuedAt:        timestamp('issued_at', { withTimezone: true }).notNull(),
    expiresAt:       timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt:      timestamp('consumed_at', { withTimezone: true }),
    status:          proofChallengeStatusEnum('status').notNull().default('ISSUED'),
    createdAt:       timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('ix_proof_challenges_user_issued').on(t.veyraUserId, t.issuedAt),
    index('ix_proof_challenges_wallet_chain').on(t.walletAddress, t.chainId),
    index('ix_proof_challenges_expiry').on(t.status, t.expiresAt),
  ],
);
