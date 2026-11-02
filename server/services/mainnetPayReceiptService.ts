/** Independent Mainnet USDC receipt indexing. Never signs or resends any funds.
 * Authoritative chain proof and active 5042 wallet binding are both required.
 */
import {createPublicClient,http,getAddress,isAddress,type Hex} from 'viem';
import {and,desc,eq,or,sql} from 'drizzle-orm';
import type {DbClient} from '../db/client.js';
import {mainnetDirectPayReceipts} from '../db/schema/mainnetDirectPay.js';
import {identitySnapshots} from '../db/schema/snapshots.js';
import {verifySnapshot} from './identityResolver.js';
import {verifyCanonicalDirectPay,type CanonicalDirectPayProof} from './mainnetDirectPayProof.js';
const HASH=/^0x[0-9a-fA-F]{64}$/;
const ARC=5042;
export class PayReceiptApiError extends Error{
 constructor(public readonly code:string,public readonly httpStatus=409){
  super(code);this.name='PayReceiptApiError';
 }
}
const reject=(code:string,status=409):never=>{throw new PayReceiptApiError(code,status);};
export function parseDirectPayReceiptRequest(input:unknown):{hash:Hex;note?:string;snapshotId?:string}{
 if(!input||typeof input!=='object'||Array.isArray(input))return reject('INVALID_RECEIPT_REQUEST',400);
 const b=input as Record<string,unknown>;
 if(typeof b.hash!=='string'||!HASH.test(b.hash))return reject('INVALID_TRANSACTION_HASH',400);
 if(b.note!==undefined&&(typeof b.note!=='string'||b.note.length>120))
  return reject('INVALID_PRIVATE_NOTE',400);
 if(b.snapshotId!==undefined&&(typeof b.snapshotId!=='string'||
   !/^snp_[1-9A-HJ-NP-Za-km-z]{10,}$/.test(b.snapshotId)))
  return reject('INVALID_SNAPSHOT_ID',400);
 return {hash:b.hash.toLowerCase() as Hex,
  ...(typeof b.note==='string'?{note:b.note}:{}),
  ...(typeof b.snapshotId==='string'?{snapshotId:b.snapshotId}:{})};
}
export function mainnetRpcUrl(env:NodeJS.ProcessEnv=process.env):string{
 const value=env.ARC_MAINNET_RPC_URL;
 if(!value)return reject('MAINNET_RECEIPT_RPC_NOT_CONFIGURED',503);
 try{
  const url=new URL(value);
  if(url.protocol!=='https:'||url.username||url.password||url.hash||
    /testnet|sepolia|localhost|127\\.0\\.0\\.1/i.test(value))return reject('INVALID_MAINNET_RECEIPT_RPC',503);
 }catch{return reject('INVALID_MAINNET_RECEIPT_RPC',503);}
 return value;
}
export async function readCanonicalMainnetPayProof(
 hash:Hex,expectedSender:string,rpcUrl=mainnetRpcUrl(),
):Promise<CanonicalDirectPayProof>{
 const client=createPublicClient({transport:http(rpcUrl,{timeout:12000,retryCount:0})});
 try{
  const chainId=await client.getChainId();
  if(chainId!==ARC)return reject('WRONG_MAINNET_CHAIN',503);
  const [tx,receipt,tip]=await Promise.all([
   client.getTransaction({hash}),client.getTransactionReceipt({hash}),client.getBlockNumber()]);
  if(tx.blockNumber===null||receipt.blockNumber>tip)return reject('PAYMENT_PENDING_CONFIRMATIONS');
  const block=await client.getBlock({blockNumber:receipt.blockNumber});
  return verifyCanonicalDirectPay({
   chainId,expectedSender,transaction:{
    hash:tx.hash,from:tx.from,to:tx.to,input:tx.input,value:tx.value,blockHash:tx.blockHash,
   },receipt:{
    transactionHash:receipt.transactionHash,blockHash:receipt.blockHash,blockNumber:receipt.blockNumber,
    status:receipt.status,gasUsed:receipt.gasUsed,effectiveGasPrice:receipt.effectiveGasPrice,
    logs:receipt.logs.map(l=>({address:l.address,topics:l.topics,data:l.data})),
   },block:{number:block.number,hash:block.hash??''},tipBlockNumber:tip,minConfirmations:2,
  });
 }catch(e){
  if(e instanceof PayReceiptApiError)throw e;
  if(e instanceof Error&&e.name==='DirectPayProofError')return reject(e.message);
  return reject('MAINNET_RECEIPT_NOT_VERIFIED',503);
 }
}
type BoundWallet={userId:string;walletAddress:string};
export async function mainnetActiveBinding(
 db:DbClient, wallet:string,
):Promise<BoundWallet|null>{
 if(!isAddress(wallet))return null;
 const result=await db.execute(sql`
  SELECT wb.veyr_user_id AS "userId", wb.wallet_address AS "walletAddress"
  FROM wallet_bindings wb JOIN veyra_users u ON u.veyr_user_id=wb.veyr_user_id
  WHERE lower(wb.wallet_address)=lower(${wallet}) AND wb.chain_id=5042
   AND wb.status='ACTIVE' AND wb.revoked_at IS NULL
   AND u.status='ACTIVE' AND u.deleted_at IS NULL LIMIT 1
 `);
 const row=result.rows[0] as BoundWallet|undefined;
 return row&&typeof row.userId==='string'?row:null;
}
export type VerifiedPayRow=typeof mainnetDirectPayReceipts.$inferSelect;
export function visiblePayReceipt(row:VerifiedPayRow,userId:string){
 // Do not leak the sender's private notes to the recipient or other viewers.
 return {txHash:row.txHash,chainId:row.chainId,senderAddress:row.senderAddress,
  recipientAddress:row.recipientAddress,recipientLabel:row.recipientLabel,
  senderUserId:row.senderUserId,recipientUserId:row.recipientUserId,
  amountRaw:row.amountRaw,feeWei:row.feeWei,blockNumber:row.blockNumber,
  createdAt:row.createdAt,verifiedAt:row.verifiedAt,
  direction:row.senderUserId===userId?'sent':'received',
  ...(row.senderUserId===userId&&row.senderPrivateNote?{privateNote:row.senderPrivateNote}:{}),
 };
}
export async function indexVerifiedDirectPay(
 db:DbClient,userId:string,input:{hash:Hex;note?:string;snapshotId?:string},
 readProof:typeof readCanonicalMainnetPayProof=readCanonicalMainnetPayProof,
){
 const current=await db.select().from(mainnetDirectPayReceipts)
  .where(eq(mainnetDirectPayReceipts.txHash,input.hash)).limit(1);
 // Existing validated records are immutable; never duplicate RPC writes.
 if(current.length){
  const existing=current[0]!;
  if(existing.senderUserId!==userId&&existing.recipientUserId!==userId)
   return reject('RECEIPT_NOT_OWNED',403);
  return visiblePayReceipt(existing,userId);
 }
 // Caller must own an active Mainnet wallet on one of the two sides. RPC sender
 // address is authoritative; never use a caller-provided sender or recipient.
 const rpc=mainnetRpcUrl();
 const client=createPublicClient({transport:http(rpc,{timeout:12000,retryCount:0})});
 let senderAddress:string;
 try{senderAddress=(await client.getTransaction({hash:input.hash})).from;}
 catch{return reject('PAYMENT_NOT_INDEXED');}
 const sender=await mainnetActiveBinding(db,senderAddress);
 if(sender?.userId!==userId){
  // A recipient may index a payment, but cannot supply private metadata
  // or pin a Veyra ID label on behalf of the sender.
  if(input.note!==undefined||input.snapshotId!==undefined)
   return reject('SENDER_REQUIRED_FOR_METADATA',403);
 }
 const proof=await readProof(input.hash,senderAddress,rpc);
 const receiver=await mainnetActiveBinding(db,proof.recipient);
 if(sender?.userId!==userId&&receiver?.userId!==userId)
  return reject('RECEIPT_NOT_OWNED',403);
 // Identity name is from an independently validated exact snapshot. Never
 // use the UI's untrusted recipientLabel as an authoritative name.
 let snapshotId:string|null=null,label:string|null=null;
 if(input.snapshotId&&sender?.userId===userId){
  const verified=await verifySnapshot(db,input.snapshotId);
  if(!verified.ok)return reject('RECIPIENT_SNAPSHOT_NOT_VERIFIED');
  const rows=await db.select().from(identitySnapshots)
    .where(eq(identitySnapshots.snapshotId,input.snapshotId)).limit(1);
  const snap=rows[0];
  const wallets=Array.isArray(snap?.resolvedWallets)?snap.resolvedWallets as Array<Record<string,unknown>>:[];
  if(!snap||snap.veyraUserId!==receiver?.userId||!wallets.some(w=>
    typeof w.walletAddress==='string'&&w.walletAddress.toLowerCase()===proof.recipient.toLowerCase()&&
    w.chainId===5042))
    return reject('RECIPIENT_SNAPSHOT_MISMATCH');
  snapshotId=snap.snapshotId;label='@'+snap.veyraHandle+'.veyra';
 }
 const values={txHash:proof.txHash,chainId:5042,senderAddress:getAddress(proof.sender).toLowerCase(),
  recipientAddress:getAddress(proof.recipient).toLowerCase(),
  senderUserId:sender?.userId??null,recipientUserId:receiver?.userId??null,
  recipientSnapshotId:snapshotId,recipientLabel:label,
  amountRaw:proof.amountRaw,feeWei:proof.feeWei,blockNumber:Number(proof.blockNumber),
  senderPrivateNote:sender?.userId===userId?(input.note?.trim()||null):null};
 await db.insert(mainnetDirectPayReceipts).values(values).onConflictDoNothing();
 const rows=await db.select().from(mainnetDirectPayReceipts)
  .where(eq(mainnetDirectPayReceipts.txHash,proof.txHash)).limit(1);
 const saved=rows[0];
 if(!saved)return reject('RECEIPT_PERSISTENCE_UNAVAILABLE',503);
 // Concurrent receipt indexers must not be able to overwrite canonical data.
 if(saved.senderAddress!==values.senderAddress||saved.recipientAddress!==values.recipientAddress||
    saved.amountRaw!==values.amountRaw||saved.blockNumber!==values.blockNumber)
  return reject('RECEIPT_EVIDENCE_CONFLICT',409);
 if(saved.senderUserId!==userId&&saved.recipientUserId!==userId)
  return reject('RECEIPT_NOT_OWNED',403);
 return visiblePayReceipt(saved,userId);
}
export async function listVerifiedDirectPays(db:DbClient,userId:string,limit=50){
 const count=Number.isInteger(limit)?Math.max(1,Math.min(100,limit)):50;
 const rows=await db.select().from(mainnetDirectPayReceipts)
  .where(or(eq(mainnetDirectPayReceipts.senderUserId,userId),
            eq(mainnetDirectPayReceipts.recipientUserId,userId)))
  .orderBy(desc(mainnetDirectPayReceipts.createdAt)).limit(count);
 return rows.map(r=>visiblePayReceipt(r,userId));
}
