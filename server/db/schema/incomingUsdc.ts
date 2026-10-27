/**
 * Verified incoming ARC TESTNET ERC-20 USDC transfers. No frontend write path.
 * Unique on-chain event identity and a durable per-wallet scanner cursor.
 */
import {bigint,index,pgTable,text,timestamp,uniqueIndex} from 'drizzle-orm/pg-core';
import {veyraUsers} from './identity.js';
import {walletBindings} from './wallets.js';

export const verifiedIncomingUsdc=pgTable('verified_incoming_usdc',{
  incomingId:text('incoming_id').primaryKey(),
  ownerUserId:text('owner_user_id').notNull().references(()=>veyraUsers.veyraUserId),
  walletId:text('wallet_id').notNull().references(()=>walletBindings.walletId),
  chainId:bigint('chain_id',{mode:'number'}).notNull(),
  tokenAddress:text('token_address').notNull(),
  txHash:text('tx_hash').notNull(),
  logIndex:bigint('log_index',{mode:'number'}).notNull(),
  blockNumber:bigint('block_number',{mode:'number'}).notNull(),
  blockHash:text('block_hash').notNull(),
  senderAddress:text('sender_address').notNull(),
  recipientAddress:text('recipient_address').notNull(),
  amountBaseUnits:text('amount_base_units').notNull(),
  verifiedAt:timestamp('verified_at',{withTimezone:true}).notNull().defaultNow(),
},t=>[
  uniqueIndex('uq_verified_incoming_usdc_chain_log').on(t.chainId,t.txHash,t.logIndex),
  index('ix_verified_incoming_owner_recent').on(t.ownerUserId,t.verifiedAt),
]);
export const incomingUsdcCursors=pgTable('incoming_usdc_cursors',{
  walletId:text('wallet_id').primaryKey().references(()=>walletBindings.walletId),
  chainId:bigint('chain_id',{mode:'number'}).notNull(),
  lastVerifiedBlock:bigint('last_verified_block',{mode:'number'}).notNull(),
  updatedAt:timestamp('updated_at',{withTimezone:true}).notNull().defaultNow(),
});
