/** Mainnet Circle Gateway ledger, NOT ERC20 wallet balances. 
 * Gateway supports Arc, Base and Ethereum; SDK reads do not authorize signing.
 * Pending is never spendable. Unreadable/missing data is UNKNOWN, never zero.
 */
import {AppKit} from '@circle-fin/app-kit';
import {getAddress,isAddress,parseUnits,formatUnits} from 'viem';
import {getMainnetChain} from '@/config/mainnetCatalog';
export const GATEWAY_MAINNET_CHAINS=[
 {chainId:5042,chain:'Arc',name:'Arc',domain:26,logo:'arc',gas:'USDC',usdc:getMainnetChain(5042)!.usdc},
 {chainId:1,chain:'Ethereum',name:'Ethereum',domain:0,logo:'ethereum',gas:'ETH',usdc:getMainnetChain(1)!.usdc},
 {chainId:8453,chain:'Base',name:'Base',domain:6,logo:'base',gas:'ETH',usdc:getMainnetChain(8453)!.usdc},
] as const;
export type GatewayMainnetChain=typeof GATEWAY_MAINNET_CHAINS[number];
export type GatewayMainnetBalance={
 owner:string;readAt:number;available:bigint;pending:bigint|null;
 chains:ReadonlyArray<{chainId:number;domain:number;chain:string;available:bigint}>;
};
const DEC=/^(?:0|[1-9][0-9]{0,17})(?:\.[0-9]{1,6})?$/;
const amount=(x:unknown):bigint=>{
 if(typeof x!=='string'||!DEC.test(x))throw Error('Circle USDC amount was missing or malformed.');
 return parseUnits(x,6);
};
export function parseGatewayMainnetBalance(raw:unknown,owner:string,now=Date.now()):GatewayMainnetBalance{
 if(!isAddress(owner)||!raw||typeof raw!=='object'||Array.isArray(raw))
  throw Error('Gateway balance response or owner invalid.');
 const data=raw as Record<string,unknown>;
 if(data.token!=='USDC'||!Array.isArray(data.breakdown)||data.breakdown.length!==1)
  throw Error('Circle returned no complete owner-scoped Gateway USDC ledger.');
 const account=(data.breakdown as unknown[])[0];
 if(!account||typeof account!=='object'||Array.isArray(account))
  throw Error('Gateway owner data missing.');
 const depositor=account as Record<string,unknown>;
 if(typeof depositor.depositor!=='string'||!isAddress(depositor.depositor)||
  depositor.depositor.toLowerCase()!==owner.toLowerCase()||!Array.isArray(depositor.breakdown))
  throw Error('Gateway ledger belongs to a different owner or is incomplete.');
 const total=amount(data.totalConfirmedBalance);
 if(amount(depositor.totalConfirmed)!==total)throw Error('Gateway confirmed totals disagree.');
 const seen=new Set<string>();
 const entries=(depositor.breakdown as unknown[]).map(v=>{
  if(!v||typeof v!=='object'||Array.isArray(v))throw Error('Gateway chain row missing.');
  const x=v as Record<string,unknown>;
  const chain=GATEWAY_MAINNET_CHAINS.find(c=>c.chain===x.chain);
  if(!chain||seen.has(chain.chain))throw Error('Gateway chain is duplicated or unsupported.');
  seen.add(chain.chain);
  return {chainId:chain.chainId,domain:chain.domain,chain:chain.chain,available:amount(x.confirmedBalance)};
 });
 const sum=entries.reduce((a,b)=>a+b.available,0n);
 if(sum!==total)throw Error('Gateway breakdown does not match total available USDC.');
 const byChain=GATEWAY_MAINNET_CHAINS.map(chain=>entries.find(x=>x.chain===chain.chain)??{
  chainId:chain.chainId,domain:chain.domain,chain:chain.chain,available:0n,
 });
 // Only Circle's explicit pending total is accepted; never infer pending=0 from absence.
 const pending=data.totalPendingBalance===undefined||data.totalPendingBalance===null?
  null:amount(data.totalPendingBalance);
 return {owner:getAddress(owner).toLowerCase(),readAt:now,available:total,pending,chains:byChain};
}
export const gatewayMainnetAmount=(value:string)=>DEC.test(value)&&parseUnits(value,6)>0n;
export const formatGatewayUsdc=(value:bigint|null)=>value===null?'—':formatUnits(value,6);
export async function fetchGatewayMainnetBalances(owner:string):Promise<GatewayMainnetBalance>{
 if(!isAddress(owner))throw Error('Connect a valid EVM wallet before reading Unified Balance.');
 const kit=new AppKit();
 const response=await kit.unifiedBalance.getBalances({
  sources:{address:getAddress(owner),chains:GATEWAY_MAINNET_CHAINS.map(c=>c.chain)},
  networkType:'mainnet',token:'USDC',includePending:true,
 });
 return parseGatewayMainnetBalance(response,owner);
}
/** Public-beta execution is a separate authorization, not an E2E acceptance claim.
 * Quote, wallet signature, source confirmations and destination proof remain required.
 */
export const GATEWAY_MAINNET_WRITE_ENABLED =
 import.meta.env.VITE_VEYRA_GATEWAY_MAINNET_WRITE_ENABLED==='1'&&
 ((import.meta.env.VITE_VEYRA_PUBLIC_BETA==='1'&&
   import.meta.env.VITE_VEYRA_GATEWAY_MAINNET_BETA_ENABLED==='1')||
  import.meta.env.VITE_VEYRA_GATEWAY_MAINNET_E2E_ACCEPTED==='1');
