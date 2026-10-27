/**
 * Confidential server-side direct messages. Messages are encrypted at rest
 * using AES-256-GCM but NOT end-to-end encrypted. Only the two authenticated
 * participants may request plaintext from the server.
 */
import {index,pgTable,text,timestamp,uniqueIndex} from 'drizzle-orm/pg-core';
import {veyraUsers} from './identity.js';

export const directMessages=pgTable('veyra_direct_messages',{
  messageId:text('message_id').primaryKey(),
  senderUserId:text('sender_user_id').notNull().references(()=>veyraUsers.veyraUserId),
  recipientUserId:text('recipient_user_id').notNull().references(()=>veyraUsers.veyraUserId),
  clientRequestId:text('client_request_id').notNull(),
  ciphertext:text('ciphertext').notNull(),
  iv:text('iv').notNull(),
  authTag:text('auth_tag').notNull(),
  createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
},t=>[
  uniqueIndex('uq_direct_message_sender_request').on(t.senderUserId,t.clientRequestId),
  index('ix_direct_message_sender_recent').on(t.senderUserId,t.createdAt,t.messageId),
  index('ix_direct_message_recipient_recent').on(t.recipientUserId,t.createdAt,t.messageId),
]);
