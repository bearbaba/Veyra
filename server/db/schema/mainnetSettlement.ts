import {bigint,index,pgTable,text,timestamp} from 'drizzle-orm/pg-core';
import {veyraUsers} from './identity.js';
import {identitySnapshots} from './snapshots.js';
/** Additive, independently verified contract Settlement receipt index.
 * Separate from legacy direct Pay; one original chain hash = one canonical row.
 */
export const mainnetSettlementReceipts=pgTable('mainnet_settlement_receipts',{
 txHash:text('tx_hash').primaryKey(),
 chainId:bigint('chain_id',{mode:'number'}).notNull(),
 contractAddress:text('contract_address').notNull(),
 paymentId:text('payment_id').notNull(),
 paymentRef:text('payment_ref').notNull(),
 senderAddress:text('sender_address').notNull(),
 recipientAddress:text('recipient_address').notNull(),
 senderUserId:text('sender_user_id').references(()=>veyraUsers.veyraUserId),
 recipientUserId:text('recipient_user_id').references(()=>veyraUsers.veyraUserId),
 recipientSnapshotId:text('recipient_snapshot_id').references(()=>identitySnapshots.snapshotId),
 recipientLabel:text('recipient_label'),
 amountRaw:text('amount_raw').notNull(),
 netAmountRaw:text('net_amount_raw').notNull(),
 protocolFeeRaw:text('protocol_fee_raw').notNull(),
 networkFeeWei:text('network_fee_wei').notNull(),
 blockNumber:bigint('block_number',{mode:'number'}).notNull(),
 paidAt:timestamp('paid_at',{withTimezone:true}).notNull(),
 senderPrivateNote:text('sender_private_note'),
 createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
 verifiedAt:timestamp('verified_at',{withTimezone:true}).notNull().defaultNow(),
},t=>[
 index('ix_mainnet_settlement_sender').on(t.senderUserId,t.paidAt),
 index('ix_mainnet_settlement_recipient').on(t.recipientUserId,t.paidAt),
]);
