/**
 * Owner-private account events. The browser cannot create notification
 * records or turn a claimed payment into verified payment history.
 */
import { index, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { veyraUsers } from './identity.js';

export const veyraNotifications = pgTable('veyra_notifications', {
  notificationId: text('notification_id').primaryKey(),
  ownerUserId: text('owner_user_id').notNull().references(() => veyraUsers.veyraUserId),
  actorUserId: text('actor_user_id').references(() => veyraUsers.veyraUserId),
  kind: text('kind').$type<'FRIEND_REQUEST' | 'FRIEND_ACCEPTED' | 'MESSAGE' | 'PAYMENT_RECEIVED' | 'PAYMENT_STATUS' | 'SECURITY'>().notNull(),
  eventRef: text('event_ref').notNull(),
  createdAt: timestamp('created_at', {withTimezone:true}).notNull().defaultNow(),
  readAt: timestamp('read_at', {withTimezone:true}),
}, t => [
  index('ix_veyra_notifications_owner_recent').on(t.ownerUserId,t.createdAt,t.notificationId),
  index('ix_veyra_notifications_owner_unread').on(t.ownerUserId,t.createdAt),
  uniqueIndex('uq_notification_owner_event').on(t.ownerUserId,t.kind,t.eventRef),
]);
