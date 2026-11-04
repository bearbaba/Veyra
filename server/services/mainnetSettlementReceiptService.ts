/** Independently proved Arc 5042 VeyraSettlement.pay receipt indexing.
 * Does not sign funds. The original chain transaction, NOT any client-provided
 * sender/amount/recipient, determines the immutable evidence.
 */
import {createPublicClient,http,getAddress,isAddress,type Hex} from 'viem';
import {and,desc,eq,isNull,or} from 'drizzle-orm';
import type {DbClient} from '../db/client.js';
import {mainnetSettlementReceipts} from '../db/schema/mainnetSettlement.js';
import {verifyCanonicalSettlement,SettlementProofError,type CanonicalSettlementProof}
 from './mainnetSettlementProof.js';
import {mainnetActiveBinding,mainnetRpcUrl,PayReceiptApiError,
 verifyRecipientSnapshotForReceipt} from './mainnetPayReceiptService.js';

const reject=(code:string,status=409):never=>{throw new PayReceiptApiError(code,status);};
const HASH=/^0x[0-9a-f]{64}$/i;
export function parseSettlementReceiptRequest(input:unknown):{hash:Hex;note?:string;snapshotId?:string}{
 if(!input||typeof input!=='object'||Array.isArray(input))return reject('INVALID_SETTLEMENT_RECEIPT',400);
 const value=input as Record<string,unknown>;
 if(typeof value.hash!=='string'||!HASH.test(value.hash))return reject('INVALID_SETTLEMENT_HASH',400);
 if(value.note!==undefined&&(typeof value.note!=='string'||value.note.length>120))
  return reject('INVALID_PRIVATE_NOTE',400);
 if(value.snapshotId!==undefined&&(typeof value.snapshotId!=='string'||
    !/^snp_[1-9A-HJ-NP-Za-km-z]{10,}$/.test(value.snapshotId)))
  return reject('INVALID_SNAPSHOT_ID',400);
 return {hash:value.hash.toLowerCase() as Hex,
  ...(typeof value.note==='string'?{note:value.note}:{}),
  ...(typeof value.snapshotId==='string'?{snapshotId:value.snapshotId}:{})};
}
export async function readCanonicalMainnetSettlementProof(
 hash:Hex,expectedSender:string,rpcUrl=mainnetRpcUrl(),
):Promise<CanonicalSettlementProof>{
 const client=createPublicClient({transport:http(rpcUrl,{timeout:12000,retryCount:0})});
 try{
  const chainId=await client.getChainId();
  if(chainId!==5042)return reject('WRONG_MAINNET_CHAIN',503);
  const [tx,receipt,tip]=await Promise.all([
   client.getTransaction({hash}),client.getTransactionReceipt({hash}),client.getBlockNumber()]);
  if(tx.blockNumber===null||receipt.blockNumber>tip)return reject('SETTLEMENT_PENDING_CONFIRMATIONS');
  const block=await client.getBlock({blockNumber:receipt.blockNumber});
  const proof=verifyCanonicalSettlement({chainId,expectedSender,
   transaction:{hash:tx.hash,from:tx.from,to:tx.to,input:tx.input,value:tx.value,blockHash:tx.blockHash},
   receipt:{transactionHash:receipt.transactionHash,blockHash:receipt.blockHash,
    blockNumber:receipt.blockNumber,status:receipt.status,gasUsed:receipt.gasUsed,
    effectiveGasPrice:receipt.effectiveGasPrice,
    logs:receipt.logs.map(log=>({address:log.address,topics:log.topics,data:log.data}))},
   block:{number:block.number,hash:block.hash??'',timestamp:block.timestamp},
   tipBlockNumber:tip,minConfirmations:2,
  });
  if(proof.txHash!==hash.toLowerCase())return reject('SETTLEMENT_HASH_MISMATCH');
  return proof;
 }catch(e){
  if(e instanceof PayReceiptApiError)throw e;
  if(e instanceof SettlementProofError)return reject(e.code);
  return reject('MAINNET_SETTLEMENT_NOT_VERIFIED',503);
 }
}
type Row=typeof mainnetSettlementReceipts.$inferSelect;
export function visibleSettlementReceipt(row:Row,userId:string){
 return {kind:'settlement' as const,txHash:row.txHash,chainId:5042 as const,
  contractAddress:row.contractAddress,paymentId:row.paymentId,paymentRef:row.paymentRef,
  senderAddress:row.senderAddress,recipientAddress:row.recipientAddress,
  senderUserId:row.senderUserId,recipientUserId:row.recipientUserId,
  recipientLabel:row.recipientLabel,
  amountRaw:row.amountRaw,netAmountRaw:row.netAmountRaw,
  protocolFeeRaw:row.protocolFeeRaw,feeWei:row.networkFeeWei,
  blockNumber:row.blockNumber,paidAt:row.paidAt,createdAt:row.createdAt,
  verifiedAt:row.verifiedAt,
  direction:row.senderUserId===userId?'sent' as const:'received' as const,
  ...(row.senderUserId===userId&&row.senderPrivateNote?
   {privateNote:row.senderPrivateNote}:{})};
}
export async function indexVerifiedSettlement(
 db:DbClient,userId:string,input:{hash:Hex;note?:string;snapshotId?:string},
 readProof:typeof readCanonicalMainnetSettlementProof=readCanonicalMainnetSettlementProof,
){
 const prior=await db.select().from(mainnetSettlementReceipts)
   .where(eq(mainnetSettlementReceipts.txHash,input.hash)).limit(1);
 if(prior.length){
  const existing=prior[0]!;
  if(existing.senderUserId!==userId&&existing.recipientUserId!==userId)
   return reject('RECEIPT_NOT_OWNED',403);
  if((input.note!==undefined||input.snapshotId!==undefined)&&existing.senderUserId!==userId)
   return reject('SENDER_REQUIRED_FOR_METADATA',403);
  if(input.note?.trim()&&existing.senderPrivateNote===null)
   await db.update(mainnetSettlementReceipts).set({senderPrivateNote:input.note.trim()})
    .where(and(eq(mainnetSettlementReceipts.txHash,input.hash),
     eq(mainnetSettlementReceipts.senderUserId,userId),
     isNull(mainnetSettlementReceipts.senderPrivateNote)));
  if(input.snapshotId&&existing.recipientSnapshotId===null){
   try{
    const identity=await verifyRecipientSnapshotForReceipt(db,input.snapshotId,
     existing.recipientAddress,existing.recipientUserId,existing.paidAt);
    await db.update(mainnetSettlementReceipts)
     .set({recipientSnapshotId:identity.snapshotId,recipientLabel:identity.label})
     .where(and(eq(mainnetSettlementReceipts.txHash,input.hash),
       eq(mainnetSettlementReceipts.senderUserId,userId),
       isNull(mainnetSettlementReceipts.recipientSnapshotId)));
   }catch(e){if(!(e instanceof PayReceiptApiError))throw e;}
  }
  const latest=await db.select().from(mainnetSettlementReceipts)
   .where(eq(mainnetSettlementReceipts.txHash,input.hash)).limit(1);
  return visibleSettlementReceipt(latest[0]??existing,userId);
 }
 // Obtain sender from RPC solely to determine the authorized wallet binding;
 // no client-provided wallet address may create an owned receipt.
 const rpc=mainnetRpcUrl();
 const client=createPublicClient({transport:http(rpc,{timeout:12000,retryCount:0})});
 let senderAddress:string;
 try{senderAddress=(await client.getTransaction({hash:input.hash})).from;}
 catch{return reject('SETTLEMENT_NOT_INDEXED',503);}
 const sender=await mainnetActiveBinding(db,senderAddress);
 if(sender?.userId!==userId&&(input.note!==undefined||input.snapshotId!==undefined))
  return reject('SENDER_REQUIRED_FOR_METADATA',403);
 const proof=await readProof(input.hash,senderAddress,rpc);
 const receiver=await mainnetActiveBinding(db,proof.recipient);
 if(sender?.userId!==userId&&receiver?.userId!==userId)
  return reject('RECEIPT_NOT_OWNED',403);
 const paidAt=new Date(Number(proof.blockTimeSeconds)*1000);
 let snapshotId:string|null=null,recipientLabel:string|null=null;
 if(input.snapshotId&&sender?.userId===userId){
  try{
   const identity=await verifyRecipientSnapshotForReceipt(db,input.snapshotId,
    proof.recipient,receiver?.userId??null,paidAt);
   snapshotId=identity.snapshotId;recipientLabel=identity.label;
  }catch(e){if(!(e instanceof PayReceiptApiError))throw e;}
 }
 const values={
  txHash:proof.txHash,chainId:5042,contractAddress:proof.contractAddress,
  paymentId:proof.paymentId,paymentRef:proof.ref,
  senderAddress:getAddress(proof.sender).toLowerCase(),
  recipientAddress:getAddress(proof.recipient).toLowerCase(),
  senderUserId:sender?.userId??null,recipientUserId:receiver?.userId??null,
  recipientSnapshotId:snapshotId,recipientLabel,
  amountRaw:proof.amountRaw,netAmountRaw:proof.netAmountRaw,
  protocolFeeRaw:proof.protocolFeeRaw,networkFeeWei:proof.feeWei,
  blockNumber:Number(proof.blockNumber),paidAt,
  senderPrivateNote:sender?.userId===userId?(input.note?.trim()||null):null,
 };
 await db.insert(mainnetSettlementReceipts).values(values).onConflictDoNothing();
 const [saved]=await db.select().from(mainnetSettlementReceipts)
  .where(eq(mainnetSettlementReceipts.txHash,proof.txHash)).limit(1);
 if(!saved)return reject('SETTLEMENT_PERSISTENCE_UNAVAILABLE',503);
 if(saved.senderAddress!==values.senderAddress||
  saved.recipientAddress!==values.recipientAddress||
  saved.contractAddress!==values.contractAddress||
  saved.paymentId!==values.paymentId||saved.paymentRef!==values.paymentRef||
  saved.amountRaw!==values.amountRaw||saved.netAmountRaw!==values.netAmountRaw||
  saved.protocolFeeRaw!==values.protocolFeeRaw||saved.blockNumber!==values.blockNumber||
  saved.paidAt.getTime()!==values.paidAt.getTime())
  return reject('SETTLEMENT_EVIDENCE_CONFLICT');
 if(saved.senderUserId!==userId&&saved.recipientUserId!==userId)
  return reject('RECEIPT_NOT_OWNED',403);
 return visibleSettlementReceipt(saved,userId);
}
export async function listVerifiedSettlements(db:DbClient,userId:string,limit=50){
 const count=Number.isInteger(limit)?Math.max(1,Math.min(100,limit)):50;
 const rows=await db.select().from(mainnetSettlementReceipts)
  .where(or(eq(mainnetSettlementReceipts.senderUserId,userId),
            eq(mainnetSettlementReceipts.recipientUserId,userId)))
  .orderBy(desc(mainnetSettlementReceipts.paidAt)).limit(count);
 return rows.map(row=>visibleSettlementReceipt(row,userId));
}
