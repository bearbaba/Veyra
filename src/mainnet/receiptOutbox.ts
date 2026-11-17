/** Durable wallet-scoped Mainnet receipt outbox. Never a proof of payment or a signing authority.
 * The only legitimate producer is a VERIFIED wallet journal after independent RPC proof.
 * One storage key per original hash avoids replacing unrelated items from another tab.
 */
import {buildMainnetPayPlan} from './arcMainnetPay';
import {readMainnetJournal,clearMainnetJournal,type MainnetJournal} from './arcMainnetJournal';

export type ReceiptOutboxStatus='pending'|'sign-in'|'review';
export type ReceiptOutboxItem={
 owner:string;hash:string;to:string;amount:string;chainId:5042;
 senderUserId?:string;note?:string;recipientLabel?:string;snapshotId?:string;
 createdAt:number;attempts:number;nextAttemptAt:number;
 status:ReceiptOutboxStatus;problem?:string;
};
type OutboxStorage=Pick<Storage,'getItem'|'setItem'|'removeItem'|'key'|'length'>;
/** Same browser store as the payment journal, with a fail-closed inaccessible fallback. */
export function storageForReceiptOutbox():OutboxStorage{
 try{return window.localStorage;}catch{
  return {get length():number{throw Error('Storage inaccessible');},key(){throw Error('Storage inaccessible');},
   getItem(){throw Error('Storage inaccessible');},setItem(){throw Error('Storage inaccessible');},
   removeItem(){throw Error('Storage inaccessible');}};
 }
}

const WALLET=/^0x[0-9a-f]{40}$/i;
const HASH=/^0x[0-9a-f]{64}$/i;
const USER=/^usr_[1-9A-HJ-NP-Za-km-z]{10,}$/;
const SNAP=/^snp_[1-9A-HJ-NP-Za-km-z]{10,}$/;
const PREFIX='veyra:arc-mainnet-5042-receipt-outbox:v1:';
const prefix=(owner:string)=>PREFIX+owner.toLowerCase()+':';
export const receiptOutboxKey=(owner:string,hash:string)=>prefix(owner)+hash.toLowerCase();
export type OutboxRead={kind:'ready';items:ReceiptOutboxItem[]}|{kind:'blocked';items:[]};
function valid(value:unknown,owner:string,hash:string):value is ReceiptOutboxItem{
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const x=value as Partial<ReceiptOutboxItem>;
 if(x.owner?.toLowerCase()!==owner.toLowerCase()||x.hash?.toLowerCase()!==hash.toLowerCase()||
    x.chainId!==5042||typeof x.to!=='string'||!WALLET.test(x.to)||typeof x.amount!=='string'||!x.amount||
    typeof x.createdAt!=='number'||!Number.isFinite(x.createdAt)||
    typeof x.nextAttemptAt!=='number'||!Number.isFinite(x.nextAttemptAt)||
    typeof x.attempts!=='number'||!Number.isSafeInteger(x.attempts)||x.attempts<0||
    !['pending','sign-in','review'].includes(x.status??'')||
    x.senderUserId!==undefined&&!USER.test(x.senderUserId)||
    x.snapshotId!==undefined&&!SNAP.test(x.snapshotId)||
    x.note!==undefined&&(typeof x.note!=='string'||x.note.length>120)||
    x.recipientLabel!==undefined&&(typeof x.recipientLabel!=='string'||x.recipientLabel.length>50)||
    x.problem!==undefined&&(typeof x.problem!=='string'||x.problem.length>70))return false;
 try{buildMainnetPayPlan(owner,x.to,x.amount);}catch{return false;}
 return true;
}
export function readReceiptOutbox(owner:string,storage:OutboxStorage):OutboxRead{
 if(!WALLET.test(owner))return {kind:'blocked',items:[]};
 try{
  const keys:string[]=[];
  for(let i=0;i<storage.length;i++){
   const key=storage.key(i);
   if(key?.startsWith(prefix(owner)))keys.push(key);
  }
  if(keys.length>60)return {kind:'blocked',items:[]};
  const entries:ReceiptOutboxItem[]=[];
  for(const key of keys){
   const hash=key.slice(prefix(owner).length);
   if(!HASH.test(hash))return {kind:'blocked',items:[]};
   const raw=storage.getItem(key);
   if(!raw||raw.length>2500)return {kind:'blocked',items:[]};
   const value:unknown=JSON.parse(raw);
   if(!valid(value,owner,hash))return {kind:'blocked',items:[]};
   entries.push(value);
  }
  return {kind:'ready',items:entries.sort((a,b)=>a.createdAt-b.createdAt)};
 }catch{return {kind:'blocked',items:[]};}
}
export function enqueueVerifiedPay(journal:MainnetJournal,storage:OutboxStorage):
 {kind:'queued'|'blocked';reason?:string}{
 if(journal.stage!=='VERIFIED'||!journal.hash||!WALLET.test(journal.from)||!HASH.test(journal.hash))
  return {kind:'blocked',reason:'Original transaction is not verified.'};
 // Durable verified journal must exist before a new payment can be unlocked.
 let diskStage:string|undefined;
 try{diskStage=(JSON.parse(storage.getItem('veyra:arc-mainnet-5042-payment:v1:'+journal.from.toLowerCase())??'null') as MainnetJournal|null)?.stage;}catch{/* blocked */}
 if(diskStage!=='VERIFIED')return {kind:'blocked',reason:'Verified payment journal was not persisted.'};
 const current=readMainnetJournal(journal.from,storage);
 if(current.kind!=='active'||current.value.hash?.toLowerCase()!==journal.hash.toLowerCase()||
    current.value.to.toLowerCase()!==journal.to.toLowerCase()||current.value.amount!==journal.amount)
  return {kind:'blocked',reason:'Original journal changed. Keep the payment locked.'};
 const snapshot=readReceiptOutbox(journal.from,storage);
 if(snapshot.kind!=='ready'||snapshot.items.length>=60)
  return {kind:'blocked',reason:'Receipt outbox unavailable or full. Keep the original payment locked.'};
 const key=receiptOutboxKey(journal.from,journal.hash);
 try{
  const existingRaw=storage.getItem(key);
  if(existingRaw!==null){
   const existing:unknown=JSON.parse(existingRaw);
   if(!valid(existing,journal.from,journal.hash)||
     existing.to.toLowerCase()!==journal.to.toLowerCase()||existing.amount!==journal.amount)
    return {kind:'blocked',reason:'Conflicting receipt record. Original transaction remains locked.'};
  }else{
   const item:ReceiptOutboxItem={
    owner:journal.from.toLowerCase(),hash:journal.hash.toLowerCase(),to:journal.to,
    amount:journal.amount,chainId:5042,
    ...(journal.senderUserId?{senderUserId:journal.senderUserId}:{}),
    ...(journal.note?{note:journal.note}:{}),
    ...(journal.recipientLabel?{recipientLabel:journal.recipientLabel}:{}),
    ...(journal.recipientSnapshotId?{snapshotId:journal.recipientSnapshotId}:{}),
    createdAt:Date.now(),attempts:0,nextAttemptAt:0,
    status:journal.senderUserId?'pending':'review',
    ...(!journal.senderUserId?{problem:'ORIGINAL_ACCOUNT_NOT_BOUND'}:{}),
   };
   const raw=JSON.stringify(item);
   storage.setItem(key,raw);
   if(storage.getItem(key)!==raw)return {kind:'blocked',reason:'Receipt outbox write could not be verified.'};
  }
  // Never clear the financial lock if the durable outbox is unreadable.
  if(readReceiptOutbox(journal.from,storage).kind!=='ready')
   return {kind:'blocked',reason:'Receipt outbox readback failed.'};
  // A different tab may have changed the financial journal; do not clear that lock.
  const latest=readMainnetJournal(journal.from,storage);
  if(latest.kind!=='active'||latest.value.hash?.toLowerCase()!==journal.hash.toLowerCase())
   return {kind:'blocked',reason:'Payment journal changed during receipt handoff.'};
  if(!clearMainnetJournal(journal.from,storage))
   return {kind:'blocked',reason:'Receipt queued but payment lock could not be released.'};
  try{window.dispatchEvent(new Event('veyra:mainnet:outbox'));}catch{/* durable item already saved */}
  return {kind:'queued'};
 }catch{return {kind:'blocked',reason:'Receipt storage unavailable. Do not send another payment.'};}
}
/** Compare-and-update by the same original hash; absent entries are never resurrected. */
export function updateReceiptOutbox(owner:string,hash:string,storage:OutboxStorage,
 change:(item:ReceiptOutboxItem)=>ReceiptOutboxItem|null):boolean{
 const key=receiptOutboxKey(owner,hash);
 try{
  const raw=storage.getItem(key);
  if(raw===null)return false;
  const original:unknown=JSON.parse(raw);
  if(!valid(original,owner,hash))return false;
  const updated=change(original);
  if(updated===null){storage.removeItem(key);return storage.getItem(key)===null;}
  if(!valid(updated,owner,hash)||updated.to.toLowerCase()!==original.to.toLowerCase()||
     updated.amount!==original.amount||updated.senderUserId!==original.senderUserId)return false;
  const encoded=JSON.stringify(updated);
  storage.setItem(key,encoded);return storage.getItem(key)===encoded;
 }catch{return false;}
}
