/**
 * Arc Testnet only, owner-signed read-triggered incoming USDC reconciliation.
 *
 * This is NOT a realtime 24/7 background indexer. It scans bounded ranges
 * whenever a signed owner explicitly calls sync. A sleeping Render Free
 * instance cannot guarantee notification delivery while users are offline.
 * It does not authorize or sign transfers.
 */
import {and,eq,sql} from 'drizzle-orm';
import type {DbClient} from '../db/client.js';
import {walletBindings} from '../db/schema/wallets.js';
import {veyraUsers} from '../db/schema/identity.js';
import {incomingUsdcCursors,verifiedIncomingUsdc} from '../db/schema/incomingUsdc.js';
import {veyraNotifications} from '../db/schema/notifications.js';
import {newIncomingUsdcId,newNotificationId} from '../db/ids.js';

export const ARC_CHAIN_ID=5042002;
export const ARC_USDC='0x3600000000000000000000000000000000000000';
export const TRANSFER_TOPIC='0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const CONFIRMATIONS=24; // conservative safety margin; not a deterministic-finality assertion
const BLOCK_SPAN=96;
const MAX_LOGS=48;
const HASH=/^0x[0-9a-f]{64}$/i;
const ADDR=/^0x[0-9a-f]{40}$/i;
const HEX=/^0x(?:0|[1-9a-f][0-9a-f]*)$/i;
type RpcLog={address:string;topics:string[];data:string;transactionHash:string;blockNumber:string;blockHash:string;logIndex:string;removed?:boolean};
type RpcReceipt={transactionHash:string;blockHash:string;blockNumber:string;status:string;logs:RpcLog[]};
type RpcBlock={hash:string;number:string};
export class IncomingUsdcError extends Error {
  constructor(public readonly code:string,message:string,public readonly httpStatus=400){
    super(message);this.name='IncomingUsdcError';
  }
}
function invalidRpc():never{throw new IncomingUsdcError('CHAIN_EVIDENCE_INVALID','Untrusted or incomplete chain evidence.',503);}
export function parseQuantity(value:unknown):number{
  if(typeof value!=='string'||!HEX.test(value))return invalidRpc();
  const n=BigInt(value);
  if(n>BigInt(Number.MAX_SAFE_INTEGER))return invalidRpc();
  return Number(n);
}
function rpcUrl(env:NodeJS.ProcessEnv):string{
  const value=env.ARC_TESTNET_RPC_URL;
  if(!value)throw new IncomingUsdcError('INCOMING_SYNC_NOT_CONFIGURED','Incoming USDC sync is not available.',503);
  try{
    const parsed=new URL(value);
    if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.hash)
      throw new Error('untrusted RPC URL');
  }catch{throw new IncomingUsdcError('INCOMING_SYNC_NOT_CONFIGURED','Secure RPC endpoint required.',503);}
  return value;
}
export function recipientTopic(address:string):string{
  if(!ADDR.test(address))throw new IncomingUsdcError('INVALID_BOUND_WALLET','Invalid linked recipient wallet.',409);
  return '0x'+'0'.repeat(24)+address.slice(2).toLowerCase();
}
function topicAddress(value:unknown):string{
  if(typeof value!=='string'||!HASH.test(value)||!/^0x0{24}/i.test(value))return invalidRpc();
  return '0x'+value.slice(-40).toLowerCase();
}
function normalizedLog(value:unknown):RpcLog{
  if(!value||typeof value!=='object'||Array.isArray(value))return invalidRpc();
  const row=value as Partial<RpcLog>;
  if(typeof row.address!=='string'||!ADDR.test(row.address)||
    !Array.isArray(row.topics)||row.topics.length!==3||
    typeof row.topics[0]!=='string'||row.topics[0].toLowerCase()!==TRANSFER_TOPIC||
    typeof row.data!=='string'||!HASH.test(row.data)||
    typeof row.transactionHash!=='string'||!HASH.test(row.transactionHash)||
    typeof row.blockHash!=='string'||!HASH.test(row.blockHash)||
    row.removed===true)return invalidRpc();
  parseQuantity(row.blockNumber);parseQuantity(row.logIndex);
  topicAddress(row.topics[1]);topicAddress(row.topics[2]);
  return row as RpcLog;
}
export function validateIncomingTransfer(log:unknown,wallet:string,blockEnd:number){
  const row=normalizedLog(log);
  const blockNumber=parseQuantity(row.blockNumber);
  const logIndex=parseQuantity(row.logIndex);
  if(row.address.toLowerCase()!==ARC_USDC.toLowerCase()||
     topicAddress(row.topics[2])!==wallet.toLowerCase()||
     blockNumber>blockEnd)return invalidRpc();
  const amount=BigInt(row.data);
  if(amount<=0n)return invalidRpc();
  return {
    txHash:row.transactionHash.toLowerCase(),logIndex,blockNumber,
    blockHash:row.blockHash.toLowerCase(),sender:topicAddress(row.topics[1]),
    recipient:topicAddress(row.topics[2]),amountBaseUnits:amount.toString(),log:row,
  };
}
export async function reconcileIncomingUsdc(db:DbClient,owner:string,
  env:NodeJS.ProcessEnv=process.env,fetchImpl:typeof fetch=fetch){
  const rpc=rpcUrl(env);
  const walletRows=await db.select({
    walletId:walletBindings.walletId,walletAddress:walletBindings.walletAddress,
  }).from(walletBindings).innerJoin(veyraUsers,eq(walletBindings.veyraUserId,veyraUsers.veyraUserId))
    .where(and(eq(walletBindings.veyraUserId,owner),eq(walletBindings.chainId,ARC_CHAIN_ID),
      eq(walletBindings.status,'ACTIVE'),eq(veyraUsers.status,'ACTIVE'))).limit(4);
  if(walletRows.length===0)return {ok:true,checked:0,newNotifications:0,more:false,scope:'arc-testnet-usdc'};
  let sequence=0;
  async function call<T>(method:string,params:unknown[]):Promise<T>{
    const response=await fetchImpl(rpc,{
      method:'POST',headers:{'Content-Type':'application/json'},redirect:'error',
      body:JSON.stringify({jsonrpc:'2.0',id:++sequence,method,params}),
      signal:AbortSignal.timeout(8000),
    });
    if(!response.ok)return invalidRpc();
    const data:unknown=await response.json();
    if(!data||typeof data!=='object'||Array.isArray(data)||!('result' in data)||
      !('jsonrpc' in data)||data.jsonrpc!=='2.0'||!('id' in data)||data.id!==sequence||
      'error' in data||data.result===null)return invalidRpc();
    return data.result as T;
  }
  if(parseQuantity(await call<string>('eth_chainId',[]))!==ARC_CHAIN_ID)return invalidRpc();
  const head=parseQuantity(await call<string>('eth_blockNumber',[]));
  const finalizedHead=Math.max(0,head-CONFIRMATIONS);
  let checked=0,inserted=0,more=false;
  for(const wallet of walletRows){
    if(!ADDR.test(wallet.walletAddress))return invalidRpc();
    const [cursor]=await db.select({lastVerifiedBlock:incomingUsdcCursors.lastVerifiedBlock})
      .from(incomingUsdcCursors).where(eq(incomingUsdcCursors.walletId,wallet.walletId)).limit(1);
    // First enrollment intentionally backfills only a small, bounded window.
    // Later scans resume from the DB cursor and catch up in 96-block chunks.
    const previous=cursor?.lastVerifiedBlock??Math.max(0,finalizedHead-BLOCK_SPAN);
    if(previous>=finalizedHead)continue;
    const end=Math.min(previous+BLOCK_SPAN,finalizedHead);
    const logsRaw=await call<unknown>('eth_getLogs',[{
      fromBlock:'0x'+(previous+1).toString(16),toBlock:'0x'+end.toString(16),
      address:ARC_USDC,topics:[TRANSFER_TOPIC,null,recipientTopic(wallet.walletAddress)],
    }]);
    if(!Array.isArray(logsRaw)||logsRaw.length>MAX_LOGS)return invalidRpc();
    const evidence:ReturnType<typeof validateIncomingTransfer>[]=[];
    for(const item of logsRaw){
      const itemData=validateIncomingTransfer(item,wallet.walletAddress,end);
      if(itemData.blockNumber<=previous)return invalidRpc();
      const receipt=await call<RpcReceipt>('eth_getTransactionReceipt',[itemData.txHash]);
      if(!receipt||receipt.status!=='0x1'||typeof receipt.blockHash!=='string'||
        receipt.blockHash.toLowerCase()!==itemData.blockHash||
        receipt.transactionHash?.toLowerCase()!==itemData.txHash||
        parseQuantity(receipt.blockNumber)!==itemData.blockNumber||
        !Array.isArray(receipt.logs))return invalidRpc();
      const original=receipt.logs.some(log=>
        log.logIndex?.toLowerCase()===itemData.log.logIndex.toLowerCase()&&
        log.address?.toLowerCase()===ARC_USDC.toLowerCase()&&
        log.topics?.[0]?.toLowerCase()===TRANSFER_TOPIC&&
        log.topics?.[1]?.toLowerCase()===itemData.log.topics[1]?.toLowerCase()&&
        log.topics?.[2]?.toLowerCase()===itemData.log.topics[2]?.toLowerCase()&&
        log.data?.toLowerCase()===itemData.log.data.toLowerCase());
      if(!original)return invalidRpc();
      const block=await call<RpcBlock>('eth_getBlockByNumber',
        ['0x'+itemData.blockNumber.toString(16),false]);
      if(!block||block.hash?.toLowerCase()!==itemData.blockHash||
        parseQuantity(block.number)!==itemData.blockNumber)return invalidRpc();
      evidence.push(itemData);
    }
    // Never persist a cursor or notifications before EVERY log in this range
    // passes canonical-block and successful-receipt verification.
    const countNew=await db.transaction(async tx=>{
      let newCount=0;
      for(const event of evidence){
        const [row]=await tx.insert(verifiedIncomingUsdc).values({
          incomingId:newIncomingUsdcId(),ownerUserId:owner,walletId:wallet.walletId,
          chainId:ARC_CHAIN_ID,tokenAddress:ARC_USDC.toLowerCase(),
          txHash:event.txHash,logIndex:event.logIndex,blockNumber:event.blockNumber,
          blockHash:event.blockHash,senderAddress:event.sender,recipientAddress:event.recipient,
          amountBaseUnits:event.amountBaseUnits,
        }).onConflictDoNothing().returning({incomingId:verifiedIncomingUsdc.incomingId});
        if(!row)continue;
        const eventRef=event.txHash+':'+event.logIndex;
        await tx.insert(veyraNotifications).values({
          notificationId:newNotificationId(),ownerUserId:owner,
          kind:'PAYMENT_RECEIVED',eventRef,
        }).onConflictDoNothing();
        newCount++;
      }
      await tx.insert(incomingUsdcCursors).values({
        walletId:wallet.walletId,chainId:ARC_CHAIN_ID,lastVerifiedBlock:end,
      }).onConflictDoUpdate({target:incomingUsdcCursors.walletId,
        set:{lastVerifiedBlock:sql`greatest(${incomingUsdcCursors.lastVerifiedBlock},${end})`,
          updatedAt:new Date()}});
      return newCount;
    });
    checked+=end-previous;inserted+=countNew;
    if(end<finalizedHead)more=true;
  }
  return {ok:true,checked,newNotifications:inserted,more,scope:'arc-testnet-usdc'};
}
