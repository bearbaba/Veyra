/** One owner-scoped funding → Settlement journey on this device.
 * A journey is a navigation/recovery checkpoint, never payment proof.
 * Only independently reconciled Gateway receipts and Settlement receipts
 * can move the visible state; no SDK success or wallet balance delta suffices.
 */
import {getAddress,isAddress,parseUnits} from 'viem';
import type {GatewayMainnetOperation,GatewayMainnetReceipt} from './gatewayMainnetJournal';
import type {SettlementRead} from './settlementJournal';

const ID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const AMOUNT=/^(?:0|[1-9][0-9]{0,17})(?:\.[0-9]{1,6})?$/;
const REQUEST=/^prq_[1-9A-HJ-NP-Za-km-z]{10,}$/;
type Store=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
export type PayFundingJourney={
 version:1; id:string;owner:string;payee:string;grossUsdc:string;
 requestId?:string;createdAt:number;
 /** Immutable Gateway operation ID reserved before SDK can ask for a wallet signature. */
 fundingOperationId?:string;
};
export type FundingJourneyRead=
 |{kind:'empty'}|{kind:'blocked'}|{kind:'active';value:PayFundingJourney};
export type FundingJourneyState=
 'NOT_STARTED'|'FUNDING_PENDING'|'FUNDING_UNKNOWN'|'FUNDING_REVERTED'|
 'FUNDING_DECLINED'|'CHECKING_ARC_WALLET'|'WALLET_SHORTFALL'|
 'READY_TO_SETTLE'|'SETTLEMENT_PENDING'|'SETTLEMENT_ONCHAIN_VERIFIED'|'BLOCKED';

export const payFundingJourneyKey=(owner:string)=>
 'veyra:mainnet:pay-funding-journey:v1:'+getAddress(owner).toLowerCase();

export function validPayFundingJourney(value:unknown,owner:string):value is PayFundingJourney{
 if(!isAddress(owner)||!value||typeof value!=='object'||Array.isArray(value))return false;
 const j=value as Partial<PayFundingJourney>;
 return j.version===1&&typeof j.id==='string'&&ID.test(j.id)&&
  j.owner===getAddress(owner).toLowerCase()&&
  typeof j.payee==='string'&&isAddress(j.payee)&&
  typeof j.grossUsdc==='string'&&AMOUNT.test(j.grossUsdc)&&
  parseUnits(j.grossUsdc,6)>0n&&
  (j.requestId===undefined||typeof j.requestId==='string'&&REQUEST.test(j.requestId))&&
  (j.fundingOperationId===undefined||typeof j.fundingOperationId==='string'&&ID.test(j.fundingOperationId))&&
  typeof j.createdAt==='number'&&Number.isSafeInteger(j.createdAt)&&
  j.createdAt>0&&j.createdAt<Date.now()+5000;
}
export function readPayFundingJourney(owner:string,store?:Pick<Store,'getItem'>):FundingJourneyRead{
 if(!isAddress(owner))return {kind:'empty'};
 try{
  const raw=(store??localStorage).getItem(payFundingJourneyKey(owner));
  if(!raw)return {kind:'empty'};
  if(raw.length>600)return {kind:'blocked'};
  const value:unknown=JSON.parse(raw);
  return validPayFundingJourney(value,owner)?{kind:'active',value}:{kind:'blocked'};
 }catch{return {kind:'blocked'};}
}
export function ensurePayFundingJourney(input:{
 owner:string;payee:string;grossUsdc:string;requestId?:string;
},store?:Store):PayFundingJourney{
 const current=readPayFundingJourney(input.owner,store);
 if(current.kind==='blocked')throw Error('Funding recovery data is unreadable. Do not sign again.');
 if(current.kind==='active'){
  const p=current.value;
  if(p.payee.toLowerCase()!==input.payee.toLowerCase()||
   p.grossUsdc!==input.grossUsdc||p.requestId!==input.requestId)
   throw Error('Another Pay funding journey is saved. Resolve it before creating a new one.');
  if(p.fundingOperationId)
   throw Error('Original Gateway funding attempt already exists. Recover its proof; do not sign again.');
  return p;
 }
 if(!isAddress(input.owner)||!isAddress(input.payee))
  throw Error('Verified owner and recipient wallets are required.');
 const journey:PayFundingJourney={version:1,id:crypto.randomUUID(),
  owner:getAddress(input.owner).toLowerCase(),payee:getAddress(input.payee),
  grossUsdc:input.grossUsdc,...(input.requestId?{requestId:input.requestId}:{}),
  createdAt:Date.now()};
 if(!validPayFundingJourney(journey,input.owner))
  throw Error('Invalid reviewed Pay funding details.');
 try{
  const s=store??localStorage,packed=JSON.stringify(journey),key=payFundingJourneyKey(input.owner);
  s.setItem(key,packed);
  if(s.getItem(key)!==packed)throw Error('Funding checkpoint writeback failed.');
  if(typeof window!=='undefined')window.dispatchEvent(new Event('veyra:pay:funding'));
  return journey;
 }catch{throw Error('Funding checkpoint storage failed. No wallet signature requested.');}
}
/** Bind precisely one Gateway operation before any wallet signature is requested.
 * If this durable write fails, the SDK must NOT invoke a wallet.
 */
export function markPayFundingAttempt(owner:string,journeyId:string,operationId:string,
 store?:Store):boolean{
 if(!isAddress(owner)||!ID.test(journeyId)||!ID.test(operationId))return false;
 const existing=readPayFundingJourney(owner,store);
 if(existing.kind!=='active'||existing.value.id!==journeyId||
  existing.value.fundingOperationId&&existing.value.fundingOperationId!==operationId)return false;
 if(existing.value.fundingOperationId===operationId)return true;
 try{
  const s=store??localStorage,key=payFundingJourneyKey(owner);
  const updated={...existing.value,fundingOperationId:operationId};
  const raw=JSON.stringify(updated);
  s.setItem(key,raw);
  const ok=s.getItem(key)===raw;
  if(ok&&typeof window!=='undefined')window.dispatchEvent(new Event('veyra:pay:funding'));
  return ok;
 }catch{return false;}
}
export function samePayFundingTarget(j:PayFundingJourney,input:{
 owner:string;payee:string;grossUsdc:string;requestId?:string
}):boolean{
 return j.owner===input.owner.toLowerCase()&&
 j.payee.toLowerCase()===input.payee.toLowerCase()&&
 j.grossUsdc===input.grossUsdc&&j.requestId===input.requestId;
}
export function derivePayFundingJourneyState(args:{
 journey:PayFundingJourney;
 gatewayOperation:GatewayMainnetOperation|null|'blocked';
 history:GatewayMainnetReceipt[]|'blocked';
 settlement:SettlementRead;
 arcWalletUsdc:bigint|null;
}):FundingJourneyState{
 const {journey:j,gatewayOperation:op,history,settlement,arcWalletUsdc:wallet}=args;
 if(op==='blocked'||history==='blocked'||settlement.kind==='blocked')return 'BLOCKED';
 if(settlement.kind==='active'){
  const p=settlement.value;
  if(p.owner.toLowerCase()===j.owner&&p.recipient.toLowerCase()===j.payee.toLowerCase()&&
   p.amount===j.grossUsdc&&p.requestId===j.requestId){
   if(p.stage==='VERIFIED'&&p.phase==='PAYMENT')return 'SETTLEMENT_ONCHAIN_VERIFIED';
   if(['PENDING','UNKNOWN','AWAITING_WALLET','REJECTED'].includes(p.stage))
    return 'SETTLEMENT_PENDING';
  }else if(!['VERIFIED','REVERTED'].includes(p.stage))return 'BLOCKED';
 }
 if(op){
  if(op.kind!=='spend'||op.payJourneyId!==j.id||
   j.fundingOperationId!==undefined&&j.fundingOperationId!==op.id||
   op.recipient.toLowerCase()!==j.owner||op.destinationChainId!==5042)
   return 'BLOCKED';
  return op.status==='UNKNOWN'?'FUNDING_UNKNOWN':'FUNDING_PENDING';
 }
 const receipt=history.find(r=>r.kind==='spend'&&r.payJourneyId===j.id&&
  (j.fundingOperationId===undefined||r.operationId===j.fundingOperationId)&&
  r.owner===j.owner&&r.recipient.toLowerCase()===j.owner&&r.destinationChainId===5042);
 if(!receipt)return j.fundingOperationId?'FUNDING_UNKNOWN':'NOT_STARTED';
 if(receipt.status==='CANCELLED_BEFORE_SOURCE')return 'FUNDING_DECLINED';
 if(receipt.status==='REVERTED')return 'FUNDING_REVERTED';
 if(receipt.status!=='VERIFIED')return 'FUNDING_UNKNOWN';
 // A valid provider forwarding proof is necessary, but NOT sufficient:
 // read the live Arc USDC wallet balance again before presenting Settlement.
 if(wallet===null)return 'CHECKING_ARC_WALLET';
 return wallet>=parseUnits(j.grossUsdc,6)?'READY_TO_SETTLE':'WALLET_SHORTFALL';
}
/** Only the owner explicitly exits a journey when no old financial signature
 * can still be pending. This never clears the underlying Gateway/Settlement journals.
 */
export function dismissPayFundingJourney(owner:string,
 gateway:GatewayMainnetOperation|null|'blocked',
 settlement:SettlementRead,history:GatewayMainnetReceipt[]|'blocked',store?:Store):boolean{
 if(!isAddress(owner)||gateway!==null||
  settlement.kind==='blocked'||
  settlement.kind==='active'&&!['VERIFIED','REVERTED'].includes(settlement.value.stage))
  return false;
 const saved=readPayFundingJourney(owner,store);
 if(saved.kind==='blocked'||history==='blocked')return false;
 if(saved.kind==='active'&&saved.value.fundingOperationId&&
  !history.some(x=>x.operationId===saved.value.fundingOperationId&&
   x.payJourneyId===saved.value.id&&
   ['VERIFIED','REVERTED','CANCELLED_BEFORE_SOURCE'].includes(x.status)))return false;
 try{
  const s=store??localStorage,key=payFundingJourneyKey(owner);
  s.removeItem(key);
  const ok=s.getItem(key)===null;
  if(ok&&typeof window!=='undefined')window.dispatchEvent(new Event('veyra:pay:funding'));
  return ok;
 }catch{return false;}
}
