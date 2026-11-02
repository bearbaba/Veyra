import {describe,expect,it} from 'vitest';
import {createExchangeIntent,advanceExchangeIntent,readExchangeIntents,type ExchangeIntent} from '../mainnet/exchangeIntentJournal';
import {recordVerifiedExchangeProof} from '../mainnet/recordVerifiedExchangeProof';
const owner='0x1111111111111111111111111111111111111111',other='0x2222222222222222222222222222222222222222';
const id='123e4567-e89b-12d3-a456-426614174000',source='0x'+'a'.repeat(64),dest='0x'+'b'.repeat(64);
function store(){const data=new Map<string,string>();return {
 get length(){return data.size;},getItem:(k:string)=>data.get(k)??null,
 setItem:(k:string,v:string)=>{data.set(k,v);},removeItem:(k:string)=>{data.delete(k);},
 key:(i:number)=>[...data.keys()][i]??null};
}
const seed:ExchangeIntent={id,owner,provider:'Circle App Kit',mode:'bridge',fromChainId:8453,
 toChainId:5042,tokenIn:'USDC',tokenOut:'USDC',amountIn:'1',minimumOut:'0.99',
 createdAt:1000,updatedAt:1000,stage:'REVIEWED',steps:[]};
const proof={owner,intentId:id,sourceHash:source,destinationHash:dest,
 sourceChainId:8453,destinationChainId:5042,sourceToken:'USDC',
 destinationToken:'USDC',checkedAt:1200};
function init(stage:'SOURCE_UNKNOWN'|'SOURCE_SUBMITTED'|'SOURCE_CONFIRMED'|'DESTINATION_PENDING'|'PARTIAL'='SOURCE_UNKNOWN'){
 const s=store();expect(createExchangeIntent(seed,s)).toBe(true);
 expect(advanceExchangeIntent(owner,id,'AWAITING_WALLET',{},s)).toBe(true);
 expect(advanceExchangeIntent(owner,id,'SOURCE_UNKNOWN',{},s)).toBe(true);
 if(stage!=='SOURCE_UNKNOWN'){
  expect(advanceExchangeIntent(owner,id,'SOURCE_SUBMITTED',{sourceHash:source},s)).toBe(true);
  if(stage!=='SOURCE_SUBMITTED'){
   expect(advanceExchangeIntent(owner,id,'SOURCE_CONFIRMED',{},s)).toBe(true);
   if(stage==='DESTINATION_PENDING')expect(advanceExchangeIntent(owner,id,'DESTINATION_PENDING',{},s)).toBe(true);
   if(stage==='PARTIAL')expect(advanceExchangeIntent(owner,id,'PARTIAL',{
    holdingChainId:8453,holdingToken:'burn confirmed, output pending'},s)).toBe(true);
  }
 }
 return s;
}
describe('Verified Exchange proof is committed only after independent chain checks',()=>{
 it.each(['SOURCE_UNKNOWN','SOURCE_SUBMITTED','SOURCE_CONFIRMED','DESTINATION_PENDING','PARTIAL'] as const)(
  'recovers %s into one verified timeline with both original hashes',stage=>{
   const s=init(stage);expect(recordVerifiedExchangeProof(proof,s)).toEqual({kind:'recorded'});
   const items=readExchangeIntents(owner,s).items;expect(items).toHaveLength(1);
   expect(items[0]).toMatchObject({stage:'DESTINATION_VERIFIED',sourceHash:source,
    destinationHash:dest,createdAt:1000,updatedAt:1200});
   expect(items[0].steps).toHaveLength(2);
   expect(recordVerifiedExchangeProof(proof,s)).toEqual({kind:'recorded'});
  });
 it('does not overwrite the original source hash or switch wallets',()=>{
  const s=init('SOURCE_SUBMITTED');
  expect(recordVerifiedExchangeProof({...proof,sourceHash:'0x'+'c'.repeat(64)},s))
   .toMatchObject({kind:'blocked'});
  expect(recordVerifiedExchangeProof({...proof,owner:other},s)).toMatchObject({kind:'blocked'});
  expect(recordVerifiedExchangeProof({...proof,destinationChainId:1},s)).toMatchObject({kind:'blocked'});
  expect(readExchangeIntents(owner,s).items[0].stage).toBe('SOURCE_SUBMITTED');
 });
 it('does not write a fake destination result when storage is unavailable',()=>{
  const s=init('SOURCE_CONFIRMED');
  const broken={...s,setItem:(_key:string,_value:string)=>{throw Error('Quota');}};
  expect(recordVerifiedExchangeProof(proof,broken)).toMatchObject({kind:'blocked'});
  expect(readExchangeIntents(owner,s).items[0].stage).toBe('SOURCE_CONFIRMED');
 });
 it('rejects duplicate completed hashes with substituted destination proof',()=>{
  const s=init();
  expect(recordVerifiedExchangeProof(proof,s)).toEqual({kind:'recorded'});
  expect(recordVerifiedExchangeProof({...proof,destinationHash:'0x'+'c'.repeat(64)},s))
   .toMatchObject({kind:'blocked'});
 });
});
