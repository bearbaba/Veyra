/** Authenticated contract Settlement history is distinct from legacy direct Pay.
 * No endpoint below can request a wallet signature or execute a transfer.
 */
import {requireSignedIdentityToken} from './identityApi';
import {MainnetReceiptSyncError} from './mainnetPayReceipts';

const HASH=/^0x[0-9a-f]{64}$/i;
export type MainnetSettlementServerReceipt={
 kind:'settlement';txHash:string;chainId:5042;contractAddress:string;
 paymentId:string;paymentRef:string;
 senderAddress:string;recipientAddress:string;
 senderUserId:string|null;recipientUserId:string|null;recipientLabel:string|null;
 amountRaw:string;netAmountRaw:string;protocolFeeRaw:string;
 feeWei:string;blockNumber:number;paidAt:string;createdAt:string;verifiedAt:string;
 direction:'sent'|'received';privateNote?:string;
};
async function readJson<T>(response:Response):Promise<T>{
 if(!(response.headers.get('content-type')??'').toLowerCase().includes('application/json'))
  throw new MainnetReceiptSyncError('review',response.status,'SETTLEMENT_BACKEND_NOT_CONFIGURED');
 const data:unknown=await response.json();
 if(!data||typeof data!=='object'||Array.isArray(data))
  throw new MainnetReceiptSyncError('review',response.status,'INVALID_SETTLEMENT_RESPONSE');
 const payload=data as Record<string,unknown>;
 if(!response.ok||payload.ok!==true){
  const code=typeof payload.error==='string'?payload.error:'SETTLEMENT_RECEIPT_UNAVAILABLE';
  const category=response.status===401||response.status===419?'sign-in':
   response.status===408||response.status===429||response.status>=500?'retry':'review';
  throw new MainnetReceiptSyncError(category,response.status,code);
 }
 return data as T;
}
const headers=(token:string)=>({Authorization:'Bearer '+requireSignedIdentityToken(token)});
export function validSettlementServerReceipt(receipt:unknown):receipt is MainnetSettlementServerReceipt{
 if(!receipt||typeof receipt!=='object'||Array.isArray(receipt))return false;
 const r=receipt as Partial<MainnetSettlementServerReceipt>;
 return r.kind==='settlement'&&r.chainId===5042&&typeof r.txHash==='string'&&HASH.test(r.txHash)&&
  typeof r.paymentId==='string'&&HASH.test(r.paymentId)&&
  typeof r.paymentRef==='string'&&HASH.test(r.paymentRef)&&
  typeof r.contractAddress==='string'&&/^0x[0-9a-f]{40}$/i.test(r.contractAddress)&&
  typeof r.senderAddress==='string'&&/^0x[0-9a-f]{40}$/i.test(r.senderAddress)&&
  typeof r.recipientAddress==='string'&&/^0x[0-9a-f]{40}$/i.test(r.recipientAddress)&&
  r.direction!=='unknown'&&(r.direction==='sent'||r.direction==='received')&&
  typeof r.amountRaw==='string'&&/^[1-9][0-9]*$/.test(r.amountRaw)&&
  typeof r.netAmountRaw==='string'&&/^[1-9][0-9]*$/.test(r.netAmountRaw)&&
  typeof r.protocolFeeRaw==='string'&&/^\d+$/.test(r.protocolFeeRaw)&&
  BigInt(r.netAmountRaw)+BigInt(r.protocolFeeRaw)===BigInt(r.amountRaw)&&
  typeof r.paidAt==='string'&&Number.isFinite(Date.parse(r.paidAt))&&
  typeof r.verifiedAt==='string'&&Number.isFinite(Date.parse(r.verifiedAt))&&
  !(r.direction==='received'&&r.privateNote!==undefined);
}
export async function saveVerifiedMainnetSettlementReceipt(
 token:string,input:{hash:string;note?:string;snapshotId?:string},signal?:AbortSignal,
):Promise<MainnetSettlementServerReceipt>{
 const response=await fetch('/api/mainnet/settlement/receipt/verify',{
  method:'POST',headers:{...headers(token),'Content-Type':'application/json'},
  body:JSON.stringify(input),cache:'no-store',credentials:'same-origin',
  signal:signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000),
 });
 const data=await readJson<{ok:true;receipt:unknown}>(response);
 if(!validSettlementServerReceipt(data.receipt)||data.receipt.txHash.toLowerCase()!==input.hash.toLowerCase())
  throw new MainnetReceiptSyncError('review',200,'SETTLEMENT_RECEIPT_MISMATCH');
 return data.receipt;
}
export async function listVerifiedMainnetSettlementReceipts(token:string,signal?:AbortSignal){
 const response=await fetch('/api/mainnet/settlement/receipts',{
  method:'GET',headers:headers(token),cache:'no-store',credentials:'same-origin',
  signal:signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000),
 });
 const data=await readJson<{ok:true;receipts:unknown}>(response);
 if(!Array.isArray(data.receipts))
  throw new MainnetReceiptSyncError('review',200,'INVALID_SETTLEMENT_RECEIPT_LIST');
 return data.receipts.filter(validSettlementServerReceipt);
}
