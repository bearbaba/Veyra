import {
  bigint,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import { preferenceVisibilityEnum } from './enums.js';
import { veyraUsers } from './identity.js';
import { walletBindings } from './wallets.js';

// ── identity_snapshots ──────────────────────────────────────────────────────
// Append-only frozen snapshots. verifySnapshot() must check identityRevision before confirm.
export const identitySnapshots = pgTable(
  'identity_snapshots',
  {
    snapshotId:         text('snapshot_id').primaryKey(),
    veyraUserId:        text('veyr_user_id').notNull().references(() => veyraUsers.veyraUserId),
    veyraHandle:        text('veyr_handle').notNull(),
    displayName:        text('display_name').notNull(),
    avatarUrl:          text('avatar_url'),
    identityRevision:   bigint('identity_revision', { mode: 'number' }).notNull(),
    resolvedWallets:    jsonb('resolved_wallets').notNull(),
    receivePreference:  jsonb('receive_preference').notNull(),
    frozenAt:           timestamp('frozen_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt:          timestamp('expires_at', { withTimezone: true }).notNull(),
    verifiedAt:         timestamp('verified_at', { withTimezone: true }),
    invalidatedAt:      timestamp('invalidated_at', { withTimezone: true }),
    invalidationReason: text('invalidation_reason'),
  },
  (t) => [
    index('ix_identity_snapshots_user_frozen').on(t.veyraUserId, t.frozenAt),
    index('ix_identity_snapshots_expiry').on(t.expiresAt),
  ],
);

// ── receive_preferences ─────────────────────────────────────────────────────
export const receivePreferences = pgTable(
  'receive_preferences',
  {
    preferenceId:      text('preference_id').primaryKey(),
    veyraUserId:       text('veyr_user_id').notNull().unique().references(() => veyraUsers.veyraUserId),
    preferredTokenId:  text('preferred_token_id').notNull().default('usdc'),
    preferredChainId:  bigint('preferred_chain_id', { mode: 'number' }).notNull(),
    primaryWalletId:   text('primary_wallet_id').notNull().references(() => walletBindings.walletId),
    alternativeRoutes: jsonb('alternative_routes').notNull().$defaultFn(() => []),
    visibility:        preferenceVisibilityEnum('visibility').notNull().default('FRIENDS_ONLY'),
    createdAt:         timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt:         timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
);
