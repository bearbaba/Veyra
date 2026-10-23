/**
 * Owner-only notification inbox. All notification events come from trusted DB
 * friend events or (later) verified message/payment receipt processors.
 * No endpoint allows users to forge an incoming USDC notification.
 */
import { and, count, desc, eq, isNull } from 'drizzle-orm';
import type { DbClient } from '../db/client.js';
import { veyraNotifications } from '../db/schema/notifications.js';

const NOTIFICATION_ID = /^ntf_[1-9A-HJ-NP-Za-km-z]{10,}$/;

export class NotificationInboxError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message); this.name = 'NotificationInboxError';
  }
}

export function parseNotificationPagination(limitValue: unknown, offsetValue: unknown): {limit: number;offset: number} {
  function bounded(v: unknown, fallback: number, max: number): number {
    if (v === undefined) return fallback;
    if (typeof v !== 'string' || !/^(0|[1-9][0-9]*)$/.test(v)) {
      throw new NotificationInboxError('INVALID_PAGINATION','Invalid notification pagination.');
    }
    const n = Number(v);
    if (!Number.isSafeInteger(n) || n > max) {
      throw new NotificationInboxError('INVALID_PAGINATION','Invalid notification pagination.');
    }
    return n;
  }
  const limit = bounded(limitValue, 20, 50);
  const offset = bounded(offsetValue, 0, 1000);
  if (limit === 0) throw new NotificationInboxError('INVALID_PAGINATION','Invalid notification pagination.');
  return {limit,offset};
}

export function assertNotificationId(value: unknown): string {
  if (typeof value !== 'string' || !NOTIFICATION_ID.test(value)) {
    throw new NotificationInboxError('INVALID_NOTIFICATION_ID','Invalid notification reference.');
  }
  return value;
}

export async function getNotificationInbox(
  db: DbClient, ownerUserId: string, page: {limit: number;offset: number},
) {
  const [items, unread] = await Promise.all([
    db.select({
      notificationId: veyraNotifications.notificationId,
      kind: veyraNotifications.kind,
      actorUserId: veyraNotifications.actorUserId,
      eventRef: veyraNotifications.eventRef,
      createdAt: veyraNotifications.createdAt,
      readAt: veyraNotifications.readAt,
    })
      .from(veyraNotifications)
      .where(eq(veyraNotifications.ownerUserId,ownerUserId))
      .orderBy(desc(veyraNotifications.createdAt),desc(veyraNotifications.notificationId))
      .limit(page.limit+1).offset(page.offset),
    db.select({value:count()}).from(veyraNotifications)
      .where(and(eq(veyraNotifications.ownerUserId,ownerUserId),isNull(veyraNotifications.readAt))),
  ]);
  const hasMore = items.length > page.limit;
  return {
    items: items.slice(0,page.limit).map(item=>({
      ...item, createdAt:item.createdAt.toISOString(),readAt:item.readAt?.toISOString() ?? null,
    })),
    unreadCount: unread[0]?.value ?? 0,
    hasMore,
    nextOffset: hasMore ? page.offset+page.limit : null,
  };
}

export async function markOwnerNotificationRead(db: DbClient, ownerUserId: string, id: string) {
  const notificationId = assertNotificationId(id);
  const [owned] = await db.select({notificationId:veyraNotifications.notificationId})
    .from(veyraNotifications)
    .where(and(eq(veyraNotifications.notificationId,notificationId),eq(veyraNotifications.ownerUserId,ownerUserId)))
    .limit(1);
  if (!owned) throw new NotificationInboxError('NOTIFICATION_NOT_FOUND','Notification not found.');
  // Idempotent; never change another account's read state.
  await db.update(veyraNotifications).set({readAt:new Date()})
    .where(and(eq(veyraNotifications.notificationId,notificationId),eq(veyraNotifications.ownerUserId,ownerUserId),isNull(veyraNotifications.readAt)));
}
