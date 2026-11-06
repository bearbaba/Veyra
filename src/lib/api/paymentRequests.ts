/** Server-authoritative, owner-private peer payment request lifecycle.
 * Calls neither a wallet nor a transfer; PAID is set only by verified receipts.
 */
import {formatUnits} from 'viem';
import {requireSignedIdentityToken} from './identityApi';
import {paymentRequestRef,PAYMENT_REQUEST_ID,validRequestUsdcAmount} from '../../mainnet/paymentRequestRef';

/** A structured 4xx refusal from the signed server is definitive: the
 * payment-attempt claim did not succeed. Network/5xx/invalid responses are
 * UNKNOWN and must never be treated as confirmation of failure.
 */
export class ConfirmedPaymentRequestRefusal extends Error {
 constructor(public readonly code:string,message:string){
  super(message);this.name='ConfirmedPaymentRequestRefusal';
 }
}
export function confirmedPaymentRequestRefusal(error:unknown):boolean{
 return error instanceof ConfirmedPaymentRequestRefusal;
}

export type VeyraPaymentRequest={
 requestId:string;requesterUserId:string;payerUserId:string;
 recipientWallet:string;paymentRef:string;amountRaw:string;chainId:5042;
 status:'PENDING'|'PAID'|'CANCELLED'|'EXPIRED';txHash:string|null;
 paymentInProgress:boolean;
 createdAt:string;updatedAt:string;expiresAt:string;
 paidAt?:string;cancelledAt?:string;
};
export function validVeyraPaymentRequest(v:unknown):v is VeyraPaymentRequest{
 if(!v||typeof v!=='object'||Array.isArray(v))return false;
 const x=v as Partial<VeyraPaymentRequest>;
 return typeof x.requestId==='string'&&PAYMENT_REQUEST_ID.test(x.requestId)&&
  typeof x.requesterUserId==='string'&&/^usr_[1-9A-HJ-NP-Za-km-z]{10,}$/.test(x.requesterUserId)&&
  typeof x.payerUserId==='string'&&/^usr_[1-9A-HJ-NP-Za-km-z]{10,}$/.test(x.payerUserId)&&
  x.requesterUserId!==x.payerUserId&&
  typeof x.recipientWallet==='string'&&/^0x[0-9a-fA-F]{40}$/.test(x.recipientWallet)&&
  x.chainId===5042&&typeof x.paymentInProgress==='boolean'&&typeof x.amountRaw==='string'&&/^[1-9][0-9]*$/.test(x.amountRaw)&&
  BigInt(x.amountRaw)<=1000000000000n&&
  x.paymentRef===paymentRequestRef(x.requestId)&&
  ['PENDING','PAID','CANCELLED','EXPIRED'].includes(String(x.status))&&
  (x.txHash===null||typeof x.txHash==='string'&&/^0x[0-9a-fA-F]{64}$/.test(x.txHash))&&
  (x.status==='PAID'?typeof x.txHash==='string':x.txHash===null)&&
  typeof x.createdAt==='string'&&Number.isFinite(Date.parse(x.createdAt))&&
  typeof x.expiresAt==='string'&&Number.isFinite(Date.parse(x.expiresAt))&&
  Date.parse(x.expiresAt)>Date.parse(x.createdAt);
}
async function requestApi(token:string,route:string,body?:unknown,method:'GET'|'POST'='POST'){
 const res=await fetch('/api/social/payment-requests'+route,{
  method,headers:{Authorization:'Bearer '+requireSignedIdentityToken(token),
   Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},
  ...(body?{body:JSON.stringify(body)}:{}),
  credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(15000),
 });
 const data:unknown=await res.json().catch(()=>null);
 if(!res.ok&&res.status>=400&&res.status<500&&data&&typeof data==='object'&&!Array.isArray(data)){
  const refusal=data as Record<string,unknown>;
  if(refusal.ok===false&&typeof refusal.error==='string'&&refusal.error.length>0)
   throw new ConfirmedPaymentRequestRefusal(refusal.error,
    typeof refusal.message==='string'?refusal.message:'Payment request was rejected by the server.');
 }
 if(!data||typeof data!=='object'||Array.isArray(data)||
  !('ok' in data)||data.ok!==true||!res.ok)
  throw Error(data&&typeof data==='object'&&'message' in data&&typeof data.message==='string'?
   data.message:'Payment request is unavailable or could not be confirmed.');
 return data as Record<string,unknown>;
}
function parsed(raw:unknown):VeyraPaymentRequest{
 if(!validVeyraPaymentRequest(raw))throw Error('Invalid signed payment request data.');
 return raw;
}
export async function listPeerRequests(token:string,peerUserId:string){
 const q=new URLSearchParams({peerUserId});
 const data=await requestApi(token,'?'+q.toString(),undefined,'GET');
 if(!Array.isArray(data.requests))throw Error('Invalid payment request list.');
 return data.requests.map(parsed);
}
export async function createPeerRequest(token:string,peerUserId:string,amount:string,clientRequestId:string){
 if(!validRequestUsdcAmount(amount))throw Error('Enter a positive USDC amount (up to 6 decimals).');
 const data=await requestApi(token,'/create',{peerUserId,amount,clientRequestId});
 return parsed(data.request);
}
export async function reviewPeerRequest(token:string,requestId:string){
 const data=await requestApi(token,'/review',{requestId});
 return parsed(data.request);
}
export async function cancelPeerRequest(token:string,requestId:string){
 const data=await requestApi(token,'/cancel',{requestId});
 return parsed(data.request);
}
export const displayRequestUsdc=(x:VeyraPaymentRequest)=>formatUnits(BigInt(x.amountRaw),6);

export type PeerClaimStatus={request:VeyraPaymentRequest;matches:boolean};
export async function readPeerRequestAttempt(token:string,requestId:string,
 walletAddress:string,attemptId:string):Promise<PeerClaimStatus>{
 const data=await requestApi(token,'/attempt',{requestId,walletAddress,attemptId});
 if(typeof data.matches!=='boolean')throw Error('Invalid owner-scoped payment attempt status.');
 return {request:parsed(data.request),matches:data.matches};
}
/** Re-submit only the original reservation key, never a second transaction.
 * If the claim RESPONSE was lost, query the authoritative server by the exact
 * attemptId. A failed lookup is UNKNOWN and must not open the wallet.
 */
export async function claimPeerRequest(token:string,requestId:string,walletAddress:string,attemptId:string){
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(attemptId))
  throw Error('Original payment attempt key is missing or invalid.');
 try{
  const data=await requestApi(token,'/claim',{requestId,attemptId,walletAddress});
  const request=parsed(data.request);
  if(typeof data.created!=='boolean'||!request.paymentInProgress||request.status!=='PENDING')
   throw Error('Payment claim was not verified. Do not open the wallet.');
  return {request,recovered:!data.created};
 }catch(e){
  // Confirmed 4xx refuses wallet signing. Network/5xx/malformed replies may
  // mean the reservation committed, so read the original key before deciding.
  if(confirmedPaymentRequestRefusal(e))throw e;
  const status=await readPeerRequestAttempt(token,requestId,walletAddress,attemptId);
  if(!status.matches||status.request.status!=='PENDING')
   throw Error('Claim outcome unknown or request already settled. Do not sign again.');
  return {request:status.request,recovered:true};
 }
}
/** Wallet rejection is accepted only when the provider explicitly returns
 * code 4001 or ACTION_REJECTED (viem/wagmi may nest the cause).
 * This is NOT an onchain absence proof. Never delete the server claim.
 */
export function explicitlyRejectedWallet(error:unknown):boolean{
 let next:unknown=error;
 for(let depth=0;depth<5;depth++){
  if(!next||typeof next!=='object')return false;
  const x=next as {code?:unknown;cause?:unknown};
  if(x.code===4001||x.code==='ACTION_REJECTED')return true;
  next=x.cause;
 }
 return false;
}
