import {bigint,index,pgTable,text,timestamp} from 'drizzle-orm/pg-core';
import {veyraUsers} from './identity.js';
import {identitySnapshots} from './snapshots.js';
/** Server-verified, immutable chain evidence. Notes are sender-only metadata. */
export const mainnetDirectPayReceipts=pgTable('mainnet_direct_pay_receipts',{
 txHash:text('tx_hash').primaryKey(),
 chainId:bigint('chain_id',{mode:'number'}).notNull(),
 senderAddress:text('sender_address').notNull(),
 recipientAddress:text('recipient_address').notNull(),
 senderUserId:text('sender_user_id').references(()=>veyraUsers.veyraUserId),
 recipientUserId:text('recipient_user_id').references(()=>veyraUsers.veyraUserId),
 recipientSnapshotId:text('recipient_snapshot_id').references(()=>identitySnapshots.snapshotId),
 recipientLabel:text('recipient_label'),
 amountRaw:text('amount_raw').notNull(),
 feeWei:text('fee_wei').notNull(),
 blockNumber:bigint('block_number',{mode:'number'}).notNull(),
 paidAt:timestamp('paid_at',{withTimezone:true}).notNull(),
 senderPrivateNote:text('sender_private_note'),
 createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
 verifiedAt:timestamp('verified_at',{withTimezone:true}).notNull().defaultNow(),
},t=>[
 index('ix_mainnet_pay_sender').on(t.senderUserId,t.createdAt),
 index('ix_mainnet_pay_recipient').on(t.recipientUserId,t.createdAt),
]);
