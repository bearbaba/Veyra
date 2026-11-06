/** Circle Gateway read-only reconciliation. Source-chain finality and
 * the provider's separate spendable ledger are independent; never infer
 * individual credit from an aggregate balance delta. No blind resubmission.
 */
import {decodeEventLog,decodeFunctionData,formatUnits,getAddress,isAddress,parseAbi,parseUnits,type Hex} from 'viem';
import {getMainnetChain} from '@/config/mainnetCatalog';
import {GATEWAY_MAINNET_CHAINS} from './gatewayMainnetBalances';
import {archiveGatewayMainnetReceipt,readGatewayMainnetOperation,
 type GatewayMainnetOperation,type GatewayMainnetReceipt,type GatewayStore} from './gatewayMainnetJournal';
export const GATEWAY_MAINNET_WALLET='0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE' as const;
export const GATEWAY_MAINNET_MINTER='0x2222222d7164433c4C09B0b0D809a9b52C04C205' as const;
export const gatewayDepositAbi=parseAbi(['function deposit(address token,uint256 value)']);
const transfer=parseAbi(['event Transfer(address indexed from,address indexed to,uint256 value)']);
const HASH=/^0x[0-9a-fA-F]{64}$/;
export type GatewayChainTx={from:string;to:string|null;input:string;hash:string};
export type GatewayChainReceipt={status:'success'|'reverted';transactionHash:string;blockHash:string;
 blockNumber:bigint;logs:ReadonlyArray<{address:string;topics:readonly string[];data:string}>};
export type GatewayCanonicalBlock={number:bigint;hash:string;timestamp:bigint};
export type GatewayForwardedTransfer={transferId:string;status:string;sourceDomain:number;
 destinationDomain:number;sourceDepositor:string;destinationRecipient:string;
 amount:string;destinationTxHash:string};
export type GatewayReconciliationDeps={
 getTransaction:(chainId:number,hash:`0x${string}`)=>Promise<GatewayChainTx>;
 getTransactionReceipt:(chainId:number,hash:`0x${string}`)=>Promise<GatewayChainReceipt>;
 getCanonicalBlock:(chainId:number,blockNumber:bigint)=>Promise<GatewayCanonicalBlock>;
 getFinalizedBlock:(chainId:number)=>Promise<GatewayCanonicalBlock>;
 getLatestBlockNumber:(chainId:number)=>Promise<bigint>;
 getForwardingStatus?:(transferId:string)=>Promise<unknown>;
};
export type GatewayReconciliation={state:'PENDING'|'SOURCE_FINALIZED'|'VERIFIED'|'REVERTED';reason:string;receipt?:GatewayMainnetReceipt};
/** Circle Gateway lists ~65 Ethereum blocks for Ethereum and Base deposit
 * finality. Base L2 block counts are NOT Ethereum L1 block counts. Therefore
 * require the canonical RPC's 'finalized' tag and >=19 min source-block age on
 * Base, rather than pretending 65 Base blocks satisfy 65 Ethereum blocks.
 * Arc Mainnet has deterministic BFT commit finality; receipt canonicality
 * and latest head inclusion suffice (no Ethereum finalized tag).
 */
export const GATEWAY_FINALITY_POLICY={
 5042:{minDepth:1n,minAgeSeconds:0n,kind:'arc-deterministic'},
 1:{minDepth:65n,minAgeSeconds:0n,kind:'ethereum-finalized'},
 8453:{minDepth:1n,minAgeSeconds:19n*60n,kind:'base-l1-finalized'},
} as const;
export async function verifyGatewayCanonicalFinality(chainId:number,
 receipt:GatewayChainReceipt,deps:GatewayReconciliationDeps):Promise<boolean>{
 const policy=GATEWAY_FINALITY_POLICY[chainId as keyof typeof GATEWAY_FINALITY_POLICY];
 if(!policy||receipt.blockNumber<0n||!HASH.test(receipt.blockHash))return false;
 const [canonical,head]=await Promise.all([
  deps.getCanonicalBlock(chainId,receipt.blockNumber),
  deps.getLatestBlockNumber(chainId),
 ]);
 if(!HASH.test(canonical.hash)||canonical.number!==receipt.blockNumber||
  canonical.hash.toLowerCase()!==receipt.blockHash.toLowerCase()||
  head<receipt.blockNumber+policy.minDepth-1n||canonical.timestamp<0n)return false;
 const now=BigInt(Math.floor(Date.now()/1000));
 if(canonical.timestamp>now||now-canonical.timestamp<policy.minAgeSeconds)return false;
 // Arc BFT commits a block with deterministic finality at inclusion.
 // Do not require an Ethereum-style RPC finalized tag from an Arc node.
 if(policy.kind==='arc-deterministic')return true;
 // Ethereum and Base require the canonical RPC's finalized block tag.
 // The Base L1 settlement bound additionally requires 19 minutes of age.
 const finalized=await deps.getFinalizedBlock(chainId);
 return HASH.test(finalized.hash)&&finalized.number>=receipt.blockNumber&&
  finalized.number<=head;
}
function validateDepositTx(op:GatewayMainnetOperation,tx:GatewayChainTx,receipt:GatewayChainReceipt):boolean{
 try{
  if(!op.sourceHash||tx.hash.toLowerCase()!==op.sourceHash.toLowerCase()||
   receipt.transactionHash.toLowerCase()!==op.sourceHash.toLowerCase()||
   !HASH.test(receipt.blockHash)||!isAddress(tx.from)||!tx.to||
   getAddress(tx.from).toLowerCase()!==op.owner||
   getAddress(tx.to)!==getAddress(GATEWAY_MAINNET_WALLET))return false;
  const source=getMainnetChain(op.chainId);
  if(!source)return false;
  const call=decodeFunctionData({abi:gatewayDepositAbi,data:tx.input as Hex});
  if(call.functionName!=='deposit'||getAddress(call.args[0])!==getAddress(source.usdc)||
   call.args[1]!==parseUnits(op.amount,6))return false;
  if(receipt.status!=='success')return true;
  return receipt.logs.some(log=>{
   if(log.address.toLowerCase()!==source.usdc.toLowerCase())return false;
   try{
    const e=decodeEventLog({abi:transfer,data:log.data as Hex,topics:log.topics as [Hex,...Hex[]]});
    return e.eventName==='Transfer'&&e.args.from.toLowerCase()===op.owner&&
     e.args.to.toLowerCase()===GATEWAY_MAINNET_WALLET.toLowerCase()&&
     e.args.value===parseUnits(op.amount,6);
   }catch{return false;}
  });
 }catch{return false;}
}
/** Circle's documented GET /v1/transfer/{id} response plus
 * GET /v1/transferSpec/{transferSpecHash}, NOT the former invented fields.
 * Only one source burn intent is accepted in this canary.
 * https://developers.circle.com/api-reference/gateway/all/get-transfer-by-id
 * https://developers.circle.com/api-reference/gateway/all/get-transfer-spec
 */
export function parseGatewayForwardedStatus(raw:unknown,op:GatewayMainnetOperation):GatewayForwardedTransfer|null{
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||!op.transferId||
  op.kind!=='spend'||!op.destinationChainId)return null;
 const x=raw as Record<string,unknown>;
 const t=x.transfer,s=x.spec;
 if(!t||typeof t!=='object'||Array.isArray(t)||
  !s||typeof s!=='object'||Array.isArray(s))return null;
 const transferRecord=t as Record<string,unknown>,spec=s as Record<string,unknown>;
 const from=GATEWAY_MAINNET_CHAINS.find(c=>c.chainId===op.chainId);
 const dest=GATEWAY_MAINNET_CHAINS.find(c=>c.chainId===op.destinationChainId);
 const burnIntents=transferRecord.burnIntents,details=transferRecord.forwardingDetails;
 const padded=(value:unknown,wallet:string)=>
  typeof value==='string'&&/^0x[0-9a-fA-F]{64}$/.test(value)&&
  value.toLowerCase()==='0x'+'0'.repeat(24)+wallet.slice(2).toLowerCase();
 if(!from||!dest||!Array.isArray(burnIntents)||burnIntents.length!==1||
  !details||typeof details!=='object'||Array.isArray(details)||
  (details as Record<string,unknown>).forwardingEnabled!==true||
  transferRecord.status!=='finalized'||
  transferRecord.destinationDomain!==dest.domain||
  typeof transferRecord.transactionHash!=='string'||!HASH.test(transferRecord.transactionHash))
  return null;
 const first:unknown=burnIntents[0];
 if(!first||typeof first!=='object'||Array.isArray(first))return null;
 const specHash=(first as Record<string,unknown>).transferSpecHash;
 if(typeof specHash!=='string'||!HASH.test(specHash)||spec.transferSpecHash!==undefined&&
  spec.transferSpecHash!==specHash)return null;
 if(spec.sourceDomain!==from.domain||spec.destinationDomain!==dest.domain||
  !padded(spec.sourceDepositor,op.owner)||!padded(spec.sourceSigner,op.owner)||
  !padded(spec.destinationRecipient,op.recipient)||
  !padded(spec.sourceContract,GATEWAY_MAINNET_WALLET)||
  !padded(spec.destinationContract,GATEWAY_MAINNET_MINTER)||
  !padded(spec.sourceToken,from.usdc)||!padded(spec.destinationToken,dest.usdc)||
  typeof spec.value!=='string'||!/^(?:0|[1-9][0-9]*)$/.test(spec.value)||
  BigInt(spec.value)!==parseUnits(op.amount,6))return null;
 return {transferId:op.transferId,status:'finalized',sourceDomain:from.domain,
  destinationDomain:dest.domain,sourceDepositor:op.owner,destinationRecipient:op.recipient,
  amount:op.amount,destinationTxHash:transferRecord.transactionHash};
}
function destinationReceived(receipt:GatewayChainReceipt,op:GatewayMainnetOperation):bigint{
 const token=getMainnetChain(op.destinationChainId??-1)?.usdc;
 if(receipt.status!=='success'||!token)return 0n;
 let total=0n;
 for(const log of receipt.logs){
  if(log.address.toLowerCase()!==token.toLowerCase())continue;
  try{
   const e=decodeEventLog({abi:transfer,data:log.data as Hex,topics:log.topics as [Hex,...Hex[]]});
   if(e.eventName==='Transfer'&&e.args.to.toLowerCase()===op.recipient.toLowerCase())
    total+=e.args.value;
  }catch{/* not a USDC transfer */}
 }
 return total;
}
export async function reconcileGatewayMainnetOperation(owner:string,
 deps:GatewayReconciliationDeps,store?:GatewayStore):Promise<GatewayReconciliation>{
 const op=readGatewayMainnetOperation(owner,store);
 if(!op||op==='blocked')return {state:'PENDING',reason:'Original Gateway checkpoint is missing or unreadable; no retry.'};
 if(op.kind==='deposit'){
  if(!op.sourceHash||!HASH.test(op.sourceHash))
   return {state:'PENDING',reason:'Original deposit transaction is not known. Never sign again until recovered.'};
  const hash=op.sourceHash as `0x${string}`;
  const [tx,receipt]=await Promise.all([
   deps.getTransaction(op.chainId,hash),deps.getTransactionReceipt(op.chainId,hash),
  ]);
  if(!validateDepositTx(op,tx,receipt))
   return {state:'PENDING',reason:'Original transaction is not a matching Gateway deposit. Do not resend.'};
  if(!await verifyGatewayCanonicalFinality(op.chainId,receipt,deps))
   return {state:'PENDING',reason:'Original source transaction is not yet canonical and finalized on the supported network.'};
  if(receipt.status==='reverted'){
   const proof:GatewayMainnetReceipt={version:1,operationId:op.id,owner:op.owner,
    kind:'deposit',status:'REVERTED',chainId:op.chainId,recipient:op.recipient,
    amount:op.amount,sourceHash:hash,sourceBlockHash:receipt.blockHash,verifiedAt:Date.now()};
   if(!archiveGatewayMainnetReceipt(proof,store))
    return {state:'PENDING',reason:'Source revert finalized, but durable archive is not ready; lock retained.'};
   return {state:'REVERTED',reason:'Original deposit reverted in a canonical finalized block.',receipt:proof};
  }
  // Separate source-chain settlement from the provider's independent
  // Gateway spendable ledger. A finalized source deposit has a complete
  // onchain lifecycle even if Circle cannot attribute an individual credit.
  // Archive its exact original block/hash and release the *submission lock*,
  // NEVER promote this amount to Gateway Available or label credit Verified.
  // Future withdrawals read Circle's confirmed balance directly.
  const proof:GatewayMainnetReceipt={version:1,operationId:op.id,owner:op.owner,
   kind:'deposit',status:'SOURCE_FINALIZED',
   chainId:op.chainId,recipient:op.recipient,amount:op.amount,
   sourceHash:hash,sourceBlockHash:receipt.blockHash,verifiedAt:Date.now()};
  if(!archiveGatewayMainnetReceipt(proof,store))
   return {state:'PENDING',reason:'Deposit finalized onchain, but its durable receipt could not be saved. Check status without signing again.'};
  return {state:'SOURCE_FINALIZED',
   reason:'Deposit finalized onchain; credit attribution is unavailable. Only Circle live Available is spendable.',receipt:proof};
 }
 if(!op.transferId||!deps.getForwardingStatus)
  return {state:'PENDING',reason:'Circle forwarding receipt lookup is not verified; signed transfer remains unresolved.'};
 const forwarding=parseGatewayForwardedStatus(await deps.getForwardingStatus(op.transferId),op);
 if(!forwarding)
  return {state:'PENDING',reason:'Circle forwarding transfer cannot be proven for original owner, recipient and amount.'};
 const hash=forwarding.destinationTxHash as `0x${string}`;
 const receipt=await deps.getTransactionReceipt(op.destinationChainId!,hash);
 if(receipt.transactionHash.toLowerCase()!==hash.toLowerCase()||receipt.status!=='success')
  return {state:'PENDING',reason:'Destination USDC receipt is missing or unsuccessful.'};
 if(!await verifyGatewayCanonicalFinality(op.destinationChainId!,receipt,deps))
  return {state:'PENDING',reason:'Destination transaction is not canonical and finalized yet.'};
 const received=destinationReceived(receipt,op);
 const minimum=op.minimumReceive?parseUnits(op.minimumReceive,6):parseUnits(op.amount,6);
 if(received<minimum||received===0n)
  return {state:'PENDING',reason:'Destination transfer cannot be linked to reviewed recipient and minimum net USDC.'};
 const proof:GatewayMainnetReceipt={version:1,operationId:op.id,owner:op.owner,kind:'spend',
  status:'VERIFIED',chainId:op.chainId,destinationChainId:op.destinationChainId,
  recipient:op.recipient,amount:op.amount,transferId:op.transferId,
  destinationHash:hash,destinationBlockHash:receipt.blockHash,
  received:formatUnits(received,6),verifiedAt:Date.now()};
 if(!archiveGatewayMainnetReceipt(proof,store))
  return {state:'PENDING',reason:'Destination verified, but archive is not durable; original lock retained.'};
 return {state:'VERIFIED',reason:'Circle forwarding and canonical recipient USDC transfer independently verified.',receipt:proof};
}
