import {describe,expect,it} from 'vitest';
import {reserveCircleExchangeBeforeSigning} from '../mainnet/reserveCircleExchange';
import {readExchangeIntents,type ExchangeIntent} from '../mainnet/exchangeIntentJournal';
const owner='0x1111111111111111111111111111111111111111';
const id='123e4567-e89b-12d3-a456-426614174000';
const originalKey='veyra:mainnet:circle:v1:bridge:'+owner;
const recovery=JSON.stringify({owner,mode:'bridge',status:'UNKNOWN',intentId:id});
const intent:ExchangeIntent={id,owner,provider:'Circle App Kit',mode:'bridge',fromChainId:8453,
 toChainId:5042,tokenIn:'USDC',tokenOut:'USDC',amountIn:'1',minimumOut:'0.99',
 createdAt:1000,updatedAt:1000,stage:'REVIEWED',steps:[]};
function storage(){
 const values=new Map<string,string>();
 return {get length(){return values.size;},key:(i:number)=>[...values.keys()][i]??null,
  getItem:(k:string)=>values.get(k)??null,
  setItem:(k:string,v:string)=>{values.set(k,v);},
  removeItem:(k:string)=>{values.delete(k);},values};
}
describe('Mainnet Exchange financial journal handoff',()=>{
 it('saves both verified-readback records before SDK signing may start',()=>{
  const s=storage();
  expect(reserveCircleExchangeBeforeSigning({intent,legacyKey:originalKey,recoveryRecord:recovery,storage:s}))
   .toEqual({kind:'reserved'});
  expect(s.getItem(originalKey)).toBe(recovery);
  expect(readExchangeIntents(owner,s)).toMatchObject({
   kind:'ready',items:[{id,stage:'AWAITING_WALLET'}]});
  // A second tab must not enqueue a second unresolved original transfer.
  expect(reserveCircleExchangeBeforeSigning({intent:{...intent,id:'123e4567-e89b-12d3-a456-426614174001'},
   legacyKey:originalKey,recoveryRecord:recovery,storage:s}).kind).toBe('blocked');
 });
 it('when original operation already exists, never replaces it',()=>{
  const s=storage();s.setItem(originalKey,'already signing');
  expect(reserveCircleExchangeBeforeSigning({intent,legacyKey:originalKey,recoveryRecord:recovery,storage:s}).kind)
   .toBe('blocked');
  expect(s.getItem(originalKey)).toBe('already signing');
  expect(readExchangeIntents(owner,s).items).toHaveLength(0);
 });
 it('fails closed if the original lock write is rejected, without leaving a false active intent',()=>{
  const s=storage();
  const broken={...s,setItem:(k:string,v:string)=>{
   if(k===originalKey)throw Error('Quota exceeded');s.setItem(k,v);
  }};
  expect(reserveCircleExchangeBeforeSigning({intent,legacyKey:originalKey,
   recoveryRecord:recovery,storage:broken}).kind).toBe('blocked');
  expect(readExchangeIntents(owner,s).items[0].stage).toBe('CANCELLED_BEFORE_SOURCE');
  expect(s.getItem(originalKey)).toBe(null);
 });
 it('refuses to cancel journal when a corrupted recovery write cannot be cleaned safely',()=>{
  const s=storage();
  const broken={...s,setItem:(k:string,v:string)=>{
   if(k===originalKey)s.setItem(k,'unknown preexisting data');
   else s.setItem(k,v);
  }};
  expect(reserveCircleExchangeBeforeSigning({intent,legacyKey:originalKey,
   recoveryRecord:recovery,storage:broken}).kind).toBe('blocked');
  expect(s.getItem(originalKey)).toBe('unknown preexisting data');
  expect(readExchangeIntents(owner,s).items[0].stage).toBe('REVIEWED');
  // No accidental second signing; corrupt original must be resolved manually.
  expect(reserveCircleExchangeBeforeSigning({intent:{...intent,id:'123e4567-e89b-12d3-a456-426614174003'},
   legacyKey:originalKey,recoveryRecord:recovery,storage:s}).kind).toBe('blocked');
 });
});
