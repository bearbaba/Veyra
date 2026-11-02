/** Signed-session server receipt history. This API NEVER requests a wallet transfer. */
import {requireSignedIdentityToken} from './identityApi';
export type MainnetPayServerReceipt={
 txHash:string;chainId:5042;senderAddress:string;recipientAddress:string;
 senderUserId:string|null;recipientUserId:string|null;recipientLabel:string|null;
 amountRaw:string;feeWei:string;blockNumber:number;paidAt:string;createdAt:string;verifiedAt:string;
 direction:'sent'|'received';privateNote?:string;
};
export type ReceiptSyncFailure='retry'|'sign-in'|'review';
export class MainnetReceiptSyncError extends Error {
 constructor(readonly failure:ReceiptSyncFailure,readonly status:number,readonly code:string){super(code);}
}
export function classifyReceiptSyncError(cause:unknown):ReceiptSyncFailure{
 return cause instanceof MainnetReceiptSyncError?cause.failure:'retry';
}
async function receiptResponse<T>(response:Response):Promise<T>{
 if(!(response.headers.get('content-type')??'').toLowerCase().includes('application/json'))
  throw new MainnetReceiptSyncError('review',response.status,'RECEIPT_BACKEND_NOT_CONFIGURED');
 const data:unknown=await response.json();
 if(!data||typeof data!=='object'||Array.isArray(data))
  throw new MainnetReceiptSyncError('review',response.status,'INVALID_RECEIPT_RESPONSE');
 const value=data as Record<string,unknown>;
 if(!response.ok||value.ok!==true){
  const code=typeof value.error==='string'?value.error:'RECEIPT_SERVICE_UNAVAILABLE';
  const failure=response.status===401||response.status===419?'sign-in':
    response.status===408||response.status===429||response.status>=500?'retry':'review';
  throw new MainnetReceiptSyncError(failure,response.status,code);
 }
 return data as T;
}
const auth=(token:string)=>({Authorization:'Bearer '+requireSignedIdentityToken(token)});
export async function saveVerifiedMainnetPayReceipt(
 token:string,input:{hash:string;note?:string;snapshotId?:string},signal?:AbortSignal,
):Promise<MainnetPayServerReceipt>{
 const result=await receiptResponse<{ok:true;receipt:MainnetPayServerReceipt}>(await fetch('/api/mainnet/pay/receipt/verify',{
  method:'POST',headers:{...auth(token),'Content-Type':'application/json'},
  body:JSON.stringify(input),cache:'no-store',credentials:'same-origin',
  signal:signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000),
 }));
 if(!result.receipt||result.receipt.chainId!==5042||
    result.receipt.txHash.toLowerCase()!==input.hash.toLowerCase()||
    !Number.isFinite(Date.parse(result.receipt.paidAt))||!Number.isFinite(Date.parse(result.receipt.verifiedAt)))
  throw new MainnetReceiptSyncError('review',200,'RECEIPT_MISMATCH');
 return result.receipt;
}
export async function listVerifiedMainnetPayReceipts(token:string,signal?:AbortSignal):Promise<MainnetPayServerReceipt[]>{
 const result=await receiptResponse<{ok:true;receipts:MainnetPayServerReceipt[]}>(await fetch('/api/mainnet/pay/receipts',{
  method:'GET',headers:auth(token),cache:'no-store',credentials:'same-origin',
  signal:signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000),
 }));
 if(!Array.isArray(result.receipts))throw Error('Invalid authenticated receipt list.');
 return result.receipts.filter(x=>x&&x.chainId===5042&&/^0x[0-9a-f]{64}$/i.test(x.txHash)&&
  (x.direction==='sent'||x.direction==='received')&&/^\d+$/.test(x.amountRaw)&&
  Number.isFinite(Date.parse(x.paidAt))&&Number.isFinite(Date.parse(x.verifiedAt)));
}
