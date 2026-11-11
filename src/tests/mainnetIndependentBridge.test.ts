import {describe,expect,it} from 'vitest';
import {createExchangeIntent,advanceExchangeIntent,readExchangeIntents,type ExchangeIntent}
 from '../mainnet/exchangeIntentJournal';
import {authorizeIndependentBridge,readUnverifiedBridgeArchives}
 from '../mainnet/independentBridgeRequest';

const owner='0x1111111111111111111111111111111111111111';
const other='0x2222222222222222222222222222222222222';
const intentId='11111111-1111-4111-8111-111111111111';
const archiveId='22222222-2222-4222-8222-222222222222';
const key='veyra:mainnet:circle:v1:bridge:'+owner;
const record={owner,mode:'bridge' as const,amount:'0.1',minimum:'0.04',
 source:8453,destination:5042,fromToken:'USDC' as const,toToken:'USDC' as const,
 status:'UNKNOWN' as const,intentId};
function memory(){
 const entries=new Map<string,string>();
 return {getItem:(k:string)=>entries.get(k)??null,
  setItem:(k:string,v:string)=>{entries.set(k,v);},
  removeItem:(k:string)=>{entries.delete(k);},
  key:(i:number)=>[...entries.keys()][i]??null,
  get length(){return entries.size;},
 };
}
type Memory=ReturnType<typeof memory>;
function prepare(s:Memory,rec=record,created=1_000_000){
 const intent:ExchangeIntent={
  id:intentId,owner,provider:'Circle App Kit',mode:'bridge',
  fromChainId:8453,toChainId:5042,tokenIn:'USDC',tokenOut:'USDC',
  amountIn:rec.amount,minimumOut:rec.minimum,
  createdAt:created,updatedAt:created,stage:'REVIEWED',steps:[],
 };
 expect(createExchangeIntent(intent,s)).toBe(true);
 expect(advanceExchangeIntent(owner,intentId,'AWAITING_WALLET',{},s,created+1)).toBe(true);
 expect(advanceExchangeIntent(owner,intentId,'SOURCE_UNKNOWN',{},s,created+2)).toBe(true);
 s.setItem(key,JSON.stringify(rec));
}
const ask=(s:Memory,rec=record,now=2_000_000)=>
 authorizeIndependentBridge({owner,legacyKey:key,record:rec,archiveId,storage:s,now});

describe('Bridge separate transfer without losing the original unknown source',()=>{
 it('requires user-directed continuation and preserves original unresolved timeline',()=>{
  const s=memory();prepare(s);
  expect(ask(s)).toEqual({kind:'ready'});
  expect(s.getItem(key)).toBeNull();
  const original=readExchangeIntents(owner,s);
  expect(original.kind).toBe('ready');
  if(original.kind!=='ready')return;
  expect(original.items[0]?.stage).toBe('SOURCE_UNKNOWN');
  expect(original.items[0]?.newTransferAuthorizedAt).toBe(2_000_000);
  const archived=readUnverifiedBridgeArchives(owner,s);
  expect(archived).toHaveLength(1);
  expect(archived[0]?.status).toBe('SOURCE_OUTCOME_UNKNOWN');
  expect(archived[0]?.record).toEqual(record);
  // A separate fresh operation may now be reserved without deleting old evidence.
  expect(createExchangeIntent({
   ...original.items[0]!,id:'33333333-3333-4333-8333-333333333333',
   stage:'REVIEWED',newTransferAuthorizedAt:undefined,steps:[],
   createdAt:2_000_010,updatedAt:2_000_010,sourceHash:undefined,
  },s)).toBe(true);
 });
 it('never closes or skips an original request with any transaction evidence',()=>{
  for(const field of ['hash','burnHash','mintHash'] as const){
   const s=memory(),value={...record,[field]:'0x'+'a'.repeat(64)};
   s.setItem(key,JSON.stringify(value));
   expect(ask(s,value).kind).toBe('blocked');
   expect(s.getItem(key)).not.toBeNull();
   expect(readUnverifiedBridgeArchives(owner,s)).toHaveLength(0);
  }
 });
 it('requires same wallet, matching journal, age and unchanged stored recovery',()=>{
  const s=memory();prepare(s);
  expect(ask(s,{...record,owner:other}).kind).toBe('blocked');
  expect(ask(s,record,1_100_000).kind).toBe('blocked');
  expect(ask(s,{...record,amount:'0.2'}).kind).toBe('blocked');
  expect(readExchangeIntents(owner,s).kind).toBe('ready');
  expect(s.getItem(key)).not.toBeNull();
 });
 it('preserves orphan legacy unknown record when no modern journal exists',()=>{
  const s=memory(),legacy={...record,intentId:undefined};
  s.setItem(key,JSON.stringify(legacy));
  expect(ask(s,legacy)).toEqual({kind:'ready'});
  expect(readUnverifiedBridgeArchives(owner,s)[0]?.record).toEqual(legacy);
  expect(s.getItem(key)).toBeNull();
 });
 it('does not bypass a separate active Exchange intent',()=>{
  const s=memory();prepare(s);
  const first=readExchangeIntents(owner,s);
  if(first.kind!=='ready')throw Error('intent not created');
  const second:ExchangeIntent={...first.items[0]!,id:'44444444-4444-4444-8444-444444444444',stage:'REVIEWED',
   createdAt:1_100_000,updatedAt:1_100_000,newTransferAuthorizedAt:undefined};
  // The journal API correctly refuses to create another active intent.
  expect(createExchangeIntent(second,s)).toBe(false);
  expect(ask(s)).toEqual({kind:'ready'});
  expect(readExchangeIntents(owner,s).kind).toBe('ready');
 });
});
