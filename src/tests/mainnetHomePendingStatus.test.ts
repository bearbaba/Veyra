import {describe,it,expect} from 'vitest';
import {unresolvedHomeOperations} from '../mainnet/homePendingStatus';
import type {LocalOperation} from '../mainnet/localOperations';
import type {ExchangeIntent} from '../mainnet/exchangeIntentJournal';

const owner='0x1111111111111111111111111111111111111111';
const hash=(n:string)=>'0x'+n.repeat(64);
const op=(type:LocalOperation['type'],h:string,status:LocalOperation['status']='SUBMITTED'):LocalOperation=>({
 type,hash:h,owner,amount:'0.1',asset:'USDC',chainId:5042,status,updatedAt:123,
});
const intent=(stage:ExchangeIntent['stage'],sourceHash:string):ExchangeIntent=>({
 id:'11111111-1111-4111-8111-111111111111',owner,provider:'Circle App Kit',
 mode:'bridge',fromChainId:8453,toChainId:5042,tokenIn:'USDC',tokenOut:'USDC',
 amountIn:'0.1',minimumOut:'0.09',stage,createdAt:1,updatedAt:2,
 sourceHash,steps:[],
});

describe('Home warnings reflect pending evidence rather than stale browser labels',()=>{
 it('hides a SUBMITTED local Pay if a wallet-scoped verified server receipt exists',()=>{
  expect(unresolvedHomeOperations([op('Pay',hash('a'))],new Set([hash('a').toUpperCase().toLowerCase()]),[])).toEqual([]);
 });
 it('does not call an Exchange whose journal is terminal pending',()=>{
  for(const state of ['DESTINATION_VERIFIED','REFUNDED','SOURCE_REVERTED','CANCELLED_BEFORE_SOURCE'] as const)
   expect(unresolvedHomeOperations([op('Bridge',hash('b'))],new Set(),[intent(state,hash('b'))])).toEqual([]);
 });
 it('keeps genuinely unresolved operations visible without changing recovery locks',()=>{
  const inputs=[op('Pay',hash('a')),op('Bridge',hash('b')),op('Gateway',hash('c')),op('Swap',hash('d'),'RECORDED')];
  const original=JSON.stringify(inputs);
  expect(unresolvedHomeOperations(inputs,new Set(),[intent('SOURCE_UNKNOWN',hash('b'))])).toEqual(inputs.slice(0,2));
  expect(JSON.stringify(inputs)).toBe(original);
 });
 it('never treats a receipt for another transaction as completion proof',()=>{
  expect(unresolvedHomeOperations([op('Pay',hash('a'))],new Set([hash('c')]),[])).toHaveLength(1);
 });
});
