import { boolean, index, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { veyraUsers } from './identity.js';

export const contacts = pgTable('contacts', {
  contactId: text('contact_id').primaryKey(),
  ownerUserId: text('owner_user_id').notNull().references(() => veyraUsers.veyraUserId),
  contactUserId: text('contact_user_id').notNull().references(() => veyraUsers.veyraUserId),
  alias: text('alias'),
  favorite: boolean('favorite').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  removedAt: timestamp('removed_at', { withTimezone: true }),
}, (t) => [
  uniqueIndex('uix_contacts_owner_contact').on(t.ownerUserId, t.contactUserId),
  index('ix_contacts_owner_active').on(t.ownerUserId, t.removedAt),
]);
