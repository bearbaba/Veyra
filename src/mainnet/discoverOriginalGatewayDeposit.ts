/** Read-only source discovery for a Gateway deposit whose wallet/provider
 * result lost its transaction hash after a signed, durable UNKNOWN checkpoint.
 *
 * A USDC Transfer alone is NOT enough: require the original wallet, source
 * chain, exact Gateway Wallet deposit() calldata, token and amount, and
 * a single candidate in a bounded block-time window. The normal independent
 * reconciler MUST still verify a canonical finalized receipt.
 *
 * Absence, ambiguity, RPC failures or unsupported networks never unlock,
 * retry or automatically send USDC.
 */
import {decodeFunctionData,getAddress,isAddress,parseUnits,type Hex} from 'viem';
import {getMainnetChain} from '@/config/mainnetCatalog';
import {gatewayDepositAbi,GATEWAY_MAINNET_WALLET} from './gatewayMainnetReconcile';
import {validGatewayMainnetOperation,type GatewayMainnetOperation} from './gatewayMainnetJournal';
import {GATEWAY_MAINNET_CHAINS} from './gatewayMainnetBalances';

const HASH=/^0x[0-9a-fA-F]{64}$/;
const BEFORE_MS=120_000;
const AFTER_MS=60*60_000;
const MAX_AGE_MS=30*24*60*60_000;
const SCAN_CHUNK=1_500n;
const MAX_SPAN=30_000n;
export type GatewayDepositTransferLog={
 transactionHash:string;blockNumber:bigint;value:bigint;
};
export type GatewayDepositSourceReader={
 chainId:()=>Promise<number>;
 latestBlock:()=>Promise<bigint>;
 blockTimestamp:(blockNumber:bigint)=>Promise<bigint>;
 transferLogs:(fromBlock:bigint,toBlock:bigint,owner:string,usdc:string,gateway:string)=>
  Promise<readonly GatewayDepositTransferLog[]>;
 getTransaction:(hash:`0x${string}`)=>Promise<{
  hash:string;from:string;to:string|null;input:string;
 }>;
};
async function lowerBlock(reader:GatewayDepositSourceReader,last:bigint,target:bigint):Promise<bigint>{
 let lo=0n,hi=last;
 while(lo<hi){
  const mid=(lo+hi)/2n;
  if(await reader.blockTimestamp(mid)<target)lo=mid+1n;
  else hi=mid;
 }
 return lo;
}
/** Returns only a uniquely matching onchain candidate hash; it is never
 * treated as proof of finality or individual Circle Gateway credit.
 */
export async function discoverOriginalGatewayDeposit(
 reader:GatewayDepositSourceReader,
 operation:GatewayMainnetOperation,
 now=Date.now(),
):Promise<`0x${string}`|null>{
 if(!validGatewayMainnetOperation(operation,operation.owner)||
  operation.kind!=='deposit'||operation.sourceHash||
  !['UNKNOWN','SUBMITTED'].includes(operation.status)||
  !Number.isSafeInteger(now)||operation.createdAt>now+30_000||
  now-operation.createdAt>MAX_AGE_MS||
  !GATEWAY_MAINNET_CHAINS.some(chain=>chain.chainId===operation.chainId))
  return null;
 const chain=getMainnetChain(operation.chainId);
 if(!chain||!isAddress(chain.usdc)||await reader.chainId()!==operation.chainId)return null;
 const last=await reader.latestBlock();
 if(last<0n)return null;
 const lastTime=await reader.blockTimestamp(last);
 const fromTime=BigInt(Math.floor(Math.max(0,operation.createdAt-BEFORE_MS)/1000));
 const toTime=BigInt(Math.floor(Math.min(now,operation.createdAt+AFTER_MS)/1000));
 if(lastTime<fromTime||toTime<fromTime)return null;
 const from=await lowerBlock(reader,last,fromTime);
 const until=lastTime<=toTime?last+1n:await lowerBlock(reader,last,toTime+1n);
 if(until<=from||until-from>MAX_SPAN)return null;
 const owner=getAddress(operation.owner).toLowerCase();
 const token=getAddress(chain.usdc).toLowerCase();
 const gateway=getAddress(GATEWAY_MAINNET_WALLET).toLowerCase();
 const amount=parseUnits(operation.amount,6);
 const candidates=new Set<string>();
 for(let start=from;start<until;start+=SCAN_CHUNK){
  const end=start+SCAN_CHUNK<until?start+SCAN_CHUNK:until;
  const logs=await reader.transferLogs(start,end-1n,owner,token,gateway);
  for(const log of logs){
   if(log.value!==amount||log.blockNumber<start||log.blockNumber>=end||
    !HASH.test(log.transactionHash))continue;
   candidates.add(log.transactionHash.toLowerCase());
   // Two plausible deposits in the same window make attribution ambiguous.
   if(candidates.size>1)return null;
  }
 }
 if(candidates.size!==1)return null;
 const hash=[...candidates][0] as `0x${string}`;
 const transaction=await reader.getTransaction(hash);
 if(transaction.hash.toLowerCase()!==hash||!isAddress(transaction.from)||
  transaction.from.toLowerCase()!==owner||!transaction.to||
  !isAddress(transaction.to)||transaction.to.toLowerCase()!==gateway||
  !/^0x[0-9a-fA-F]+$/.test(transaction.input))return null;
 try{
  const call=decodeFunctionData({abi:gatewayDepositAbi,data:transaction.input as Hex});
  if(call.functionName!=='deposit'||getAddress(call.args[0]).toLowerCase()!==token||
   call.args[1]!==amount)return null;
 }catch{return null;}
 return hash;
}
