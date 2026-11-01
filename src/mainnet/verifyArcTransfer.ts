import {decodeFunctionData,formatUnits,parseAbi,toEventSelector} from 'viem';
import {arcMainnetRpc,assertArcMainnetNetwork,ARC_MAINNET_USDC} from './arcMainnetPay';
const HASH=/^0x[0-9a-fA-F]{64}$/;
const ABI=parseAbi(['function transfer(address to,uint256 amount) returns (bool)']);
const TOPIC=toEventSelector('Transfer(address,address,uint256)');
const asObj=(v:unknown):Record<string,unknown>=>{if(!v||typeof v!=='object'||Array.isArray(v))throw Error('Malformed RPC response');return v as Record<string,unknown>};
const n=(v:unknown)=>{if(typeof v!=='string'||!/^0x[0-9a-fA-F]+$/.test(v))throw Error('Invalid RPC number');return BigInt(v)};
const topic=(a:string)=>'0x'+a.slice(2).toLowerCase().padStart(64,'0');
export type Inspection={status:'PENDING'|'REVERTED'|'UNVERIFIED'|'VERIFIED';hash:string;detail:string};
export async function inspectArcTransfer(hash:string,owner:string):Promise<Inspection>{
if(!HASH.test(hash)||!/^0x[0-9a-fA-F]{40}$/.test(owner))throw Error('Invalid hash or connected wallet');
await assertArcMainnetNetwork();
const txRaw=await arcMainnetRpc('eth_getTransactionByHash',[hash]);
if(!txRaw)return {status:'PENDING',hash,detail:'Transaction not indexed yet'};
const tx=asObj(txRaw);
if(typeof tx.from!=='string'||tx.from.toLowerCase()!==owner.toLowerCase()||
typeof tx.to!=='string'||tx.to.toLowerCase()!==ARC_MAINNET_USDC.toLowerCase()||n(tx.value)!==0n)
return {status:'UNVERIFIED',hash,detail:'Wrong sender, token contract, or value'};
let recipient:string,amount:bigint;
try{const decoded=decodeFunctionData({abi:ABI,data:tx.input as `0x${string}`});
if(decoded.functionName!=='transfer')throw Error();recipient=decoded.args[0];amount=decoded.args[1];
if(amount<=0n)throw Error();}catch{return {status:'UNVERIFIED',hash,detail:'Not a canonical USDC transfer'};}
const raw=await arcMainnetRpc('eth_getTransactionReceipt',[hash]);
if(!raw)return {status:'PENDING',hash,detail:'Awaiting receipt'};
const receipt=asObj(raw);
if(typeof receipt.transactionHash!=='string'||receipt.transactionHash.toLowerCase()!==hash.toLowerCase())throw Error('Receipt mismatch');
if(receipt.status==='0x0')return {status:'REVERTED',hash,detail:'Reverted on Arc'};
if(receipt.status!=='0x1')return {status:'UNVERIFIED',hash,detail:'Receipt status unknown'};
if(typeof receipt.blockHash!=='string'||!HASH.test(receipt.blockHash))throw Error('Missing block hash');
const block=asObj(await arcMainnetRpc('eth_getBlockByNumber',[receipt.blockNumber,false]));
if(typeof block.hash!=='string'||block.hash.toLowerCase()!==receipt.blockHash.toLowerCase()||
typeof tx.blockHash!=='string'||tx.blockHash.toLowerCase()!==receipt.blockHash.toLowerCase())throw Error('Block mismatch');
const logs=Array.isArray(receipt.logs)?receipt.logs:[];
const ok=logs.some((v:unknown)=>{if(!v||typeof v!=='object')return false;
const e=v as Record<string,unknown>,t=e.topics;
try{return typeof e.address==='string'&&e.address.toLowerCase()===ARC_MAINNET_USDC.toLowerCase()&&
Array.isArray(t)&&t.length===3&&typeof t[0]==='string'&&t[0].toLowerCase()===TOPIC.toLowerCase()&&
typeof t[1]==='string'&&t[1].toLowerCase()===topic(owner)&&
typeof t[2]==='string'&&t[2].toLowerCase()===topic(recipient)&&n(e.data)===amount;}catch{return false;}});
return ok?{status:'VERIFIED',hash,detail:formatUnits(amount,6)+' USDC sent to '+recipient+' · block '+n(receipt.blockNumber)}:
{status:'UNVERIFIED',hash,detail:'Canonical USDC Transfer log not found'};
}