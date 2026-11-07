import {describe,it,expect,vi} from 'vitest';
import {paymentRequestRef,validRequestUsdcAmount} from '../mainnet/paymentRequestRef';
import {validVeyraPaymentRequest,ConfirmedPaymentRequestRefusal,
 confirmedPaymentRequestRefusal} from '../lib/api/paymentRequests';
import {receiptMatchesPaymentRequest,REQUEST_TTL_MS} from '../../server/services/paymentRequestsService';
import {lookupCurrentXAccountId} from '../../server/services/xHandleAuthority';
const alice='usr_123456789ABCDEFGJ',bob='usr_23456789ABCDEFGJK';
const wallet='0x1111111111111111111111111111111111111111';
const id='prq_123456789ABCDEFGHJK';
const created=new Date('2026-11-06T00:00:00Z');
const expires=new Date(created.getTime()+REQUEST_TTL_MS);
const reference=paymentRequestRef(id);
const request={requesterUserId:alice,payerUserId:bob,recipientWallet:wallet,
 amountRaw:'10000',paymentRef:reference,createdAt:created,expiresAt:expires};
const receipt={senderUserId:bob,recipientUserId:alice,recipientAddress:wallet,
 amountRaw:'10000',paymentRef:reference,paidAt:new Date(created.getTime()+1000)};
describe('Veyra v1 Payment Requests: wallet authority and onchain-only Paid',()=>{
 it('accepts 0.01 USDC exactly, not an escaped literal or sub-micro number',()=>{
  expect(validRequestUsdcAmount('0.01')).toBe(true);
  expect(validRequestUsdcAmount('0.000001')).toBe(true);
  expect(validRequestUsdcAmount('1.234567')).toBe(true);
  for(const amount of ['0','0.0000001','0\\.01','1.2.3','-1','1000001'])
   expect(validRequestUsdcAmount(amount)).toBe(false);
 });
 it('derives non-forgeable stable bytes32 ref per request and validates signed API shape',()=>{
  expect(paymentRequestRef(id)).toMatch(/^0x[0-9a-f]{64}$/);
  expect(paymentRequestRef(id)).not.toBe(paymentRequestRef('prq_23456789ABCDEFGHJK'));
  expect(validVeyraPaymentRequest({
   requestId:id,requesterUserId:alice,payerUserId:bob,
   chainId:5042,recipientWallet:wallet,amountRaw:'10000',paymentRef:reference,
   status:'PENDING',paymentInProgress:false,txHash:null,
   createdAt:created.toISOString(),expiresAt:expires.toISOString(),
  })).toBe(true);
  expect(validVeyraPaymentRequest({
   requestId:id,requesterUserId:alice,payerUserId:bob,
   chainId:5042,recipientWallet:wallet,amountRaw:'10000',
   paymentRef:paymentRequestRef('prq_23456789ABCDEFGHJK'),
   status:'PAID',paymentInProgress:true,txHash:null,
   createdAt:created.toISOString(),expiresAt:expires.toISOString(),
  })).toBe(false);
 });
 it('only links a canonical source receipt with correct parties, wallet, raw gross, ref and timestamp',()=>{
  expect(receiptMatchesPaymentRequest(request,receipt)).toBe(true);
  for(const changed of [
   {...receipt,senderUserId:alice},
   {...receipt,recipientUserId:bob},
   {...receipt,recipientAddress:'0x2222222222222222222222222222222222222222'},
   {...receipt,amountRaw:'9999'},
   {...receipt,paymentRef:paymentRequestRef('prq_23456789ABCDEFGHJK')},
   {...receipt,paidAt:new Date(created.getTime()-1)},
   {...receipt,paidAt:new Date(expires.getTime()+1)},
  ])expect(receiptMatchesPaymentRequest(request,changed)).toBe(false);
 });
 it('does not resolve an X handle when provider owner is missing, changed or unverified',async()=>{
  const ok=vi.fn(()=>Promise.resolve(new Response(JSON.stringify({data:{id:'999999',username:'legit_user'}}),{
   status:200,headers:{'content-type':'application/json'}})));
  expect(await lookupCurrentXAccountId('legit_user','test-bearer-token',ok)).toBe('999999');
  expect(await lookupCurrentXAccountId('legit_user',undefined,ok)).toBeNull();
  expect(await lookupCurrentXAccountId('legit_user','test-bearer-token',
   vi.fn(()=>Promise.resolve(new Response(JSON.stringify({data:{id:'999999',username:'not_user'}}),{status:200}))))).toBeNull();
 });
});
