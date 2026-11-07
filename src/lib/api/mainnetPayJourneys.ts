/** Owner-wallet signed, read-only cross-device arbitration for Unified Pay.
 * Server never accepts completed/status/hash from the browser. A 404/5xx
 * is UNKNOWN and blocks a new funding signature; it does not mean "no lock".
 */
import {getAddress,isAddress,parseUnits} from 'viem';
import {requireSignedIdentityToken} from './identityApi';
import {genericPayFundingRef} from '@/mainnet/payFundingJourney';
export type ServerPayJourney={
 journeyId:string;ownerWallet:string;payeeWallet:string;amountRaw:string;
 paymentRef:string;requestId:string|null;gatewayOperationId:string;
 status:'RESERVED'|'SETTLEMENT_VERIFIED';verifiedTxHash:string|null;
 createdAt:string;updatedAt:string;
};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH=/^0x[0-9a-f]{64}$/i;
function validServerJourney(input:unknown):input is ServerPayJourney{
 if(!input||typeof input!=='object'||Array.isArray(input))return false;
 const j=input as Partial<ServerPayJourney>;
 return typeof j.journeyId==='string'&&UUID.test(j.journeyId)&&
  typeof j.ownerWallet==='string'&&isAddress(j.ownerWallet)&&
  typeof j.payeeWallet==='string'&&isAddress(j.payeeWallet)&&
  typeof j.amountRaw==='string'&&/^[1-9][0-9]*$/.test(j.amountRaw)&&
  typeof j.paymentRef==='string'&&HASH.test(j.paymentRef)&&
  typeof j.gatewayOperationId==='string'&&UUID.test(j.gatewayOperationId)&&
  (j.requestId===null||typeof j.requestId==='string')&&
  (j.status==='RESERVED'||j.status==='SETTLEMENT_VERIFIED')&&
  (j.verifiedTxHash===null||typeof j.verifiedTxHash==='string'&&HASH.test(j.verifiedTxHash))&&
  (j.status==='SETTLEMENT_VERIFIED')===(j.verifiedTxHash!==null)&&
  typeof j.createdAt==='string'&&Number.isFinite(Date.parse(j.createdAt));
}
export class ServerJourneyError extends Error{
 constructor(public readonly code:string,public readonly status:number){
  super(code);this.name='ServerJourneyError';
 }
}
async function parseResponse(res:Response):Promise<Record<string,unknown>>{
 if(!(res.headers.get('content-type')??'').includes('application/json'))
  throw new ServerJourneyError('JOURNEY_ENDPOINT_NOT_READY',503);
 let body:unknown;
 try{body=await res.json();}catch{throw new ServerJourneyError('JOURNEY_INVALID_RESPONSE',503);}
 if(!body||typeof body!=='object'||Array.isArray(body))
  throw new ServerJourneyError('JOURNEY_INVALID_RESPONSE',503);
 const data=body as Record<string,unknown>;
 if(!res.ok||data.ok!==true)
  throw new ServerJourneyError(typeof data.error==='string'?data.error:'JOURNEY_UNAVAILABLE',res.status);
 return data;
}
function headers(token:string){return {Authorization:'Bearer '+requireSignedIdentityToken(token)};}
export async function readServerPayJourney(token:string,owner:string,signal?:AbortSignal):
 Promise<ServerPayJourney|null>{
 if(!isAddress(owner))throw new ServerJourneyError('INVALID_JOURNEY_OWNER',400);
 const path='/api/mainnet/pay/journeys?'+new URLSearchParams({ownerWallet:owner}).toString();
 const response=await fetch(path,{headers:headers(token),credentials:'same-origin',cache:'no-store',
  signal:signal?AbortSignal.any([signal,AbortSignal.timeout(14000)]):AbortSignal.timeout(14000)});
 const data=await parseResponse(response);
 if(data.journey===null)return null;
 if(!validServerJourney(data.journey)||data.journey.ownerWallet.toLowerCase()!==owner.toLowerCase())
  throw new ServerJourneyError('SERVER_JOURNEY_SCOPE_MISMATCH',503);
 return data.journey;
}
export async function lockServerPayJourney(token:string,input:{
 journeyId:string;gatewayOperationId:string;ownerWallet:string;payeeWallet:string;
 grossUsdc:string;requestId?:string;
}):Promise<ServerPayJourney>{
 if(!UUID.test(input.journeyId)||!UUID.test(input.gatewayOperationId)||
  !isAddress(input.ownerWallet)||!isAddress(input.payeeWallet))
  throw new ServerJourneyError('INVALID_JOURNEY_LOCK',400);
 const response=await fetch('/api/mainnet/pay/journeys/lock',{
  method:'POST',headers:{...headers(token),'Content-Type':'application/json'},
  body:JSON.stringify(input),cache:'no-store',credentials:'same-origin',
  signal:AbortSignal.timeout(15000)});
 const data=await parseResponse(response);
 const j=data.journey;
 if(!validServerJourney(j)||j.status!=='RESERVED'||
  j.ownerWallet.toLowerCase()!==getAddress(input.ownerWallet).toLowerCase()||
  j.payeeWallet.toLowerCase()!==getAddress(input.payeeWallet).toLowerCase()||
  j.journeyId!==input.journeyId||j.gatewayOperationId!==input.gatewayOperationId||
  j.amountRaw!==parseUnits(input.grossUsdc,6).toString()||
  (j.requestId??undefined)!==input.requestId||
  (!input.requestId&&j.paymentRef.toLowerCase()!==genericPayFundingRef(input.journeyId).toLowerCase()))
  throw new ServerJourneyError('SERVER_JOURNEY_IMMUTABLE_FIELDS_MISMATCH',503);
 return j;
}
