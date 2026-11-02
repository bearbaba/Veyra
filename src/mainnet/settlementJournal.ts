/** Wallet-scoped, fail-closed recovery lock for VeyraSettlement mainnet signatures.
 * Never treat local storage as payment evidence. Unknown must never auto-retry.
 */
export type SettlementPhase='APPROVAL'|'PAYMENT';
export type SettlementStage='AWAITING_WALLET'|'UNKNOWN'|'PENDING'|'VERIFIED'|'REVERTED';
export type SettlementIntent={
 owner:string; phase:SettlementPhase; stage:SettlementStage; recipient:string;
 amount:string; ref:string; hash:string|null; createdAt:number;
 fromBlock?:string; scanCursor?:string;
};
export type SettlementRead={kind:'empty'}|{kind:'blocked'}|{kind:'active';value:SettlementIntent};
type Store=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
const ADDR=/^0x[0-9a-fA-F]{40}$/;
const HASH=/^0x[0-9a-fA-F]{64}$/;
const AMOUNT=/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,6})?$/;
export const settlementIntentKey=(owner:string)=>'veyra:arc-mainnet-5042-settlement-intent:v1:'+owner.toLowerCase();
export const settlementUnresolved=(entry:SettlementRead)=>entry.kind!=='empty'&&
 (entry.kind==='blocked'||!['VERIFIED','REVERTED'].includes(entry.value.stage));
export function readSettlementIntent(owner:string,store?:Pick<Store,'getItem'>):SettlementRead{
 try{
  if(!ADDR.test(owner))return {kind:'blocked'};
  const raw=(store??window.localStorage).getItem(settlementIntentKey(owner));
  if(raw===null)return {kind:'empty'};
  if(!raw||raw.length>2048)return {kind:'blocked'};
  const x:unknown=JSON.parse(raw);
  if(!x||typeof x!=='object'||Array.isArray(x))return {kind:'blocked'};
  const v=x as Partial<SettlementIntent>;
  if(typeof v.owner!=='string'||v.owner.toLowerCase()!==owner.toLowerCase()||
   !ADDR.test(v.owner)||typeof v.recipient!=='string'||!ADDR.test(v.recipient)||
   typeof v.amount!=='string'||!AMOUNT.test(v.amount)||Number(v.amount)<=0||
   typeof v.ref!=='string'||!HASH.test(v.ref)||
   !['APPROVAL','PAYMENT'].includes(v.phase??'')||
   !['AWAITING_WALLET','UNKNOWN','PENDING','VERIFIED','REVERTED'].includes(v.stage??'')||
   !(v.hash===null||typeof v.hash==='string'&&HASH.test(v.hash))||
   typeof v.createdAt!=='number'||!Number.isSafeInteger(v.createdAt)||v.createdAt<=0||
   (v.fromBlock!==undefined&&!(typeof v.fromBlock==='string'&&/^[0-9]{1,22}$/.test(v.fromBlock)))||
   (v.scanCursor!==undefined&&!(typeof v.scanCursor==='string'&&/^[0-9]{1,22}$/.test(v.scanCursor)))||
   (['PENDING','VERIFIED','REVERTED'].includes(v.stage??'')&&!v.hash)||
   (['AWAITING_WALLET','UNKNOWN'].includes(v.stage??'')&&v.hash!==null))
   return {kind:'blocked'};
  return {kind:'active',value:v as SettlementIntent};
 }catch{return {kind:'blocked'};}
}
function notify(){
 try{if(typeof window.dispatchEvent==='function')window.dispatchEvent(new Event('veyra:mainnet:journal'));}catch{/* persistence is still valid */}
}
export function writeSettlementIntent(intent:SettlementIntent,store?:Store):boolean{
 try{
  const storage=store??window.localStorage;
  if(!ADDR.test(intent.owner)||readSettlementIntent(intent.owner,{getItem:()=>JSON.stringify(intent)}).kind!=='active')return false;
  const packed=JSON.stringify(intent);
  storage.setItem(settlementIntentKey(intent.owner),packed);
  const saved=storage.getItem(settlementIntentKey(intent.owner))===packed;
  if(saved)notify();
  return saved;
 }catch{return false;}
}
export function clearSettlementIntent(owner:string,store?:Store):boolean{
 try{
  const storage=store??window.localStorage;
  storage.removeItem(settlementIntentKey(owner));
  const cleared=storage.getItem(settlementIntentKey(owner))===null;
  if(cleared)notify();
  return cleared;
 }catch{return false;}
}
