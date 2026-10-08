// SCHEMA-FORWARD: Phase 9.
// These tables are created in Phase 1 but NO application code may reference them
// until Phase 9 is explicitly approved and this comment block is removed.
// grep enforcement: oxlint no-restricted-imports prevents importing this file
// from any non-PostService module.

import { sql } from 'drizzle-orm';
import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { postInteractionTypeEnum, postVisibilityEnum } from './enums.js';
import { activityReceipts } from './payments.js';
import { veyraUsers } from './identity.js';

export const posts = pgTable(
  'posts',
  {
    postId:          text('post_id').primaryKey(),                            // pst_<base58>
    authorUserId:    text('author_user_id').notNull()
                       .references(() => veyraUsers.veyraUserId),
    content:         text('content').notNull(),
    mediaUrls:       text('media_urls').array().notNull().default([]),
    visibility:      postVisibilityEnum('visibility').notNull().default('PUBLIC'),
    replyToPostId:   text('reply_to_post_id'),
    repostOfPostId:  text('repost_of_post_id'),
    createdAt:       timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt:       timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt:       timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('ix_posts_author_time').on(t.authorUserId, t.createdAt),
  ],
);

export const postInteractions = pgTable(
  'post_interactions',
  {
    interactionId:   text('interaction_id').primaryKey(),                     // pin_<base58>
    postId:          text('post_id').notNull().references(() => posts.postId),
    actorUserId:     text('actor_user_id').notNull()
                       .references(() => veyraUsers.veyraUserId),
    interactionType: postInteractionTypeEnum('interaction_type').notNull(),
    createdAt:       timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt:       timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('uix_post_interactions_actor_type')
      .on(t.postId, t.actorUserId, t.interactionType),
  ],
);

export const postTips = pgTable(
  'post_tips',
  {
    tipId:         text('tip_id').primaryKey(),                               // ptp_<base58>
    postId:        text('post_id').notNull().references(() => posts.postId),
    receiptId:     text('receipt_id').notNull().unique()
                     .references(() => activityReceipts.receiptId),
    senderUserId:  text('sender_user_id').notNull()
                     .references(() => veyraUsers.veyraUserId),
    createdAt:     timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
);


