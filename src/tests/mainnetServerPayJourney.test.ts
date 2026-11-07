import {describe,it,expect} from 'vitest';
import {parsePayJourneyLock,genericPayFundingRef,sameLockedJourney,PayJourneyError}
 from '../../server/services/mainnetPayJourneyService';
import {genericPayFundingRef as browserRef} from '../mainnet/payFundingJourney';
import {isMainnetIdentityOnlyRouteAllowed} from '../../server/services/mainnetIdentityOnlyRoutes';
const a='0x1111111111111111111111111111111111111111';
const b='0x2222222222222222222222222222222222222222';
const user='usr_123456789ABCDEFGJ';
const id='aabbccdd-3333-4333-8333-123456789abc';
const op='babbccdd-3333-4333-8333-123456789abc';
const payload={journeyId:id,gatewayOperationId:op,ownerWallet:a,
 payeeWallet:b,grossUsdc:'0.01'};
describe('Server-arbitrated Unified → Pay, no client-completed evidence',()=>{
 it('matches frontend/back end deterministic payment ref across reloads',()=>{
  expect(genericPayFundingRef(id)).toBe(browserRef(id));
  expect(genericPayFundingRef(id)).toMatch(/^0x[0-9a-f]{64}$/);
 });
 it('rejects client status/hash, unknown proof and malformed wallet/balance',()=>{
  for(const attempt of [
   {...payload,status:'SETTLEMENT_VERIFIED'},
   {...payload,verifiedTxHash:'0x'+'a'.repeat(64)},
   {...payload,sourceHash:'0x'+'b'.repeat(64)},
   {...payload,ownerWallet:'0x123'},
   {...payload,grossUsdc:'0'},
   {...payload,requestId:'prq_invalid'},
  ])expect(()=>parsePayJourneyLock(attempt)).toThrow(PayJourneyError);
 });
 it('locks every field and isolates the signed user, owner and operation',()=>{
  const row={journeyId:id,ownerUserId:user,ownerWallet:a,payeeWallet:b,
   amountRaw:'10000',paymentRef:genericPayFundingRef(id),
   requestId:null,gatewayOperationId:op};
  expect(sameLockedJourney(row as never,payload,user,genericPayFundingRef(id))).toBe(true);
  expect(sameLockedJourney(row as never,{...payload,grossUsdc:'0.011'},user,genericPayFundingRef(id))).toBe(false);
  expect(sameLockedJourney(row as never,{...payload,gatewayOperationId:id},user,genericPayFundingRef(id))).toBe(false);
  expect(sameLockedJourney(row as never,payload,'usr_23456789ABCDEFGJK',genericPayFundingRef(id))).toBe(false);
  expect(sameLockedJourney(row as never,payload,user,'0x'+'3'.repeat(64))).toBe(false);
 });
 it('exposes owner-authenticated journey routes in the isolated BFF only',()=>{
  expect(isMainnetIdentityOnlyRouteAllowed('GET','/api/mainnet/pay/journeys')).toBe(true);
  expect(isMainnetIdentityOnlyRouteAllowed('POST','/api/mainnet/pay/journeys/lock')).toBe(true);
  expect(isMainnetIdentityOnlyRouteAllowed('POST','/api/mainnet/pay/journeys')).toBe(false);
 });
});
