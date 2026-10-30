/**
 * A Gateway balance is USDC DEPOSITED to Circle Gateway, NOT wallet ERC-20
 * balanceOf. Circle Gateway/App Kit reports only deposited credit.
 * Keep all amounts in 6-decimal exact bigint units; never infer missing rows as 0.
 */
import { getAddress, isAddress, parseUnits } from 'viem';
import { AppKit } from '@circle-fin/app-kit';
import { activeSignedIdentityToken } from '../../lib/api/liveIdentitySession';
import { MANIFEST_CONSTANTS as M } from '../../providers/registry/providerManifest';

export const GATEWAY_TESTNET_WALLET='0x0077777d7EBA4688BDeF3E311b846F25870A19B9' as const;
export const GATEWAY_TESTNET_MINTER='0x0022222ABE238Cc2C7Bb1f21003F0a260052475B' as const;
export const GATEWAY_TESTNET_SOURCES=[
 {chainId:M.ARC_TESTNET_CHAIN_ID,domain:26,name:'Arc Testnet',token:M.ARC_TESTNET_USDC},
 {chainId:M.ETH_SEPOLIA_CHAIN_ID,domain:0,name:'Ethereum Sepolia',token:M.ETH_SEPOLIA_USDC},
 {chainId:M.BASE_SEPOLIA_CHAIN_ID,domain:6,name:'Base Sepolia',token:M.BASE_SEPOLIA_USDC},
] as const;

export type GatewayTestnetSource=typeof GATEWAY_TESTNET_SOURCES[number];
export interface GatewayBalanceSnapshot {
 owner:string;
 readAt:number;
 available:bigint;
 sources:ReadonlyArray<{chainId:number;domain:number;available:bigint}>;
}
export function parseGatewayBalances(raw:unknown,owner:string):GatewayBalanceSnapshot {
 if(!isAddress(owner))throw Error('Gateway wallet address is invalid.');
 if(!raw||typeof raw!=='object'||Array.isArray(raw))
   throw Error('Gateway balance response is invalid.');
 const data=raw as Record<string,unknown>;
 if(data.ok!==true || data.token!=='USDC' || !Array.isArray(data.balances))
   throw Error('Gateway balance API did not verify the USDC response.');
 if(!Number.isFinite(data.readAt)||typeof data.readAt!=='number' ||
    data.readAt>Date.now()+5000||Date.now()-data.readAt>60_000)
   throw Error('Gateway response is stale.');
 const rows=data.balances as unknown[];
 const sources=GATEWAY_TESTNET_SOURCES.map(source=>{
   const matches=rows.filter((entry:unknown)=>{
     if(!entry||typeof entry!=='object'||Array.isArray(entry))return false;
     const x=entry as Record<string,unknown>;
     return x.domain===source.domain && typeof x.depositor==='string' &&
       x.depositor.toLowerCase()===owner.toLowerCase();
   });
   if(matches.length!==1)throw Error('Gateway domain balance is missing or duplicated.');
   const amount=(matches[0] as Record<string,unknown>).balance;
   if(typeof amount!=='string'||!/^\d{1,18}(?:\.\d{1,6})?$/.test(amount))
     throw Error('Gateway returned an invalid six-decimal USDC amount.');
   return {chainId:source.chainId,domain:source.domain,available:parseUnits(amount,6)};
 });
 return {owner:getAddress(owner).toLowerCase(),readAt:data.readAt,
   sources,available:sources.reduce((n,x)=>n+x.available,0n)};
}

const SDK_CHAIN_NAMES=[
 {domain:26,name:'Arc_Testnet'},
 {domain:0,name:'Ethereum_Sepolia'},
 {domain:6,name:'Base_Sepolia'},
] as const;

/**
 * Circle SDK returns a confirmed, depositor-scoped total and a chain-level
 * breakdown. No wallet token balance can be substituted for deposited USDC.
 * Missing rows can be treated as zero only when the single owner record has a
 * valid confirmed total matching the sum of all explicitly returned chains.
 */
export function parseGatewaySdkBalances(raw:unknown,owner:string):GatewayBalanceSnapshot{
 if(!isAddress(owner)||!raw||typeof raw!=='object'||Array.isArray(raw))
  throw Error('Invalid Circle Unified Balance response.');
 const obj=raw as Record<string,unknown>;
 const amountPattern=/^\d{1,18}(?:\.\d{1,6})?$/;
 if(obj.token!=='USDC'||typeof obj.totalConfirmedBalance!=='string'||
   !amountPattern.test(obj.totalConfirmedBalance)||!Array.isArray(obj.breakdown)||
   obj.breakdown.length!==1)
  throw Error('Circle did not return a complete confirmed USDC owner balance.');
 const depositor=obj.breakdown[0] as Record<string,unknown>|null;
 if(!depositor||typeof depositor!=='object'||Array.isArray(depositor)||
   typeof depositor.depositor!=='string'||!isAddress(depositor.depositor)||
   depositor.depositor.toLowerCase()!==owner.toLowerCase()||
   !Array.isArray(depositor.breakdown)||
   typeof depositor.totalConfirmed!=='string'||
   !amountPattern.test(depositor.totalConfirmed))
  throw Error('Circle owner or chain breakdown could not be authenticated.');
 const total=parseUnits(obj.totalConfirmedBalance,6);
 if(parseUnits(depositor.totalConfirmed,6)!==total)
  throw Error('Circle confirmed USDC totals disagree.');
 const observed=new Map<string,bigint>();
 for(const entry of depositor.breakdown as unknown[]){
  if(!entry||typeof entry!=='object'||Array.isArray(entry))
   throw Error('Circle returned malformed source balance data.');
  const item=entry as Record<string,unknown>;
  if(typeof item.chain!=='string'||typeof item.confirmedBalance!=='string'||
    !amountPattern.test(item.confirmedBalance)||observed.has(item.chain)||
    !SDK_CHAIN_NAMES.some(s=>s.name===item.chain))
   throw Error('Circle returned duplicate, unsupported or inaccurate chain balance.');
  observed.set(item.chain,parseUnits(item.confirmedBalance,6));
 }
 const observedTotal=[...observed.values()].reduce((sum,value)=>sum+value,0n);
 if(observedTotal!==total)
  throw Error('Circle chain balances do not equal its independently reported confirmed total.');
 const balances=SDK_CHAIN_NAMES.map(s=>({
  domain:s.domain,depositor:owner,
  balance:(observed.get(s.name)??0n).toString(),
 }));
 // Reuse the established exact decimal/domain parser: express each verified
 // SDK amount in major units, not a decimal approximation.
 const rows=balances.map(b=>{
  const units=BigInt(b.balance);
  const whole=units/1_000_000n;
  const fraction=(units%1_000_000n).toString().padStart(6,'0');
  return {...b,balance:whole.toString()+'.'+fraction};
 });
 return parseGatewayBalances({
  ok:true,token:'USDC',balances:rows,readAt:Date.now(),
 },owner);
}

/** Read-only Circle SDK source; requires the current signed Veyra identity. */
export async function fetchGatewayTestnetBalances(owner:string):Promise<GatewayBalanceSnapshot>{
 if(!isAddress(owner))throw Error('Connect a supported EVM wallet first.');
 const token=activeSignedIdentityToken();
 if(!token)throw Error('Sign in with your existing Veyra ID to read Gateway funds.');
 const kit=new AppKit();
 const response=await kit.unifiedBalance.getBalances({
  sources:{account:getAddress(owner),chains:SDK_CHAIN_NAMES.map(x=>x.name)},
  networkType:'testnet',token:'USDC',
 });
 if(activeSignedIdentityToken()!==token)
  throw Error('Signed Veyra ID changed during Circle balance read.');
 return parseGatewaySdkBalances(response,owner);
}

export function isGatewayDepositAmount(raw:string):boolean {
 return /^\d{1,18}(?:\.\d{1,6})?$/.test(raw)&&parseUnits(raw,6)>0n;
}
