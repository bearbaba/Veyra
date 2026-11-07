import {describe,expect,it} from 'vitest';
import {createExchangeIntent,readExchangeIntents,advanceExchangeIntent,
 exchangeIntentKey,type ExchangeIntent} from '../mainnet/exchangeIntentJournal';
const owner='0x1111111111111111111111111111111111111111';
const other='0x2222222222222222222222222222222222222222';
const id='123e4567-e89b-12d3-a456-426614174000';
const src='0x'+'a'.repeat(64),dst='0x'+'b'.repeat(64);
function storage(){const m=new Map<string,string>();return {
 get length(){return m.size;},key:(i:number)=>[...m.keys()][i]??null,
 getItem:(k:string)=>m.get(k)??null,setItem:(k:string,v:string)=>{m.set(k,v);},
 removeItem:(k:string)=>{m.delete(k);},
};}
const seed:ExchangeIntent={id,owner,provider:'Circle App Kit',mode:'bridge',
 fromChainId:8453,toChainId:5042,tokenIn:'USDC',tokenOut:'USDC',
 amountIn:'1',minimumOut:'0.99',createdAt:1000,updatedAt:1000,stage:'REVIEWED',steps:[]};
describe('One durable Exchange ID and multi-step recovery',()=>{
 it('exists before wallet signatures and survives reload under the correct owner',()=>{
  const s=storage();
  expect(createExchangeIntent(seed,s)).toBe(true);
  expect(s.getItem(exchangeIntentKey(owner,id))).not.toBe(null);
  expect(readExchangeIntents(owner,s)).toMatchObject({kind:'ready',items:[{id,stage:'REVIEWED'}]});
  expect(readExchangeIntents(other,s).items).toEqual([]);
  expect(createExchangeIntent(seed,s)).toBe(false);
 });
 it('does not allow a second unresolved Exchange request',()=>{
  const s=storage();expect(createExchangeIntent(seed,s)).toBe(true);
  expect(createExchangeIntent({...seed,id:'123e4567-e89b-12d3-a456-426614174001'},s)).toBe(false);
 });
 it('tracks original source and destination as one intent without re-sending',()=>{
  const s=storage();createExchangeIntent(seed,s);
  expect(advanceExchangeIntent(owner,id,'AWAITING_WALLET',{},s,2000)).toBe(true);
  expect(advanceExchangeIntent(owner,id,'SOURCE_SUBMITTED',{sourceHash:src,
   steps:[{stage:'source',chainId:8453,token:'USDC',status:'submitted',hash:src}]},s,3000)).toBe(true);
  expect(advanceExchangeIntent(owner,id,'SOURCE_CONFIRMED',{},s,4000)).toBe(true);
  expect(advanceExchangeIntent(owner,id,'DESTINATION_PENDING',{},s,4500)).toBe(true);
  expect(advanceExchangeIntent(owner,id,'DESTINATION_VERIFIED',{destinationHash:dst,
   steps:[{stage:'source',chainId:8453,token:'USDC',status:'verified',hash:src},
    {stage:'destination',chainId:5042,token:'USDC',status:'verified',hash:dst}]},s,5000)).toBe(true);
  expect(readExchangeIntents(owner,s).items).toMatchObject([{stage:'DESTINATION_VERIFIED',
   createdAt:1000,updatedAt:5000,sourceHash:src,destinationHash:dst}]);
  expect(advanceExchangeIntent(owner,id,'SOURCE_SUBMITTED',{},s)).toBe(false);
 });
 it('marks partial completion without pretending that source funds were delivered',()=>{
  const s=storage();createExchangeIntent(seed,s);
  advanceExchangeIntent(owner,id,'AWAITING_WALLET',{},s);
  advanceExchangeIntent(owner,id,'SOURCE_SUBMITTED',{sourceHash:src},s);
  advanceExchangeIntent(owner,id,'SOURCE_CONFIRMED',{},s);
  expect(advanceExchangeIntent(owner,id,'PARTIAL',{holdingChainId:8453,
   holdingToken:'USDC · source consumed / destination not credited',
   message:'Check original bridge fill and refund evidence. Do not send from source again.'},s)).toBe(true);
  expect(readExchangeIntents(owner,s).items[0]).toMatchObject({stage:'PARTIAL',
   holdingChainId:8453,sourceHash:src});
  expect(advanceExchangeIntent(owner,id,'REFUND_PENDING',{},s)).toBe(true);
  expect(advanceExchangeIntent(owner,id,'REFUNDED',{},s)).toBe(true);
  expect(advanceExchangeIntent(owner,id,'DESTINATION_VERIFIED',{destinationHash:dst},s)).toBe(false);
 });
 it('refuses partial without original source hash, false completion or wallet changes',()=>{
  const s=storage();createExchangeIntent(seed,s);
  expect(advanceExchangeIntent(other,id,'AWAITING_WALLET',{},s)).toBe(false);
  expect(advanceExchangeIntent(owner,id,'PARTIAL',{holdingToken:'USDC',holdingChainId:8453},s)).toBe(false);
  expect(advanceExchangeIntent(owner,id,'DESTINATION_VERIFIED',{destinationHash:dst},s)).toBe(false);
  expect(advanceExchangeIntent(owner,id,'CANCELLED_BEFORE_SOURCE',{},s)).toBe(true);
  expect(createExchangeIntent({...seed,id:'123e4567-e89b-12d3-a456-426614174002'},s)).toBe(true);
 });
});
