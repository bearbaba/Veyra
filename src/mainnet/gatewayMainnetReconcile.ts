/** Read-only Circle Gateway Mainnet reconciliation.
 * No SDK transfers, approvals, signatures or automatic replay here.
 * Deposit requires exact original GatewayWallet.deposit calldata, USDC transfer event,
 * successful original receipt and independently observed final confirmed ledger credit.
 * Spend requires a matching Circle forwarding reference AND an exact onchain recipient
 * USDC Transfer in its independently confirmed destination receipt.
 */
import {decodeEventLog,decodeFunctionData,erc20Abi,formatUnits,getAddress,
 isAddress,parseAbi,parseUnits,type Hex} from 'viem';
import {getMainnetChain} from '@/config/mainnetCatalog';
import {GATEWAY_MAINNET_CHAINS,type GatewayMainnetBalance} from './gatewayMainnetBalances';
import {archiveGatewayMainnetReceipt,readGatewayMainnetOperation,
 type GatewayMainnetOperation,type GatewayMainnetReceipt,type GatewayStore} from './gatewayMainnetJournal';

export const GATEWAY_MAINNET_WALLET='0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE' as const;
export const GATEWAY_MAINNET_MINTER='0x2222222d7164433c4C09B0b0D809a9b52C04C205' as const;
export const gatewayDepositAbi=parseAbi(['function deposit(address token,uint256 value)']);
const transfer=parseAbi(['event Transfer(address indexed from,address indexed to,uint256 value)']);
const HASH=/^0x[0-9a-fA-F]{64}$/;
export type GatewayChainTx={from:string;to:string|null;input:string;hash:string};
export type GatewayChainReceipt={status:'success'|'reverted';transactionHash:string;blockHash:string;
 logs:ReadonlyArray<{address:string;topics:readonly string[];data:string}>};
export type GatewayForwardedTransfer={transferId:string;status:string;sourceDomain:number;
 destinationDomain:number;sourceDepositor:string;destinationRecipient:string;
 amount:string;destinationTxHash:string};
export type GatewayReconciliationDeps={
 getTransaction:(chainId:number,hash:`0x${string}`)=>Promise<GatewayChainTx>;
 getTransactionReceipt:(chainId:number,hash:`0x${string}`)=>Promise<GatewayChainReceipt>;
 getConfirmedBalances:(owner:string)=>Promise<GatewayMainnetBalance>;
 getForwardingStatus:(transferId:string)=>Promise<unknown>;
};
export type GatewayReconciliation={
 state:'PENDING'|'VERIFIED'|'REVERTED';reason:string;receipt?:GatewayMainnetReceipt;
};
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
  // Successful source receipt must show the exact USDC tokens moving into
  // the pinned GatewayWallet, not an unrelated approval transaction.
  if(receipt.status!=='success')return true;
  return receipt.logs.some(log=>{
   if(log.address.toLowerCase()!==source.usdc.toLowerCase())return false;
   try{
    const event=decodeEventLog({abi:transfer,data:log.data as Hex,
     topics:log.topics as [Hex,...Hex[]]});
    return event.eventName==='Transfer'&&
     event.args.from.toLowerCase()===op.owner&&
     event.args.to.toLowerCase()===GATEWAY_MAINNET_WALLET.toLowerCase()&&
     event.args.value===parseUnits(op.amount,6);
   }catch{return false;}
  });
 }catch{return false;}
}
export function parseGatewayForwardedStatus(raw:unknown,op:GatewayMainnetOperation):GatewayForwardedTransfer|null{
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||!op.transferId||
  op.kind!=='spend'||!op.destinationChainId)return null;
 const x=raw as Record<string,unknown>;
 const from=GATEWAY_MAINNET_CHAINS.find(c=>c.chainId===op.chainId);
 const dest=GATEWAY_MAINNET_CHAINS.find(c=>c.chainId===op.destinationChainId);
 if(!from||!dest||x.transferId!==op.transferId||x.status!=='confirmed'||
  x.sourceDomain!==from.domain||x.destinationDomain!==dest.domain||
  typeof x.sourceDepositor!=='string'||!isAddress(x.sourceDepositor)||
  x.sourceDepositor.toLowerCase()!==op.owner||
  typeof x.destinationRecipient!=='string'||!isAddress(x.destinationRecipient)||
  x.destinationRecipient.toLowerCase()!==op.recipient.toLowerCase()||
  typeof x.amount!=='string'||!/^\d+(?:\.\d{1,6})?$/.test(x.amount)||
  parseUnits(x.amount,6)!==parseUnits(op.amount,6)||
  typeof x.destinationTxHash!=='string'||!HASH.test(x.destinationTxHash))
  return null;
 return x as GatewayForwardedTransfer;
}
function destinationReceived(receipt:GatewayChainReceipt,op:GatewayMainnetOperation):bigint{
 const token=getMainnetChain(op.destinationChainId??-1)?.usdc;
 if(receipt.status!=='success'||!token)return 0n;
 let total=0n;
 for(const log of receipt.logs){
  if(log.address.toLowerCase()!==token.toLowerCase())continue;
  try{
   const e=decodeEventLog({abi:transfer,data:log.data as Hex,
    topics:log.topics as [Hex,...Hex[]]});
   if(e.eventName==='Transfer'&&e.args.to.toLowerCase()===op.recipient.toLowerCase())
    total+=e.args.value;
  }catch{/* ignore unrelated event */}
 }
 return total;
}
export async function reconcileGatewayMainnetOperation(owner:string,
 deps:GatewayReconciliationDeps,store?:GatewayStore):Promise<GatewayReconciliation>{
 const op=readGatewayMainnetOperation(owner,store);
 if(!op||op==='blocked')return {state:'PENDING',reason:'Original Gateway checkpoint is missing or unreadable; no retry.'};
 if(op.kind==='deposit'){
  if(!op.sourceHash||!HASH.test(op.sourceHash))
   return {state:'PENDING',reason:'Awaiting original deposit hash. No new signature is allowed.'};
  // Pending, RPC unavailable or ambiguous remains unresolved and locked.
  const hash=op.sourceHash as `0x${string}`;
  const [tx,receipt]=await Promise.all([
   deps.getTransaction(op.chainId,hash),deps.getTransactionReceipt(op.chainId,hash),
  ]);
  if(!validateDepositTx(op,tx,receipt))
   return {state:'PENDING',reason:'Original transaction does not match this Gateway deposit. Do not resend.'};
  if(receipt.status==='reverted'){
   const proof:GatewayMainnetReceipt={version:1,operationId:op.id,owner:op.owner,
    kind:'deposit',status:'REVERTED',chainId:op.chainId,recipient:op.recipient,
    amount:op.amount,sourceHash:hash,sourceBlockHash:receipt.blockHash,verifiedAt:Date.now()};
   if(!archiveGatewayMainnetReceipt(proof,store))
    return {state:'PENDING',reason:'Verified revert, but history cannot be safely archived; original lock remains.'};
   return {state:'REVERTED',reason:'Original Gateway deposit reverted onchain.',receipt:proof};
  }
  if(op.beforeAvailable===undefined)
   return {state:'PENDING',reason:'Missing independently recorded pre-deposit Gateway balance; no finality claim.'};
  const balances=await deps.getConfirmedBalances(op.owner);
  const after=balances.chains.find(c=>c.chainId===op.chainId)?.available;
  if(balances.owner!==op.owner||after===undefined||
   after<parseUnits(op.beforeAvailable,6)+parseUnits(op.amount,6))
   return {state:'PENDING',reason:'Source deposit confirmed; awaiting Circle Gateway confirmed credit.'};
  const proof:GatewayMainnetReceipt={version:1,operationId:op.id,owner:op.owner,
   kind:'deposit',status:'VERIFIED',chainId:op.chainId,recipient:op.recipient,
   amount:op.amount,sourceHash:hash,sourceBlockHash:receipt.blockHash,
   gatewayConfirmedBefore:op.beforeAvailable,gatewayConfirmedAfter:formatUnits(after,6),
   verifiedAt:Date.now()};
  if(!archiveGatewayMainnetReceipt(proof,store))
   return {state:'PENDING',reason:'Gateway credit observed but receipt storage failed; original lock remains.'};
  return {state:'VERIFIED',reason:'Source transaction and Circle Gateway confirmed credit independently checked.',receipt:proof};
 }
 if(!op.transferId)
  return {state:'PENDING',reason:'Awaiting provider transfer reference. Never re-sign an uncertain burn intent.'};
 const provider=await deps.getForwardingStatus(op.transferId);
 const forwarding=parseGatewayForwardedStatus(provider,op);
 if(!forwarding)
  return {state:'PENDING',reason:'Gateway forwarding transfer is not confirmed with matching owner, recipient and amount.'};
 const destHash=forwarding.destinationTxHash as `0x${string}`;
 const receipt=await deps.getTransactionReceipt(op.destinationChainId!,destHash);
 if(receipt.transactionHash.toLowerCase()!==destHash.toLowerCase()||
   !HASH.test(receipt.blockHash)||receipt.status!=='success')
  return {state:'PENDING',reason:'Gateway destination mint has no successful onchain receipt.'};
 const received=destinationReceived(receipt,op);
 const minimum=op.minimumReceive?parseUnits(op.minimumReceive,6):parseUnits(op.amount,6);
 if(received<minimum||received===0n)
  return {state:'PENDING',reason:'Destination recipient USDC transfer does not meet the reviewed amount after fees.'};
 const proof:GatewayMainnetReceipt={version:1,operationId:op.id,owner:op.owner,
  kind:'spend',status:'VERIFIED',chainId:op.chainId,destinationChainId:op.destinationChainId,
  recipient:op.recipient,amount:op.amount,transferId:op.transferId,
  destinationHash:destHash,destinationBlockHash:receipt.blockHash,
  received:formatUnits(received,6),verifiedAt:Date.now()};
 if(!archiveGatewayMainnetReceipt(proof,store))
  return {state:'PENDING',reason:'Mint verified but receipt archive failed; original operation remains locked.'};
 return {state:'VERIFIED',reason:'Circle forwarding and destination USDC transfer independently verified.',receipt:proof};
}
