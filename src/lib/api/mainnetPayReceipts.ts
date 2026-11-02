/** Signed-session server receipt history. This API NEVER requests a wallet transfer. */
import {requireSignedIdentityToken} from './identityApi';
export type MainnetPayServerReceipt={
 txHash:string;chainId:5042;senderAddress:string;recipientAddress:string;
 senderUserId:string|null;recipientUserId:string|null;recipientLabel:string|null;
 amountRaw:string;feeWei:string;blockNumber:number;paidAt:string;createdAt:string;verifiedAt:string;
 direction:'sent'|'received';privateNote?:string;
};
async function receiptResponse<T>(response:Response):Promise<T>{
 if(!(response.headers.get('content-type')??'').toLowerCase().includes('application/json'))
  throw Error('The Mainnet receipt backend is not configured on this website.');
 const data:unknown=await response.json();
 if(!data||typeof data!=='object'||Array.isArray(data))
  throw Error('Invalid Mainnet receipt response.');
 const value=data as Record<string,unknown>;
 if(!response.ok||value.ok!==true)
  throw Error(typeof value.error==='string'?value.error:'Mainnet receipt service unavailable.');
 return data as T;
}
const auth=(token:string)=>({Authorization:'Bearer '+requireSignedIdentityToken(token)});
export async function saveVerifiedMainnetPayReceipt(
 token:string,input:{hash:string;note?:string;snapshotId?:string},
):Promise<MainnetPayServerReceipt>{
 const result=await receiptResponse<{ok:true;receipt:MainnetPayServerReceipt}>(await fetch('/api/mainnet/pay/receipt/verify',{
  method:'POST',headers:{...auth(token),'Content-Type':'application/json'},
  body:JSON.stringify(input),cache:'no-store',credentials:'same-origin',
  signal:AbortSignal.timeout(15000),
 }));
 if(!result.receipt||result.receipt.chainId!==5042||
    result.receipt.txHash.toLowerCase()!==input.hash.toLowerCase()||
    !Number.isFinite(Date.parse(result.receipt.paidAt))||!Number.isFinite(Date.parse(result.receipt.verifiedAt)))
  throw Error('Mainnet receipt does not match the original transaction.');
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
