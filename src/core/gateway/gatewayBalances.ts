/**
 * A Gateway balance is USDC DEPOSITED to Circle Gateway, NOT wallet ERC-20
 * balanceOf. Only the permissionless Testnet Gateway API can report this value.
 * Keep all amounts in 6-decimal exact bigint units; never infer missing rows as 0.
 */
import { getAddress, isAddress, parseUnits } from 'viem';
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
 const sources=GATEWAY_TESTNET_SOURCES.map(source=>{
   const matches=data.balances.filter((entry:unknown)=>{
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

/** Read only, current signed wallet and Veyra ID; never send private keys. */
export async function fetchGatewayTestnetBalances(owner:string):Promise<GatewayBalanceSnapshot>{
 if(!isAddress(owner))throw Error('Connect a supported EVM wallet first.');
 const token=activeSignedIdentityToken();
 if(!token)throw Error('Sign in with your existing Veyra ID to read Gateway funds.');
 const response=await fetch('/api/gateway/balances',{
   method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},
   body:JSON.stringify({walletAddress:owner}),cache:'no-store',
 });
 if(!response.ok)throw Error(`Gateway balance unavailable (HTTP ${response.status}); amount is unknown.`);
 return parseGatewayBalances(await response.json(),owner);
}

export function isGatewayDepositAmount(raw:string):boolean {
 return /^\d{1,18}(?:\.\d{1,6})?$/.test(raw)&&parseUnits(raw,6)>0n;
}
