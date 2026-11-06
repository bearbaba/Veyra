/** Wallet-session-only peer requests. Status PAID requires a canonical,
 * independently indexed onchain Settlement receipt; chat text is never proof.
 */
import {bigint,index,pgTable,text,timestamp,uniqueIndex} from 'drizzle-orm/pg-core';
import {veyraUsers} from './identity.js';
import {mainnetSettlementReceipts} from './mainnetSettlement.js';
export const paymentRequests=pgTable('veyra_payment_requests',{
 requestId:text('request_id').primaryKey(),
 requesterUserId:text('requester_user_id').notNull().references(()=>veyraUsers.veyraUserId),
 payerUserId:text('payer_user_id').notNull().references(()=>veyraUsers.veyraUserId),
 clientRequestId:text('client_request_id').notNull(),
 amountRaw:text('amount_raw').notNull(),
 chainId:bigint('chain_id',{mode:'number'}).notNull().default(5042),
 recipientWallet:text('recipient_wallet').notNull(),
 recipientWalletId:text('recipient_wallet_id').notNull(),
 paymentRef:text('payment_ref').notNull(),
 claimId:text('claim_id'),
 claimWallet:text('claim_wallet'),
 claimedAt:timestamp('claimed_at',{withTimezone:true}),
 status:text('status').$type<'PENDING'|'PAID'|'CANCELLED'|'EXPIRED'>().notNull().default('PENDING'),
 txHash:text('tx_hash').references(()=>mainnetSettlementReceipts.txHash),
 createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
 updatedAt:timestamp('updated_at',{withTimezone:true}).notNull().defaultNow(),
 expiresAt:timestamp('expires_at',{withTimezone:true}).notNull(),
 paidAt:timestamp('paid_at',{withTimezone:true}),
 cancelledAt:timestamp('cancelled_at',{withTimezone:true}),
},t=>[
 uniqueIndex('uq_payment_requests_requester_client').on(t.requesterUserId,t.clientRequestId),
 uniqueIndex('uq_payment_requests_ref').on(t.paymentRef),
 uniqueIndex('uq_payment_requests_tx').on(t.txHash),
 index('ix_payment_requests_requester').on(t.requesterUserId,t.createdAt),
 index('ix_payment_requests_payer').on(t.payerUserId,t.createdAt),
]);
