/** Owner-scoped, server-arbitrated payment journey.
 * Never mark a funding transfer or Settlement completed from client fields.
 */
import {index,pgTable,text,timestamp,uniqueIndex} from 'drizzle-orm/pg-core';
import {veyraUsers} from './identity.js';
import {paymentRequests} from './paymentRequests.js';
import {mainnetSettlementReceipts} from './mainnetSettlement.js';
export const mainnetPayJourneys=pgTable('mainnet_pay_journeys',{
 journeyId:text('journey_id').primaryKey(),
 ownerUserId:text('owner_user_id').notNull().references(()=>veyraUsers.veyraUserId),
 ownerWallet:text('owner_wallet').notNull(),
 payeeWallet:text('payee_wallet').notNull(),
 amountRaw:text('amount_raw').notNull(),
 paymentRef:text('payment_ref').notNull(),
 requestId:text('request_id').references(()=>paymentRequests.requestId),
 gatewayOperationId:text('gateway_operation_id').notNull(),
 verifiedTxHash:text('verified_tx_hash').references(()=>mainnetSettlementReceipts.txHash),
 createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
 updatedAt:timestamp('updated_at',{withTimezone:true}).notNull().defaultNow(),
 verifiedAt:timestamp('verified_at',{withTimezone:true}),
},t=>[
 uniqueIndex('uq_mainnet_pay_journey_ref_owner').on(t.ownerUserId,t.paymentRef),
 uniqueIndex('mainnet_pay_journeys_gateway_operation_id_key').on(t.gatewayOperationId),
 index('ix_mainnet_pay_journeys_owner_history').on(t.ownerUserId,t.createdAt),
]);
