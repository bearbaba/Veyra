import { describe,expect,it,vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import {
  StableFxOwnershipError,assertVerifiedStableFxWallet,saveBoundStableFxQuote,
  reserveStableFxTrade,requireOwnedStableFxTrade,claimStableFxFundingSubmission,
} from '../../server/services/stableFxTradeOwnership';

const dialect=new PgDialect();
const instrument=(responses:Array<{rows:unknown[]}>)=>{
 const executed:Array<{sql:string;params:unknown[]}>=[];
 const execute=vi.fn((q:Parameters<typeof dialect.sqlToQuery>[0])=>{
  const query=dialect.sqlToQuery(q);
  executed.push({sql:query.sql,params:query.params});
  return Promise.resolve(responses.shift()??{rows:[]});
 });
 return {db:{execute} as unknown as Parameters<typeof assertVerifiedStableFxWallet>[0],executed};
};
describe('StableFX owner-bound SQL gates',()=>{
 it('refuses all wallet finance requests without an active wallet binding',async()=>{
  const {db,executed}=instrument([{rows:[]}]);
  await expect(assertVerifiedStableFxWallet(db,'usr_fakeaccount','0x0000000000000000000000000000000000000001'))
   .rejects.toMatchObject({code:'STABLEFX_WALLET_NOT_BOUND_TO_SESSION'});
  expect(executed).toHaveLength(1);
  expect(executed[0].sql).toMatch(/chain_id=5042002/);
  expect(executed[0].sql).toMatch(/revoked_at IS NULL/);
 });
 it('does not save quotes for an unbound wallet',async()=>{
  const {db,executed}=instrument([{rows:[]}]);
  await expect(saveBoundStableFxQuote(db,{
   quoteId:'q',userId:'usr_A',walletAddress:'0x0000000000000000000000000000000000000001',
   fromCurrency:'USDC',toCurrency:'EURC',fromAmount:'10',
   typedData:{message:{}},expiresAt:'2026-10-30T12:00:00Z'
  })).rejects.toBeInstanceOf(StableFxOwnershipError);
  expect(executed).toHaveLength(1);
 });
 it('only reserves an authenticated unexpired, single-use, exact-message quote',async()=>{
  const {db,executed}=instrument([{rows:[{one:1}]},{rows:[{idempotency_key:'key'}]}]);
  await reserveStableFxTrade(db,{
   quoteId:'quote-123',idempotencyKey:'attempt-1',userId:'usr_A',
   walletAddress:'0x0000000000000000000000000000000000000001',
   message:{permitted:{amount:'10000000'}}
  });
  expect(executed).toHaveLength(2);
  expect(executed[1].sql).toMatch(/state='AVAILABLE'/);
  expect(executed[1].sql).toMatch(/signed_typed_data->'message'/);
  expect(executed[1].sql).toMatch(/ON CONFLICT DO NOTHING/);
  expect(executed[1].params).toContain('usr_A');
 });
 it('blocks duplicate quote reservations after an initial attempt',async()=>{
  const {db}=instrument([{rows:[{}]},{rows:[]}]);
  await expect(reserveStableFxTrade(db,{
   quoteId:'same-quote',idempotencyKey:'a',userId:'usr_A',
   walletAddress:'0x0000000000000000000000000000000000000001',
   message:{}
  })).rejects.toMatchObject({code:'STABLEFX_QUOTE_NOT_OWNED_STALE_OR_ALREADY_SUBMITTED'});
 });
 it('denies a funding submission without an exact saved signed message',async()=>{
  const {db,executed}=instrument([{rows:[]}]);
  await expect(claimStableFxFundingSubmission(db,{
   userId:'usr_A',tradeId:'trade_123',message:{altered:true}
  })).rejects.toMatchObject({code:'STABLEFX_FUNDING_ALREADY_SUBMITTED_OR_MISMATCHED'});
  expect(executed[0].sql).toMatch(/funding_typed_data->'message'/);
  expect(executed[0].sql).toMatch(/state='FUNDING_READY'/);
 });
 it('never returns another account’s trade as owned',async()=>{
  const {db}=instrument([{rows:[]}]);
  await expect(requireOwnedStableFxTrade(db,{userId:'usr_A',tradeId:'trade_owned_by_B'}))
   .rejects.toMatchObject({code:'STABLEFX_TRADE_NOT_OWNED'});
 });
});
