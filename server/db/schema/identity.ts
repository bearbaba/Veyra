import {
  bigint,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import {
  linkedIdentityProviderEnum,
  linkedIdentityStatusEnum,
  profileSourceEnum,
  profileVisibilityEnum,
  userStatusEnum,
} from './enums.js';

// ── veyra_users ─────────────────────────────────────────────────────────────
export const veyraUsers = pgTable(
  'veyra_users',
  {
    veyraUserId:         text('veyr_user_id').primaryKey(),
    veyraHandle:         text('veyr_handle').notNull(),
    displayName:         text('display_name').notNull().default(''),
    avatarUrl:           text('avatar_url'),
    bio:                 text('bio').notNull().default(''),
    profileVisibility:   profileVisibilityEnum('profile_visibility').notNull().default('PUBLIC'),
    avatarSource:        profileSourceEnum('avatar_source').notNull().default('VEYRA'),
    displayNameSource:   profileSourceEnum('display_name_source').notNull().default('VEYRA'),
    bioSource:           profileSourceEnum('bio_source').notNull().default('VEYRA'),
    // Incremented atomically by Postgres trigger (amendment 3).
    // mode:'number' avoids BigInt serialization issues in drizzle-kit.
    identityRevision:    bigint('identity_revision', { mode: 'number' }).notNull().default(1),
    status:              userStatusEnum('status').notNull().default('ACTIVE'),
    createdAt:           timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt:           timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt:           timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    // Case-insensitive unique handle — enforced via Postgres function index in supplemental migration.
    // Drizzle records this as a standard unique index; the CI logic is in 0018_supplemental.sql.
    uniqueIndex('uix_veyra_users_handle_ci').on(t.veyraHandle),
    index('ix_veyra_users_status').on(t.status),
  ],
);

// ── handle_history ──────────────────────────────────────────────────────────
export const handleHistory = pgTable(
  'handle_history',
  {
    handleHistoryId: text('handle_history_id').primaryKey(),
    veyraUserId:     text('veyr_user_id').notNull().references(() => veyraUsers.veyraUserId),
    handle:          text('handle').notNull(),
    claimedAt:       timestamp('claimed_at', { withTimezone: true }).notNull(),
    releasedAt:      timestamp('released_at', { withTimezone: true }).notNull(),
    reservedUntil:   timestamp('reserved_until', { withTimezone: true }).notNull(),
    createdAt:       timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('ix_handle_history_handle_reserved').on(t.handle, t.reservedUntil),
    index('ix_handle_history_user_released').on(t.veyraUserId, t.releasedAt),
  ],
);

// ── linked_identities ───────────────────────────────────────────────────────
// external_id is the immutable canonical binding key (amendment 2).
// All mutable display fields (externalHandle etc.) are refresh-only.
export const linkedIdentities = pgTable(
  'linked_identities',
  {
    linkedIdentityId:      text('linked_identity_id').primaryKey(),
    veyraUserId:           text('veyr_user_id').notNull().references(() => veyraUsers.veyraUserId),
    provider:              linkedIdentityProviderEnum('provider').notNull(),
    externalId:            text('external_id').notNull(),
    externalHandle:        text('external_handle'),
    externalDisplayName:   text('external_display_name'),
    externalAvatarUrl:     text('external_avatar_url'),
    externalBio:           text('external_bio'),
    externalMetadata:      jsonb('external_metadata'),
    status:                linkedIdentityStatusEnum('status').notNull().default('ACTIVE'),
    linkedAt:              timestamp('linked_at', { withTimezone: true }).notNull().defaultNow(),
    lastRefreshedAt:       timestamp('last_refreshed_at', { withTimezone: true }),
    revokedAt:             timestamp('revoked_at', { withTimezone: true }),
    createdAt:             timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt:             timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uix_linked_identities_user_provider').on(t.veyraUserId, t.provider),
    uniqueIndex('uix_linked_identities_provider_external').on(t.provider, t.externalId),
    index('ix_linked_identities_external_handle').on(t.provider, t.externalHandle),
  ],
);
