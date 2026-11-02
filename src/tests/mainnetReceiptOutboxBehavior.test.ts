import {afterEach,describe,expect,it,vi} from 'vitest';
import {writeMainnetJournal,readMainnetJournal,type MainnetJournal} from '../mainnet/arcMainnetJournal';
import {enqueueVerifiedPay,readReceiptOutbox,receiptOutboxKey,updateReceiptOutbox} from '../mainnet/receiptOutbox';
import {syncReceiptOutboxOnce} from '../mainnet/MainnetReceiptSyncWorker';
import {MainnetReceiptSyncError,classifyReceiptSyncError,type MainnetPayServerReceipt} from '../lib/api/mainnetPayReceipts';

const a='0x1111111111111111111111111111111111111111';
const b='0x2222222222222222222222222222222222222222';
const user='usr_ABCDEFGHJKLMNPQ';
const other='usr_ABCDEFGHJKLMNPX';
const hash='0x'+'a'.repeat(64);
const journal=(stage:MainnetJournal['stage']='VERIFIED'):MainnetJournal=>({
 from:a,to:b,amount:'0.01',stage,hash:stage==='AWAITING_WALLET'||stage==='UNKNOWN'?null:hash,
 senderUserId:user,note:'Private lunch',recipientLabel:'@bob.veyra',
});
function storage(initial=new Map<string,string>()){
 return {
  get length(){return initial.size;},
  key:(i:number)=>[...initial.keys()][i]??null,
  getItem:(key:string)=>initial.get(key)??null,
  setItem:(key:string,value:string)=>{initial.set(key,value);},
  removeItem:(key:string)=>{initial.delete(key);},
  data:initial,
 };
}
const receipt:MainnetPayServerReceipt={
 txHash:hash,chainId:5042,senderAddress:a,recipientAddress:b,
 senderUserId:user,recipientUserId:other,recipientLabel:'@bob.veyra',
 amountRaw:'10000',feeWei:'5000',blockNumber:50,
 paidAt:'2026-11-02T11:01:00Z',createdAt:'2026-11-02T11:02:00Z',
 verifiedAt:'2026-11-02T11:03:00Z',direction:'sent',
};
afterEach(()=>vi.restoreAllMocks());
describe('M0 durable receipt outbox behavioral tests',()=>{
 it('persists verified receipt before unlocking original payment; survives a fresh storage reader',()=>{
  const s=storage();
  expect(writeMainnetJournal(journal(),s)).toBe(true);
  expect(enqueueVerifiedPay(journal(),s).kind).toBe('queued');
  expect(readMainnetJournal(a,s).kind).toBe('empty');
  const reloaded=storage(s.data);
  const saved=readReceiptOutbox(a,reloaded);
  expect(saved.kind).toBe('ready');
  if(saved.kind!=='ready')return;
  expect(saved.items).toHaveLength(1);
  expect(saved.items[0]).toMatchObject({owner:a,hash,to:b,note:'Private lunch',senderUserId:user});
  expect(s.getItem(receiptOutboxKey(a,hash))).not.toContain('Bearer');
  // Repeated enqueue (another tab) cannot duplicate a receipt item.
  expect(writeMainnetJournal(journal(),s)).toBe(true);
  expect(enqueueVerifiedPay(journal(),s).kind).toBe('queued');
  expect(readReceiptOutbox(a,s).items).toHaveLength(1);
 });
 it('never releases PENDING, UNKNOWN or unpersisted verified wallet requests',()=>{
  for(const stage of ['PENDING','UNKNOWN','AWAITING_WALLET'] as const){
   const s=storage();const tx=journal(stage);
   expect(writeMainnetJournal(tx,s)).toBe(true);
   expect(enqueueVerifiedPay(tx,s).kind).toBe('blocked');
   expect(readMainnetJournal(a,s).kind).toBe('active');
   expect(readReceiptOutbox(a,s).items).toEqual([]);
  }
  const s=storage();
  expect(writeMainnetJournal(journal('PENDING'),s)).toBe(true);
  expect(enqueueVerifiedPay(journal(),s).kind).toBe('blocked');
  expect(readMainnetJournal(a,s).kind).toBe('active');
 });
 it('refuses unlock when durable outbox storage fails; the original lock remains',()=>{
  const s=storage();expect(writeMainnetJournal(journal(),s)).toBe(true);
  const broken={...s,setItem:(k:string,v:string)=>{
   if(k.startsWith('veyra:arc-mainnet-5042-receipt-outbox:v1:'))throw Error('Quota exceeded');
   s.setItem(k,v);
  }};
  expect(enqueueVerifiedPay(journal(),broken).kind).toBe('blocked');
  expect(readMainnetJournal(a,s).kind).toBe('active');
 });
 it('does not mix owners, identities or signed-out sessions',async()=>{
  const s=storage();writeMainnetJournal(journal(),s);enqueueVerifiedPay(journal(),s);
  const submit=vi.fn(async()=>receipt);
  const aborted=new AbortController();
  const base={owner:a,userId:user,token:'signed-session',storage:s,submit,signal:aborted.signal};
  expect(await syncReceiptOutboxOnce({...base,userId:other})).toBe('wrong-account');
  expect(await syncReceiptOutboxOnce({...base,owner:b})).toBe('empty');
  expect(await syncReceiptOutboxOnce({...base,token:''})).toBe('sign-in');
  expect(submit).not.toHaveBeenCalled();
  expect(readReceiptOutbox(a,s).items).toHaveLength(1);
 });
 it('classifies temporary backend errors, login expiration and refused evidence without resending money',async()=>{
  for(const [error,want] of [
   [new MainnetReceiptSyncError('retry',503,'SERVICE_UNAVAILABLE'),'retry'],
   [new MainnetReceiptSyncError('sign-in',401,'AUTH_REQUIRED'),'sign-in'],
   [new MainnetReceiptSyncError('review',422,'EVIDENCE_INVALID'),'review'],
  ] as const){
   const s=storage();writeMainnetJournal(journal(),s);enqueueVerifiedPay(journal(),s);
   const submit=vi.fn(async()=>{throw error;});
   expect(classifyReceiptSyncError(error)).toBe(want);
   expect(await syncReceiptOutboxOnce({owner:a,userId:user,token:'signed-session',
    storage:s,submit,signal:new AbortController().signal,now:10000})).toBe(want);
   const items=readReceiptOutbox(a,s).items;
   expect(items).toHaveLength(1);
   expect(items[0].status).toBe(want==='retry'?'pending':want);
   expect(items[0].nextAttemptAt).toBe(want==='retry'?15000:0);
   expect(submit).toHaveBeenCalledTimes(1);
  }
 });
 it('aborting a request midflight never dequeues or switches user data',async()=>{
  const s=storage();writeMainnetJournal(journal(),s);enqueueVerifiedPay(journal(),s);
  let finish:(r:MainnetPayServerReceipt)=>void=()=>{};
  const submit=vi.fn(()=>new Promise<MainnetPayServerReceipt>(resolve=>{finish=resolve;}));
  const controller=new AbortController();
  const task=syncReceiptOutboxOnce({owner:a,userId:user,token:'expired-or-old-session',
   storage:s,submit,signal:controller.signal});
  controller.abort();finish(receipt);
  expect(await task).toBe('empty');
  expect(readReceiptOutbox(a,s).items).toHaveLength(1);
 });
 it('two concurrent tabs only POST the SAME original hash; server remains idempotent',async()=>{
  const s=storage();writeMainnetJournal(journal(),s);enqueueVerifiedPay(journal(),s);
  const submitted:string[]=[];
  const submit=vi.fn(async (_token:string,payload:{hash:string})=>{
   submitted.push(payload.hash);await Promise.resolve();return receipt;
  });
  const call=()=>syncReceiptOutboxOnce({owner:a,userId:user,token:'signed-session',
   storage:s,submit,signal:new AbortController().signal});
  const results=await Promise.all([call(),call()]);
  expect(results).toEqual(['synced','synced']);
  expect(submitted).toEqual([hash,hash]);
  expect(readReceiptOutbox(a,s).items).toHaveLength(0);
  expect(readMainnetJournal(a,s).kind).toBe('empty');
 });
 it('keeps rejected evidence for manual review instead of dropping or resending',()=>{
  const s=storage();writeMainnetJournal(journal(),s);enqueueVerifiedPay(journal(),s);
  const changed=updateReceiptOutbox(a,hash,s,v=>({...v,status:'review',problem:'INVALID_ORIGINAL_PROOF'}));
  expect(changed).toBe(true);
  expect(readReceiptOutbox(a,s).items[0].problem).toBe('INVALID_ORIGINAL_PROOF');
  expect(readMainnetJournal(a,s).kind).toBe('empty');
 });
});
