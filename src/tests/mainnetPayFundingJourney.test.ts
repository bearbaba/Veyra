import {describe,it,expect} from 'vitest';
import {validPayFundingJourney,readPayFundingJourney,ensurePayFundingJourney,
 derivePayFundingJourneyState,dismissPayFundingJourney,markPayFundingAttempt,samePayFundingTarget,
 payFundingJourneyKey,type PayFundingJourney} from '../mainnet/payFundingJourney';
import {validGatewayMainnetOperation,validGatewayMainnetReceipt,
 type GatewayMainnetOperation,type GatewayMainnetReceipt} from '../mainnet/gatewayMainnetJournal';
import type {SettlementRead} from '../mainnet/settlementJournal';

const owner='0x1111111111111111111111111111111111111111';
const payee='0x2222222222222222222222222222222222222222';
const id='12345678-1234-4234-8234-123456789abc';
const opId='abcd1234-abcd-4bcd-8bcd-123456789abc';
const journey:PayFundingJourney={version:1,id,owner,payee,grossUsdc:'0.01',createdAt:Date.now()};
const pending:GatewayMainnetOperation={version:1,id:opId,owner,kind:'spend',
 chainId:8453,destinationChainId:5042,recipient:owner,amount:'0.0102',createdAt:Date.now(),
 status:'UNKNOWN',payJourneyId:id,allocations:[
  {chainId:8453,amount:'0.006'},{chainId:1,amount:'0.0042'},
 ]};
const proof:GatewayMainnetReceipt={version:1,operationId:opId,owner,kind:'spend',
 status:'VERIFIED',chainId:8453,destinationChainId:5042,recipient:owner,amount:'0.0102',
 verifiedAt:Date.now(),payJourneyId:id,received:'0.01',
 destinationHash:'0x'+'1'.repeat(64),destinationBlockHash:'0x'+'2'.repeat(64),
 transferId:'12345678-1234-4234-8234-123456789abc'};
const empty:SettlementRead={kind:'empty'};
const state=(options:{
 j?:PayFundingJourney;op?:GatewayMainnetOperation|null|'blocked';
 history?:GatewayMainnetReceipt[]|'blocked';settlement?:SettlementRead;wallet?:bigint|null;
}={})=>derivePayFundingJourneyState({journey:options.j??journey,gatewayOperation:options.op??null,
 history:options.history??[],settlement:options.settlement??empty,
 arcWalletUsdc:options.wallet===undefined?null:options.wallet});
function store(){
 const m=new Map<string,string>();
 return {getItem:(key:string)=>m.get(key)??null,setItem:(k:string,v:string)=>{m.set(k,v);},
  removeItem:(key:string)=>{m.delete(key);}};
}
describe('Unified → Settlement must recover one bound journey',()=>{
 it('persists the same owner/payer/amount and refuses replacing it with another payment',()=>{
  const s=store();
  const first=ensurePayFundingJourney({owner,payee,grossUsdc:'0.01'},s);
  const second=ensurePayFundingJourney({owner,payee,grossUsdc:'0.01'},s);
  expect(second.id).toBe(first.id);
  expect(readPayFundingJourney(owner,s)).toEqual({kind:'active',value:first});
  expect(samePayFundingTarget(first,{owner,payee,grossUsdc:'0.01'})).toBe(true);
  expect(samePayFundingTarget(first,{owner,payee,grossUsdc:'0.02'})).toBe(false);
  expect(()=>ensurePayFundingJourney({owner,payee,grossUsdc:'0.02'},s)).toThrow('Another');
  expect(readPayFundingJourney(payee,s)).toEqual({kind:'empty'});
 });
 it('fails closed on forged journal and cannot dismiss while a wallet signature may exist',()=>{
  const s=store();
  s.setItem(payFundingJourneyKey(owner),'{"version":1,"id":"broken"}');
  expect(readPayFundingJourney(owner,s)).toEqual({kind:'blocked'});
  expect(()=>ensurePayFundingJourney({owner,payee,grossUsdc:'0.01'},s)).toThrow();
  expect(dismissPayFundingJourney(owner,pending,empty,[],s)).toBe(false);
  expect(dismissPayFundingJourney(owner,null,{kind:'blocked'},[],s)).toBe(false);
  expect(dismissPayFundingJourney(owner,null,empty,[],s)).toBe(false);
 });
 it('writes an immutable attempt link before signing and refuses missing archived proofs',()=>{
  const s=store();
  const saved=ensurePayFundingJourney({owner,payee,grossUsdc:'0.01'},s);
  expect(markPayFundingAttempt(owner,saved.id,opId,s)).toBe(true);
  expect(markPayFundingAttempt(owner,saved.id,opId,s)).toBe(true);
  expect(markPayFundingAttempt(owner,saved.id,id,s)).toBe(false);
  expect(()=>ensurePayFundingJourney({owner,payee,grossUsdc:'0.01'},s)).toThrow('already exists');
  expect(state({j:{...journey,fundingOperationId:opId},wallet:1000000n}))
   .toBe('FUNDING_UNKNOWN');
  expect(dismissPayFundingJourney(owner,null,empty,[],s)).toBe(false);
  expect(dismissPayFundingJourney(owner,null,empty,[{...proof,payJourneyId:saved.id}],s)).toBe(true);
 });
 it('never treats Gateway UNKNOWN, SDK submission or a wallet balance as funding proof',()=>{
  expect(validPayFundingJourney(journey,owner)).toBe(true);
  expect(validGatewayMainnetOperation(pending,owner)).toBe(true);
  expect(state({op:pending,wallet:1000000n})).toBe('FUNDING_UNKNOWN');
  expect(state({op:{...pending,status:'DESTINATION_UNVERIFIED'},wallet:1000000n}))
   .toBe('FUNDING_PENDING');
  expect(state({op:{...pending,payJourneyId:undefined}})).toBe('BLOCKED');
  expect(state({op:'blocked'})).toBe('BLOCKED');
  expect(state({history:'blocked'})).toBe('BLOCKED');
  expect(state({wallet:1000000n})).toBe('NOT_STARTED');
 });
 it('advances only after a correlated verified Gateway receipt and live Arc wallet balance',()=>{
  expect(validGatewayMainnetReceipt(proof,owner)).toBe(true);
  expect(state({history:[{...proof,payJourneyId:undefined}],wallet:10000n})).toBe('NOT_STARTED');
  expect(state({history:[proof]})).toBe('CHECKING_ARC_WALLET');
  expect(state({history:[proof],wallet:9999n})).toBe('WALLET_SHORTFALL');
  expect(state({history:[proof],wallet:10000n})).toBe('READY_TO_SETTLE');
  expect(state({history:[{...proof,status:'CANCELLED_BEFORE_SOURCE',
   destinationHash:undefined,destinationBlockHash:undefined,transferId:undefined,
   rejectionMethod:'personal_sign'}]})).toBe('FUNDING_DECLINED');
 });
 it('original Settlement status is independent of the Gateway funding receipt',()=>{
  const intent={owner,recipient:payee,amount:'0.01',phase:'PAYMENT' as const,
   stage:'UNKNOWN' as const,ref:'0x'+'3'.repeat(64),hash:null,createdAt:Date.now()};
  expect(state({history:[proof],wallet:10000n,
   settlement:{kind:'active',value:intent}})).toBe('SETTLEMENT_PENDING');
  expect(state({history:[proof],wallet:10000n,
   settlement:{kind:'active',value:{...intent,stage:'VERIFIED',hash:'0x'+'4'.repeat(64)}}}))
   .toBe('SETTLEMENT_ONCHAIN_VERIFIED');
  expect(state({history:[proof],wallet:10000n,
   settlement:{kind:'active',value:{...intent,recipient:owner}}})).toBe('BLOCKED');
 });
});
