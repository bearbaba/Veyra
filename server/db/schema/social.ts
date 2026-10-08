import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { blockStatusEnum, connectionStatusEnum, followStatusEnum } from './enums.js';
import { veyraUsers } from './identity.js';

// ── social_follows ──────────────────────────────────────────────────────────
// Append-only directional edges. Block always overrides follow (amendment 6).
// Follow grants ZERO financial permissions.
export const socialFollows = pgTable(
  'social_follows',
  {
    followId:       text('follow_id').primaryKey(),
    followerUserId: text('follower_user_id').notNull().references(() => veyraUsers.veyraUserId),
    followeeUserId: text('followee_user_id').notNull().references(() => veyraUsers.veyraUserId),
    status:         followStatusEnum('status').notNull(),
    createdAt:      timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Self-follow CHECK and other constraints added via supplemental migration.
    index('ix_social_follows_pair_time').on(t.followerUserId, t.followeeUserId, t.createdAt),
    index('ix_social_follows_followee').on(t.followeeUserId, t.createdAt),
  ],
);

// ── social_connections ──────────────────────────────────────────────────────
// Symmetric friendship lifecycle. Canonical pair: user_a < user_b (lexicographic).
export const socialConnections = pgTable(
  'social_connections',
  {
    connectionId:    text('connection_id').primaryKey(),
    userAId:         text('user_a_id').notNull().references(() => veyraUsers.veyraUserId),
    userBId:         text('user_b_id').notNull().references(() => veyraUsers.veyraUserId),
    initiatorUserId: text('initiator_user_id').notNull(),
    status:          connectionStatusEnum('status').notNull(),
    createdAt:       timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Self and canonical-order CHECKs added via supplemental migration.
    index('ix_social_connections_pair_time').on(t.userAId, t.userBId, t.createdAt),
    index('ix_social_connections_user_b').on(t.userBId, t.createdAt),
    index('ix_social_connections_connected_a').on(t.userAId, t.status, t.createdAt),
    index('ix_social_connections_connected_b').on(t.userBId, t.status, t.createdAt),
  ],
);

// ── social_blocks ───────────────────────────────────────────────────────────
// Block ALWAYS overrides follow and connection (amendment 6).
export const socialBlocks = pgTable(
  'social_blocks',
  {
    blockId:        text('block_id').primaryKey(),
    blockerUserId:  text('blocker_user_id').notNull().references(() => veyraUsers.veyraUserId),
    blockedUserId:  text('blocked_user_id').notNull().references(() => veyraUsers.veyraUserId),
    status:         blockStatusEnum('status').notNull(),
    createdAt:      timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('ix_social_blocks_pair_time').on(t.blockerUserId, t.blockedUserId, t.createdAt),
    index('ix_social_blocks_blocked').on(t.blockedUserId, t.createdAt),
    index('ix_social_blocks_active_blocker').on(t.blockerUserId, t.blockedUserId, t.status, t.createdAt),
  ],
);
