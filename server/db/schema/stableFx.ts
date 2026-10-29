import { index, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { veyraUsers } from './identity.js';

/** Testnet StableFX quotes are wallet-scoped and single-use. */
export const stableFxQuoteBindings=pgTable('stablefx_quote_bindings',{
  quoteId:text('quote_id').primaryKey(),
  ownerUserId:text('owner_user_id').notNull().references(()=>veyraUsers.veyraUserId),
  walletAddress:text('wallet_address').notNull(),
  fromCurrency:text('from_currency').notNull(),
  toCurrency:text('to_currency').notNull(),
  inputAmount:text('input_amount').notNull(),
  signedTypedData:jsonb('signed_typed_data').notNull(),
  expiresAt:timestamp('expires_at',{withTimezone:true}).notNull(),
  state:text('state').notNull().default('AVAILABLE'),
  createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
},t=>[index('ix_stablefx_quote_owner').on(t.ownerUserId,t.createdAt)]);

/** Provider outcomes and funding use durable, owner-bound idempotency. */
export const stableFxTradeAttempts=pgTable('stablefx_trade_attempts',{
  idempotencyKey:text('idempotency_key').primaryKey(),
  quoteId:text('quote_id').notNull().references(()=>stableFxQuoteBindings.quoteId),
  ownerUserId:text('owner_user_id').notNull().references(()=>veyraUsers.veyraUserId),
  walletAddress:text('wallet_address').notNull(),
  tradeId:text('trade_id'),
  contractTradeId:text('contract_trade_id'),
  state:text('state').notNull(),
  fundingTypedData:jsonb('funding_typed_data'),
  createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
  updatedAt:timestamp('updated_at',{withTimezone:true}).notNull().defaultNow(),
},t=>[
  uniqueIndex('uix_stablefx_trade_quote').on(t.quoteId),
  uniqueIndex('uix_stablefx_trade_id').on(t.tradeId),
  index('ix_stablefx_trade_owner').on(t.ownerUserId,t.updatedAt),
]);
