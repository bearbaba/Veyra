/** Read-only recovery of a lost original CCTP V2 source transaction hash.
 *
 * Search a bounded onchain event window around a previously stored wallet intent.
 * A matching event is ONLY a candidate: the caller must separately verify
 * transaction sender, receipt, Circle attestation and destination mint.
 * Zero or multiple matching transactions are never guessed or unlocked.
 */
import {parseAbiItem} from 'viem';

export const CCTP_V2_BURN_EVENT=parseAbiItem(
 'event DepositForBurn(address indexed burnToken,uint256 amount,address indexed depositor,bytes32 mintRecipient,uint32 destinationDomain,bytes32 destinationTokenMessenger,bytes32 destinationCaller,uint256 maxFee,uint32 indexed minFinalityThreshold,bytes hookData)'
);

type BurnCandidate={
 transactionHash:string|null;
 args:{burnToken?:string;amount?:bigint;depositor?:string;
  mintRecipient?:string;destinationDomain?:number};
};
export type OriginalCctpSourceReader={
 latestBlock:()=>Promise<bigint>;
 timestamp:(blockNumber:bigint)=>Promise<number>; // Unix seconds
 burnLogs:(fromBlock:bigint,toBlock:bigint)=>Promise<readonly BurnCandidate[]>;
};
export type OriginalCctpSourceSelection={
 owner:string;sourceToken:string;destinationDomain:number;amount:bigint;
 intentCreatedAt:number;
};
const TX=/^0x[0-9a-fA-F]{64}$/;
const ADDRESS=/^0x[0-9a-fA-F]{40}$/;
const MAX_AGE=14*24*3600*1000;
const BEFORE_MS=30_000;
const AFTER_MS=30*60_000;
const CHUNK_SIZE=900n;
const MAX_BLOCKS=20_000n;

async function firstBlockAt(reader:OriginalCctpSourceReader,head:bigint,seconds:number){
 let low=0n,high=head;
 while(low<high){
  const middle=(low+high)/2n;
  const timestamp=await reader.timestamp(middle);
  if(!Number.isSafeInteger(timestamp))throw Error('Invalid source block timestamp.');
  if(timestamp<seconds)low=middle+1n;else high=middle;
 }
 return low;
}

export async function discoverOriginalCctpSource(
 reader:OriginalCctpSourceReader,
 input:OriginalCctpSourceSelection,
 now=Date.now(),
):Promise<string|null>{
 if(!ADDRESS.test(input.owner)||!ADDRESS.test(input.sourceToken)||
  !Number.isSafeInteger(input.intentCreatedAt)||input.intentCreatedAt<=0||
  input.intentCreatedAt>now+60_000||now-input.intentCreatedAt>MAX_AGE||
  !Number.isSafeInteger(input.destinationDomain)||input.destinationDomain<0||
  input.amount<=0n)return null;
 const from=Math.floor(Math.max(0,input.intentCreatedAt-BEFORE_MS)/1000);
 const until=Math.floor(Math.min(now,input.intentCreatedAt+AFTER_MS)/1000);
 if(until<from)return null;
 const head=await reader.latestBlock();
 const [first,last]=await Promise.all([
  firstBlockAt(reader,head,from),
  firstBlockAt(reader,head,until),
 ]);
 if(first>last||last-first>MAX_BLOCKS)return null;
 const recipient='0x'+'0'.repeat(24)+input.owner.slice(2).toLowerCase();
 const tokens=input.sourceToken.toLowerCase();
 const matches=new Set<string>();
 for(let current=first;current<=last;current+=CHUNK_SIZE){
  const end=current+CHUNK_SIZE-1n>last?last:current+CHUNK_SIZE-1n;
  const logs=await reader.burnLogs(current,end);
  if(logs.length>1500)return null;
  for(const item of logs){
   if(!item.transactionHash||!TX.test(item.transactionHash))continue;
   if(item.args.burnToken?.toLowerCase()!==tokens||
    item.args.amount!==input.amount||
    item.args.destinationDomain!==input.destinationDomain||
    item.args.mintRecipient?.toLowerCase()!==recipient)continue;
   matches.add(item.transactionHash.toLowerCase());
   if(matches.size>1)return null;
  }
 }
 return matches.size===1?[...matches][0]:null;
}
