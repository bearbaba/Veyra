/** Server-authoritative, owner-private peer payment request lifecycle.
 * Calls neither a wallet nor a transfer; PAID is set only by verified receipts.
 */
import {formatUnits} from 'viem';
import {requireSignedIdentityToken} from './identityApi';
import {paymentRequestRef,PAYMENT_REQUEST_ID,validRequestUsdcAmount} from '../../mainnet/paymentRequestRef';

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

export async function claimPeerRequest(token:string,requestId:string,walletAddress:string){
 const data=await requestApi(token,'/claim',{
  requestId,attemptId:crypto.randomUUID(),walletAddress,
 });
 const request=parsed(data.request);
 if(data.created!==true||!request.paymentInProgress)
  throw Error('Another wallet attempt already exists for this request; do not sign again.');
 return request;
}
