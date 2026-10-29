/**
 * Exact, wallet-scoped, read-only USDC snapshots on three explicitly pinned
 * Veyra Testnets. Never use balances as authorizations or cross-chain liquidity.
 * No Number conversion, no mocked zeros, no writeContract or signature APIs.
 */
import { getAddress, isAddress, type PublicClient } from 'viem';
import { MANIFEST_CONSTANTS as M } from '../../providers/registry/providerManifest';

export const UNIFIED_TESTNET_USDC = [
  { chainId:M.ARC_TESTNET_CHAIN_ID, name:'Arc Testnet', token:M.ARC_TESTNET_USDC },
  { chainId:M.ETH_SEPOLIA_CHAIN_ID, name:'Ethereum Sepolia', token:M.ETH_SEPOLIA_USDC },
  { chainId:M.BASE_SEPOLIA_CHAIN_ID, name:'Base Sepolia', token:M.BASE_SEPOLIA_USDC },
] as const;
export type UnifiedSource = typeof UNIFIED_TESTNET_USDC[number];
export type UnifiedRead =
  | { chainId:number; status:'AVAILABLE'; balance:bigint; readAt:number }
  | { chainId:number; status:'UNAVAILABLE'; reason:string };

const balanceABI = [{
  type:'function', name:'balanceOf', stateMutability:'view',
  inputs:[{name:'account',type:'address'}],outputs:[{name:'balance',type:'uint256'}],
}] as const;

/** Independent, bounded chain reads: one failed RPC must not hide the other chains. */
export async function readPinnedTestnetUsdc(
  client:PublicClient|undefined, source:UnifiedSource, wallet:string, timeoutMs=12_000,
):Promise<UnifiedRead>{
  if (!client || !isAddress(wallet))
    return {chainId:source.chainId,status:'UNAVAILABLE',reason:'Wallet or source RPC unavailable.'};
  let timer:ReturnType<typeof setTimeout>|undefined;
  try {
    const reading=(async()=>{
      const chainId=await client.getChainId();
      if (chainId!==source.chainId)
        throw Error('RPC returned a different chain ID.');
      const contract=getAddress(source.token);
      // A missing token contract must never be interpreted as a zero balance.
      const code=await client.getCode({address:contract});
      if (!code || code==='0x') throw Error('Pinned USDC contract not deployed at this RPC.');
      const balance=await client.readContract({
        address:contract,abi:balanceABI,functionName:'balanceOf',args:[getAddress(wallet)],
      });
      if(typeof balance!=='bigint' || balance<0n)throw Error('RPC returned an invalid USDC balance.');
      return {chainId:source.chainId,status:'AVAILABLE' as const,balance,readAt:Date.now()};
    })();
    return await Promise.race<UnifiedRead>([
      reading,
      new Promise<UnifiedRead>((resolve)=>{
        timer=setTimeout(()=>resolve({chainId:source.chainId,status:'UNAVAILABLE',reason:'RPC timed out. Balance is unknown, not zero.'}),timeoutMs);
      }),
    ]);
  }catch{
    return {chainId:source.chainId,status:'UNAVAILABLE',
      reason:'Could not verify USDC at the selected Testnet RPC. Balance is unknown, not zero.'};
  }finally{if(timer)clearTimeout(timer);}
}

/** Display totals only when ALL network reads are verified. Never imply pooled funds. */
export function exactDisplayTotal(reads:readonly UnifiedRead[]):bigint|null{
  if(reads.length!==UNIFIED_TESTNET_USDC.length ||
    new Set(reads.map(x=>x.chainId)).size!==UNIFIED_TESTNET_USDC.length ||
    UNIFIED_TESTNET_USDC.some(source=>!reads.some(r=>r.chainId===source.chainId&&r.status==='AVAILABLE')))
    return null;
  return reads.reduce<bigint>((acc,r)=>acc+(r.status==='AVAILABLE'?r.balance:0n),0n);
}
