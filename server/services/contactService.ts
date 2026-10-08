import { and, eq, isNull, sql } from 'drizzle-orm';
import type { DbClient } from '../db/client.js';
import { newContactId } from '../db/ids.js';
import { contacts, veyraUsers } from '../db/schema/index.js';
import { linkedIdentities } from '../db/schema/index.js';
import { isBlockedEither } from '../db/repositories/socialRepository.js';

export class ContactError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = 'ContactError'; }
}

function cleanAlias(alias: string | undefined): string | null {
  if (alias === undefined || alias.trim() === '') return null;
  const value = alias.trim();
  if (value.length > 40) throw new ContactError('INVALID_ALIAS', 'Contact alias must be 40 characters or fewer');
  return value;
}

export async function upsertContact(db: DbClient, ownerUserId: string, rawRecipient: string, alias?: string, favorite = false) {
  const input = rawRecipient.trim().replace(/^@/, '');
  if (!input || /^0x[0-9a-fA-F]{40}$/.test(input)) throw new ContactError('CONTACT_REQUIRES_VEYRA_IDENTITY', 'Contacts must resolve to a Veyra identity');
  const [byVeyra] = await db.select({ veyraUserId: veyraUsers.veyraUserId }).from(veyraUsers)
    .where(and(sql`lower(${veyraUsers.veyraHandle}) = lower(${input})`, eq(veyraUsers.status, 'ACTIVE'), isNull(veyraUsers.deletedAt))).limit(1);
  let contactUserId = byVeyra?.veyraUserId;
  if (!contactUserId) {
    const [byX] = await db.select({ veyraUserId: linkedIdentities.veyraUserId }).from(linkedIdentities)
      .where(and(eq(linkedIdentities.provider, 'X'), sql`lower(${linkedIdentities.externalHandle}) = lower(${input})`, eq(linkedIdentities.status, 'ACTIVE'), isNull(linkedIdentities.revokedAt))).limit(1);
    contactUserId = byX?.veyraUserId;
  }
  if (!contactUserId) throw new ContactError('CONTACT_NOT_FOUND', 'No Veyra or linked X identity matched this contact');
  if (contactUserId === ownerUserId) throw new ContactError('SELF_CONTACT', 'You cannot add yourself as a contact');
  if (await isBlockedEither(db, ownerUserId, contactUserId)) throw new ContactError('CONTACT_BLOCKED', 'A block relationship exists');
  const normalizedAlias = cleanAlias(alias);
  const [row] = await db.insert(contacts).values({
    contactId: newContactId(), ownerUserId, contactUserId,
    alias: normalizedAlias, favorite,
  }).onConflictDoUpdate({
    target: [contacts.ownerUserId, contacts.contactUserId],
    set: { alias: normalizedAlias, favorite, removedAt: null, updatedAt: new Date() },
  }).returning();
  return row;
}

export async function removeContact(db: DbClient, ownerUserId: string, contactUserId: string) {
  await db.update(contacts).set({ removedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(contacts.ownerUserId, ownerUserId), eq(contacts.contactUserId, contactUserId), isNull(contacts.removedAt)));
}

export async function listContacts(db: DbClient, ownerUserId: string) {
  const rows = await db.select({
    contactId: contacts.contactId, contactUserId: contacts.contactUserId, alias: contacts.alias, favorite: contacts.favorite,
    veyraHandle: veyraUsers.veyraHandle, displayName: veyraUsers.displayName, avatarUrl: veyraUsers.avatarUrl,
  }).from(contacts).innerJoin(veyraUsers, eq(contacts.contactUserId, veyraUsers.veyraUserId))
    .where(and(eq(contacts.ownerUserId, ownerUserId), isNull(contacts.removedAt), eq(veyraUsers.status, 'ACTIVE'), isNull(veyraUsers.deletedAt)));
  const visible = await Promise.all(rows.map(async (row) => ({ row, blocked: await isBlockedEither(db, ownerUserId, row.contactUserId) })));
  return visible.filter((item) => !item.blocked).map((item) => item.row);
}

export async function resolveContactAlias(db: DbClient, ownerUserId: string, rawAlias: string): Promise<string | null> {
  const alias = rawAlias.trim().replace(/^@/, '');
  if (!alias) return null;
  const [row] = await db.select({ contactUserId: contacts.contactUserId }).from(contacts)
    .where(and(eq(contacts.ownerUserId, ownerUserId), isNull(contacts.removedAt), sql`lower(${contacts.alias}) = lower(${alias})`)).limit(1);
  return row?.contactUserId ?? null;
}
