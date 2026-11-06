/** Circle Gateway Mainnet local operation ledger.
 * Active v1 records are migrated in place without deleting history. Terminal
 * proof must be obtained by the independent reconciler, never SDK success alone.
 * A write failure leaves the unresolved checkpoint locked; never blind retry.
 */
import {getAddress,isAddress,parseUnits} from 'viem';
export type GatewayOperationStatus='UNKNOWN'|'SUBMITTED'|'CREDIT_OBSERVED'|'DESTINATION_UNVERIFIED'|
 'VERIFIED'|'REVERTED';
export type GatewayMainnetOperation={
 version:1;id:string;owner:string;kind:'deposit'|'spend';chainId:number;
 destinationChainId?:number;recipient:string;amount:string;createdAt:number;
 status:GatewayOperationStatus;sourceHash?:string;transferId?:string;destinationHash?:string;
 beforeAvailable?:string;minimumReceive?:string;
};
export type GatewayMainnetReceipt={
 version:1;operationId:string;owner:string;kind:'deposit'|'spend';status:'VERIFIED'|'REVERTED';
 chainId:number;destinationChainId?:number;recipient:string;amount:string;
 sourceHash?:string;destinationHash?:string;transferId?:string;verifiedAt:number;
 sourceBlockHash?:string;destinationBlockHash?:string;
 gatewayConfirmedBefore?:string;gatewayConfirmedAfter?:string;received?:string;
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
  ['UNKNOWN','SUBMITTED','CREDIT_OBSERVED','DESTINATION_UNVERIFIED','VERIFIED','REVERTED'].includes(o.status??'')&&
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
  (r.status==='VERIFIED'||r.status==='REVERTED')&&supported(r.chainId!)&&
  (r.destinationChainId===undefined||supported(r.destinationChainId))&&
  typeof r.recipient==='string'&&isAddress(r.recipient)&&
  amountOk(r.amount)&&parseUnits(r.amount,6)>0n&&
  (r.sourceHash===undefined||HASH.test(r.sourceHash))&&
  (r.sourceBlockHash===undefined||HASH.test(r.sourceBlockHash))&&
  (r.transferId===undefined||typeof r.transferId==='string'&&r.transferId.length>0&&r.transferId.length<160)&&
  (r.kind!=='deposit'||typeof r.sourceHash==='string'&&HASH.test(r.sourceHash)&&
   typeof r.sourceBlockHash==='string'&&HASH.test(r.sourceBlockHash))&&
  (r.destinationHash===undefined||HASH.test(r.destinationHash))&&
  (r.destinationBlockHash===undefined||HASH.test(r.destinationBlockHash))&&
  typeof r.verifiedAt==='number'&&r.verifiedAt>0&&Number.isFinite(r.verifiedAt)&&
  (r.gatewayConfirmedBefore===undefined||amountOk(r.gatewayConfirmedBefore))&&
  (r.gatewayConfirmedAfter===undefined||amountOk(r.gatewayConfirmedAfter))&&
  (r.received===undefined||amountOk(r.received))&&
  (r.status!=='VERIFIED'||r.kind!=='deposit'||(
    r.gatewayConfirmedBefore!==undefined&&r.gatewayConfirmedAfter!==undefined&&
    parseUnits(r.gatewayConfirmedAfter,6)>=parseUnits(r.gatewayConfirmedBefore,6)+parseUnits(r.amount,6)
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
export function readGatewayMainnetHistory(owner:string,store?:GatewayStore):GatewayMainnetReceipt[]|'blocked'{
 try{
  const raw=(store??localStorage).getItem(gatewayMainnetHistoryKey(owner));
  if(!raw)return [];if(raw.length>150000)return 'blocked';
  const parsed:unknown=JSON.parse(raw);
  if(!Array.isArray(parsed)||parsed.length>100||!parsed.every(v=>validGatewayMainnetReceipt(v,owner)))
   return 'blocked';
  const ids=new Set(parsed.map((r:GatewayMainnetReceipt)=>r.operationId));
  if(ids.size!==parsed.length)return 'blocked';
  return parsed;
 }catch{return 'blocked';}
}
export function archiveGatewayMainnetReceipt(receipt:GatewayMainnetReceipt,
 store?:GatewayStore):boolean{
 if(!validGatewayMainnetReceipt(receipt,receipt.owner))return false;
 const storage=store??localStorage;
 try{
  const active=readGatewayMainnetOperation(receipt.owner,storage);
  if(!active||active==='blocked'||active.id!==receipt.operationId||
   active.kind!==receipt.kind||active.chainId!==receipt.chainId||
   active.destinationChainId!==receipt.destinationChainId||
   active.recipient.toLowerCase()!==receipt.recipient.toLowerCase()||
   active.amount!==receipt.amount||
   (receipt.kind==='deposit'&&active.sourceHash?.toLowerCase()!==receipt.sourceHash?.toLowerCase())||
   (receipt.kind==='spend'&&active.transferId!==receipt.transferId))
   return false;
  const history=readGatewayMainnetHistory(receipt.owner,storage);
  if(history==='blocked')return false;
  const prior=history.find(r=>r.operationId===receipt.operationId);
  if(prior&&JSON.stringify(prior)!==JSON.stringify(receipt))return false;
  if(!prior){
   if(history.length>=100)return false;
   const json=JSON.stringify([receipt,...history]);
   storage.setItem(gatewayMainnetHistoryKey(receipt.owner),json);
   if(storage.getItem(gatewayMainnetHistoryKey(receipt.owner))!==json)return false;
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
