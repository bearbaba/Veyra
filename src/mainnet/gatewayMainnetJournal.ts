/** Owner-scoped local Gateway checkpoint, NOT a verified Circle receipt.
 * UNKNOWN and SUBMITTED keep signing blocked, even when the SDK times out.
 */
import {getAddress,isAddress} from 'viem';
export type GatewayMainnetOperation={
 version:1;id:string;owner:string;kind:'deposit'|'spend';chainId:number;
 destinationChainId?:number;recipient:string;amount:string;createdAt:number;
 status:'UNKNOWN'|'SUBMITTED'|'CREDIT_OBSERVED'|'DESTINATION_UNVERIFIED';
 sourceHash?:string;transferId?:string;
};
const HASH=/^0x[0-9a-fA-F]{64}$/,AMOUNT=/^(?:0|[1-9][0-9]{0,17})(?:\.[0-9]{1,6})?$/;
const prefix='veyra:gateway:mainnet:v1:';
type Store=Pick<Storage,'getItem'|'setItem'>;
export const gatewayMainnetJournalKey=(owner:string)=>prefix+getAddress(owner).toLowerCase();
export function validGatewayMainnetOperation(x:unknown,owner:string):x is GatewayMainnetOperation{
 if(!isAddress(owner)||!x||typeof x!=='object'||Array.isArray(x))return false;
 const o=x as Partial<GatewayMainnetOperation>;
 return o.version===1&&typeof o.id==='string'&&/^[0-9a-f-]{36}$/i.test(o.id)&&
  o.owner===getAddress(owner).toLowerCase()&&
  (o.kind==='deposit'||o.kind==='spend')&&(o.chainId===1||o.chainId===8453)&&
  (o.destinationChainId===undefined||o.destinationChainId===1||o.destinationChainId===8453)&&
  typeof o.recipient==='string'&&isAddress(o.recipient)&&
  typeof o.amount==='string'&&AMOUNT.test(o.amount)&&Number(o.amount)>0&&
  typeof o.createdAt==='number'&&Number.isFinite(o.createdAt)&&o.createdAt>0&&
  (o.status==='UNKNOWN'||o.status==='SUBMITTED'||o.status==='CREDIT_OBSERVED'||o.status==='DESTINATION_UNVERIFIED')&&
  (o.sourceHash===undefined||HASH.test(o.sourceHash))&&
  (o.transferId===undefined||typeof o.transferId==='string'&&o.transferId.length<160);
}
export function readGatewayMainnetOperation(owner:string,store?:Store):GatewayMainnetOperation|null|'blocked'{
 try{
  const raw=(store??localStorage).getItem(gatewayMainnetJournalKey(owner));
  if(!raw)return null;
  if(raw.length>3000)return 'blocked';
  const parsed:unknown=JSON.parse(raw);
  return validGatewayMainnetOperation(parsed,owner)?parsed:'blocked';
 }catch{return 'blocked';}
}
export function writeGatewayMainnetOperation(op:GatewayMainnetOperation,store?:Store):boolean{
 if(!validGatewayMainnetOperation(op,op.owner))return false;
 try{
  const storage=store??localStorage;
  const key=gatewayMainnetJournalKey(op.owner),existing=storage.getItem(key);
  if(existing){
   const prev:unknown=JSON.parse(existing);
   if(!validGatewayMainnetOperation(prev,op.owner)||prev.id!==op.id||
    prev.kind!==op.kind||prev.recipient.toLowerCase()!==op.recipient.toLowerCase()||
    prev.amount!==op.amount||prev.chainId!==op.chainId||
    prev.destinationChainId!==op.destinationChainId)return false;
  }
  const raw=JSON.stringify(op);storage.setItem(key,raw);
  const saved=storage.getItem(key)===raw;
  if(saved&&typeof window!=='undefined')window.dispatchEvent(new Event('veyra:gateway:mainnet'));
  return saved;
 }catch{return false;}
}
export function hasUnresolvedGatewayMainnetOperation(owner:string,store?:Store):boolean{
 return readGatewayMainnetOperation(owner,store)!==null;
}
