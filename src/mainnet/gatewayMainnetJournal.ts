/** Circle Gateway Mainnet local operation ledger.
 * Active v1 records are migrated in place without deleting history. Terminal
 * proof must be obtained by the independent reconciler, never SDK success alone.
 * A write failure leaves the unresolved checkpoint locked; never blind retry.
 */
import {getAddress,isAddress,parseUnits} from 'viem';
export type GatewayOperationStatus='UNKNOWN'|'SUBMITTED'|'CREDIT_OBSERVED'|'DESTINATION_UNVERIFIED'|
 'VERIFIED'|'REVERTED'|'SOURCE_CONFIRMED';
export type GatewayMainnetOperation={
 version:1;id:string;owner:string;kind:'deposit'|'spend';chainId:number;
 destinationChainId?:number;recipient:string;amount:string;createdAt:number;
 status:GatewayOperationStatus;sourceHash?:string;transferId?:string;destinationHash?:string;
 beforeAvailable?:string;minimumReceive?:string;
};
export type GatewayMainnetReceipt={
 version:1;operationId:string;owner:string;kind:'deposit'|'spend';status:'VERIFIED'|'REVERTED'|'CANCELLED_BEFORE_SOURCE';
 chainId:number;destinationChainId?:number;recipient:string;amount:string;
 sourceHash?:string;destinationHash?:string;transferId?:string;verifiedAt:number;
 sourceBlockHash?:string;destinationBlockHash?:string;
 gatewayConfirmedBefore?:string;gatewayConfirmedAfter?:string;received?:string;
 rejectionMethod?:string;
 /** Provider-attested *individual* deposit reference, never an aggregate balance delta. */
 gatewayCreditReference?:string;
};
const HASH=/^0x[0-9a-fA-F]{64}$/;
const AMOUNT=/^(?:0|[1-9][0-9]{0,17})(?:\.[0-9]{1,6})?$/;
const supported=(id:number)=>id===1||id===8453||id===5042;
const prefix='veyra:gateway:mainnet:v1:';
export type GatewayStore=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
export const gatewayMainnetJournalKey=(owner:string)=>prefix+getAddress(owner).toLowerCase();
export const gatewayMainnetHistoryKey=(owner:string)=>prefix+'history:'+getAddress(owner).toLowerCase();
const amountOk=(x:unknown):x is string=>typeof x==='string'&&AMOUNT.test(x)&&parseUnits(x,6)>=0n;
export function validGatewayMainnetOperation(x:unknown,owner:string):x is GatewayMainnetOperation{
 if(!isAddress(owner)||!x||typeof x!=='object'||Array.isArray(x))return false;
 const o=x as Partial<GatewayMainnetOperation>;
 return o.version===1&&typeof o.id==='string'&&/^[0-9a-f-]{36}$/i.test(o.id)&&
  o.owner===getAddress(owner).toLowerCase()&&
  (o.kind==='deposit'||o.kind==='spend')&&supported(o.chainId!)&&
  (o.destinationChainId===undefined||supported(o.destinationChainId))&&
  typeof o.recipient==='string'&&isAddress(o.recipient)&&
  amountOk(o.amount)&&parseUnits(o.amount,6)>0n&&
  typeof o.createdAt==='number'&&Number.isFinite(o.createdAt)&&o.createdAt>0&&
  ['UNKNOWN','SUBMITTED','CREDIT_OBSERVED','SOURCE_CONFIRMED','DESTINATION_UNVERIFIED','VERIFIED','REVERTED'].includes(o.status??'')&&
  (o.sourceHash===undefined||HASH.test(o.sourceHash))&&
  (o.destinationHash===undefined||HASH.test(o.destinationHash))&&
  (o.transferId===undefined||typeof o.transferId==='string'&&o.transferId.length<160)&&
  (o.beforeAvailable===undefined||amountOk(o.beforeAvailable))&&
  (o.minimumReceive===undefined||amountOk(o.minimumReceive));
}
export function validGatewayMainnetReceipt(x:unknown,owner:string):x is GatewayMainnetReceipt{
 if(!x||typeof x!=='object'||Array.isArray(x)||!isAddress(owner))return false;
 const r=x as Partial<GatewayMainnetReceipt>;
 return r.version===1&&typeof r.operationId==='string'&&/^[0-9a-f-]{36}$/i.test(r.operationId)&&
  r.owner===getAddress(owner).toLowerCase()&&
  (r.kind==='deposit'||r.kind==='spend')&&
  (r.status==='VERIFIED'||r.status==='REVERTED'||r.status==='CANCELLED_BEFORE_SOURCE')&&supported(r.chainId!)&&
  (r.destinationChainId===undefined||supported(r.destinationChainId))&&
  typeof r.recipient==='string'&&isAddress(r.recipient)&&
  amountOk(r.amount)&&parseUnits(r.amount,6)>0n&&
  (r.sourceHash===undefined||HASH.test(r.sourceHash))&&
  (r.sourceBlockHash===undefined||HASH.test(r.sourceBlockHash))&&
  (r.transferId===undefined||typeof r.transferId==='string'&&r.transferId.length>0&&r.transferId.length<160)&&
  (r.kind!=='deposit'||r.status==='CANCELLED_BEFORE_SOURCE'||typeof r.sourceHash==='string'&&HASH.test(r.sourceHash)&&
   typeof r.sourceBlockHash==='string'&&HASH.test(r.sourceBlockHash))&&
  (r.destinationHash===undefined||HASH.test(r.destinationHash))&&
  (r.destinationBlockHash===undefined||HASH.test(r.destinationBlockHash))&&
  typeof r.verifiedAt==='number'&&r.verifiedAt>0&&Number.isFinite(r.verifiedAt)&&
  (r.gatewayConfirmedBefore===undefined||amountOk(r.gatewayConfirmedBefore))&&
  (r.gatewayConfirmedAfter===undefined||amountOk(r.gatewayConfirmedAfter))&&
  (r.received===undefined||amountOk(r.received))&&
  (r.gatewayCreditReference===undefined||typeof r.gatewayCreditReference==='string'&&
   r.gatewayCreditReference.length>0&&r.gatewayCreditReference.length<=160)&&
  (r.status!=='CANCELLED_BEFORE_SOURCE'||(
   r.sourceHash===undefined&&r.destinationHash===undefined&&r.transferId===undefined&&
   r.sourceBlockHash===undefined&&r.destinationBlockHash===undefined&&
   typeof r.rejectionMethod==='string'&&
   (/^eth_(?:sendTransaction|sendRawTransaction|sign|signTypedData(?:_v[0-9]+)?)$/.test(r.rejectionMethod)||r.rejectionMethod==='personal_sign')
  ))&&
  (r.status!=='VERIFIED'||r.kind!=='deposit'||(
   // Read legacy v1 receipts without presenting their aggregate-balance test
   // as strong evidence. New verified deposits must carry a provider credit ID.
   r.gatewayCreditReference!==undefined||
   (r.gatewayConfirmedBefore!==undefined&&r.gatewayConfirmedAfter!==undefined&&
    parseUnits(r.gatewayConfirmedAfter,6)>=parseUnits(r.gatewayConfirmedBefore,6)+parseUnits(r.amount,6))
  ))&&
  (r.status!=='VERIFIED'||r.kind!=='spend'||(
    r.destinationHash!==undefined&&r.destinationBlockHash!==undefined&&r.received!==undefined&&
    r.transferId!==undefined
  ));
}
export function readGatewayMainnetOperation(owner:string,store?:GatewayStore):GatewayMainnetOperation|null|'blocked'{
 try{
  const raw=(store??localStorage).getItem(gatewayMainnetJournalKey(owner));
  if(!raw)return null;if(raw.length>3500)return 'blocked';
  const obj:unknown=JSON.parse(raw);
  return validGatewayMainnetOperation(obj,owner)?obj:'blocked';
 }catch{return 'blocked';}
}
export function writeGatewayMainnetOperation(op:GatewayMainnetOperation,store?:GatewayStore):boolean{
 if(!validGatewayMainnetOperation(op,op.owner))return false;
 try{
  const storage=store??localStorage,key=gatewayMainnetJournalKey(op.owner);
  const old=storage.getItem(key);
  if(old){
   const prev:unknown=JSON.parse(old);
   if(!validGatewayMainnetOperation(prev,op.owner)||prev.id!==op.id||
    prev.kind!==op.kind||prev.recipient.toLowerCase()!==op.recipient.toLowerCase()||
    prev.amount!==op.amount||prev.chainId!==op.chainId||
    prev.destinationChainId!==op.destinationChainId||prev.sourceHash&&prev.sourceHash!==op.sourceHash||
    prev.destinationHash&&prev.destinationHash!==op.destinationHash||
    prev.status==='VERIFIED'||prev.status==='REVERTED')return false;
  }
  const raw=JSON.stringify(op);storage.setItem(key,raw);
  const saved=storage.getItem(key)===raw;
  if(saved&&typeof window!=='undefined')window.dispatchEvent(new Event('veyra:gateway:mainnet'));
  return saved;
 }catch{return false;}
}
/** 100 receipts per durable page, NOT 100 receipts total.
 * Page 0 retains the original v1 key. Pages are append-only; the head cursor is
 * written only after the new page has been verified on disk. Failed removal is
 * safely retryable without rewriting proof with a new verifiedAt.
 */
const PAGE_LIMIT=100,MAX_PAGE=1_000_000,MAX_PAGE_BYTES=150_000;
export const gatewayMainnetHistoryPageKey=(owner:string,page:number)=>
 page===0?gatewayMainnetHistoryKey(owner):gatewayMainnetHistoryKey(owner)+':page:'+page;
export const gatewayMainnetHistoryHeadKey=(owner:string)=>gatewayMainnetHistoryKey(owner)+':head';
function historyHead(owner:string,storage:GatewayStore):number|'blocked'{
 try{
  const value=storage.getItem(gatewayMainnetHistoryHeadKey(owner));
  if(value===null)return 0;
  if(!/^(?:0|[1-9][0-9]{0,6})$/.test(value))return 'blocked';
  const head=Number(value);
  return head<=MAX_PAGE?head:'blocked';
 }catch{return 'blocked';}
}
function readPage(owner:string,page:number,storage:GatewayStore):GatewayMainnetReceipt[]|'blocked'{
 try{
  if(!Number.isSafeInteger(page)||page<0||page>MAX_PAGE)return 'blocked';
  const raw=storage.getItem(gatewayMainnetHistoryPageKey(owner,page));
  if(!raw)return page===0?[]:'blocked';
  if(raw.length>MAX_PAGE_BYTES)return 'blocked';
  const parsed:unknown=JSON.parse(raw);
  if(!Array.isArray(parsed)||parsed.length>PAGE_LIMIT||
   !parsed.every(v=>validGatewayMainnetReceipt(v,owner)))return 'blocked';
  const values=parsed;
  if(new Set(values.map(x=>x.operationId)).size!==values.length)return 'blocked';
  return values;
 }catch{return 'blocked';}
}
export function readGatewayMainnetHistoryPage(owner:string,page:number,store?:GatewayStore):
 GatewayMainnetReceipt[]|'blocked'{
 try{return readPage(owner,page,store??localStorage);}catch{return 'blocked';}
}
export function readGatewayMainnetHistory(owner:string,store?:GatewayStore):GatewayMainnetReceipt[]|'blocked'{
 try{
  const storage=store??localStorage,head=historyHead(owner,storage);
  if(head==='blocked')return 'blocked';
  const visible:GatewayMainnetReceipt[]=[];
  for(let page=head;page>=0&&visible.length<PAGE_LIMIT;page--){
   const entries=readPage(owner,page,storage);
   if(entries==='blocked')return 'blocked';
   visible.push(...[...entries].reverse());
  }
  return visible.slice(0,PAGE_LIMIT);
 }catch{return 'blocked';}
}
/** Immutable identity of the original receipt, excluding observed-at time and
 * balance snapshots which can change between two safe archive attempts.
 */
export function gatewayReceiptEvidenceKey(r:GatewayMainnetReceipt):string{
 return [r.version,r.operationId,r.owner,r.kind,r.status,r.chainId,
  r.destinationChainId??'',r.recipient.toLowerCase(),r.amount,
  r.sourceHash?.toLowerCase()??'',r.sourceBlockHash?.toLowerCase()??'',
  r.destinationHash?.toLowerCase()??'',r.destinationBlockHash?.toLowerCase()??'',
  r.transferId??'',r.received??'',r.rejectionMethod??'',r.gatewayCreditReference??''].join('|');
}
export function archiveGatewayMainnetReceipt(receipt:GatewayMainnetReceipt,
 store?:GatewayStore):boolean{
 if(!validGatewayMainnetReceipt(receipt,receipt.owner))return false;
 // Legacy receipts may still be displayed, but a NEW verified deposit requires
 // a Circle-origin, original-tx-linked provider credit reference.
 if(receipt.kind==='deposit'&&receipt.status==='VERIFIED'&&!receipt.gatewayCreditReference)return false;
 try{
  const storage=store??localStorage;
  const active=readGatewayMainnetOperation(receipt.owner,storage);
  if(!active||active==='blocked'||active.id!==receipt.operationId||
   active.kind!==receipt.kind||active.chainId!==receipt.chainId||
   (receipt.status==='CANCELLED_BEFORE_SOURCE'&&(
    active.status!=='UNKNOWN'||active.sourceHash!==undefined||active.transferId!==undefined||
    active.destinationHash!==undefined))||
   active.destinationChainId!==receipt.destinationChainId||
   active.recipient.toLowerCase()!==receipt.recipient.toLowerCase()||
   active.amount!==receipt.amount||
   (receipt.kind==='deposit'&&active.sourceHash?.toLowerCase()!==receipt.sourceHash?.toLowerCase())||
   (receipt.kind==='spend'&&active.transferId!==receipt.transferId))return false;
  const head=historyHead(receipt.owner,storage);
  if(head==='blocked')return false;
  const headEntries=readPage(receipt.owner,head,storage);
  if(headEntries==='blocked')return false;
  const prior=headEntries.find(r=>r.operationId===receipt.operationId);
  const atCapacity=headEntries.length>=PAGE_LIMIT&&!prior;
  const target=head+(atCapacity?1:0);
  if(target>MAX_PAGE)return false;
  // A previously saved but not yet indexed next page may exist after a crash.
  const existingNext=atCapacity?
   storage.getItem(gatewayMainnetHistoryPageKey(receipt.owner,target)):null;
  let page=atCapacity?
   (existingNext?readPage(receipt.owner,target,storage):[]):headEntries;
  if(page==='blocked')return false;
  const already=page.find(r=>r.operationId===receipt.operationId);
  if(already&&gatewayReceiptEvidenceKey(already)!==gatewayReceiptEvidenceKey(receipt))
   return false;
  if(atCapacity&&page.length>0&&!already)return false;
  if(!already){
   if(page.length>=PAGE_LIMIT)return false;
   page=[...page,receipt];
   const data=JSON.stringify(page);
   if(data.length>MAX_PAGE_BYTES)return false;
   const key=gatewayMainnetHistoryPageKey(receipt.owner,target);
   storage.setItem(key,data);
   if(storage.getItem(key)!==data)return false;
  }
  if(target!==head){
   const value=String(target);
   storage.setItem(gatewayMainnetHistoryHeadKey(receipt.owner),value);
   if(storage.getItem(gatewayMainnetHistoryHeadKey(receipt.owner))!==value)return false;
  }
  storage.removeItem(gatewayMainnetJournalKey(receipt.owner));
  if(storage.getItem(gatewayMainnetJournalKey(receipt.owner))!==null)return false;
  if(typeof window!=='undefined')window.dispatchEvent(new Event('veyra:gateway:mainnet'));
  return true;
 }catch{return false;}
}
export function hasUnresolvedGatewayMainnetOperation(owner:string,store?:GatewayStore):boolean{
 return readGatewayMainnetOperation(owner,store)!==null ||
  readGatewayMainnetHistory(owner,store)==='blocked';
}
