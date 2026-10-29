/**
 * Phase 37: single-card Unified Testnet USDC reader, scoped to connected wallet.
 * It is intentionally informational and does not navigate into a swap/bridge
 * executor or create cross-chain payment authorizations.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAccount, usePublicClient } from 'wagmi';
import { RefreshCw } from 'lucide-react';
import { formatArcUsdcBalance } from '../../features/balance/arcUsdcBalance';
import {
  UNIFIED_TESTNET_USDC, exactDisplayTotal, readPinnedTestnetUsdc, type UnifiedRead,
} from '../../core/balance/unifiedTestnetUsdc';
import { fetchGatewayTestnetBalances, GATEWAY_TESTNET_SOURCES,
  type GatewayBalanceSnapshot } from '../../core/gateway/gatewayBalances';
import { GatewayAddFunds } from './GatewayAddFunds';
import { MANIFEST_CONSTANTS as M } from '../../providers/registry/providerManifest';
import { VEYRA_ENV } from '../../lib/env';

type UnifiedState = { owner:string; loading:boolean; entries:UnifiedRead[] } | null;

export function AgentUnifiedBalances(){
  const {address}=useAccount();
  const arc=usePublicClient({chainId:M.ARC_TESTNET_CHAIN_ID});
  const ethereum=usePublicClient({chainId:M.ETH_SEPOLIA_CHAIN_ID});
  const base=usePublicClient({chainId:M.BASE_SEPOLIA_CHAIN_ID});
  const [state,setState]=useState<UnifiedState>(null);
  const [gateway,setGateway]=useState<{owner:string;loading:boolean;data:GatewayBalanceSnapshot|null;error:string|null}|null>(null);
  const [showWallets,setShowWallets]=useState(false);
  const [showDeposit,setShowDeposit]=useState(false);
  const latest=useRef(0);
  const wallet=address?.toLowerCase()??'';
  const enabled=Boolean(wallet)&&VEYRA_ENV!=='mainnet';
  const current=state?.owner===wallet?state:null;
  const refresh=useCallback(async()=>{
    if(!address||VEYRA_ENV==='mainnet')return;
    const id=++latest.current;
    const owner=address.toLowerCase();
    setState({owner,loading:true,entries:[]});
    setGateway({owner,loading:true,data:null,error:null});
    const clients=[arc,ethereum,base] as const;
    // Run independent reads; a wallet RPC failure is NOT a Gateway balance.
    const [reads,provider]=await Promise.all([
      Promise.all(UNIFIED_TESTNET_USDC.map((source,index)=>
        readPinnedTestnetUsdc(clients[index],source,address))),
      fetchGatewayTestnetBalances(address).then(data=>({data,error:null as string|null}))
        .catch((err:unknown)=>({data:null,error:err instanceof Error?err.message:'Gateway balance unavailable.'})),
    ]);
    if(id===latest.current){
      setState({owner,loading:false,entries:reads});
      setGateway({owner,loading:false,...provider});
    }
  },[address,arc,ethereum,base]);
  useEffect(()=>{
    void refresh();
    const onFocus=()=>{if(document.visibilityState==='visible')void refresh();};
    window.addEventListener('focus',onFocus);
    return ()=>{latest.current++;window.removeEventListener('focus',onFocus);};
  },[refresh]);

  const gatewayCurrent=gateway?.owner===wallet?gateway:null;
  const gatewayBalance=gatewayCurrent?.data??null;
  const balances=current?.entries??[];
  const displayTotal=exactDisplayTotal(balances);
  const success=balances.filter(x=>x.status==='AVAILABLE').length;
  const latestRead=balances.filter((x):x is Extract<UnifiedRead,{status:'AVAILABLE'}>=>x.status==='AVAILABLE')
    .reduce((n,x)=>Math.max(n,x.readAt),0);
  if(VEYRA_ENV==='mainnet')return <p className="rounded-xl border p-3 text-xs"
    style={{borderColor:'var(--border)',color:'var(--muted)'}}>
    Unified Testnet balance reads are disabled in Mainnet mode.
  </p>;
  if(!address)return <div className="rounded-xl border p-3 text-sm"
    style={{borderColor:'var(--border)',color:'var(--muted)'}}>
    Connect your wallet to view USDC on Arc, Ethereum Sepolia and Base Sepolia. No signature required.
  </div>;

  return (
    <div className="space-y-3" aria-label="Circle Gateway Unified Balance">
      <div role="status" aria-label="Gateway Available USDC"
        className="rounded-2xl border px-4 py-5 sm:px-5 sm:py-6"
        style={{borderColor:'var(--border-strong)',background:'var(--surface-strong)'}}>
        <p className="text-[11px] font-bold uppercase tracking-[0.12em]"
          style={{color:'var(--muted)'}}>Unified Balance · Circle Gateway</p>
        <p className="mt-2 break-all text-3xl font-black tracking-tight tabular-nums sm:text-4xl"
          style={{color:'var(--ink)'}}>
          {!gatewayCurrent||gatewayCurrent.loading?'Reading…'
            :gatewayBalance?formatArcUsdcBalance(gatewayBalance.available)+' USDC':'—'}
        </p>
        <p className="mt-1 text-xs" style={{color:'var(--muted)'}}>
          Available · Gateway deposits only, not USDC remaining in your connected wallets.
        </p>
        {gatewayCurrent?.error&&<p role="alert" className="mt-2 text-xs"
          style={{color:'var(--warning)'}}>{gatewayCurrent.error} · Unknown is not zero.</p>}
        {gatewayBalance&&<details className="mt-3 text-xs" style={{color:'var(--muted)'}}>
          <summary className="cursor-pointer">Deposited balance by network</summary>
          <div className="mt-2 space-y-1">
            {GATEWAY_TESTNET_SOURCES.map(source=><div className="flex justify-between gap-3" key={source.domain}>
              <span>{source.name}</span><span className="tabular-nums">
                {formatArcUsdcBalance(gatewayBalance.sources.find(x=>x.domain===source.domain)!.available)} USDC
              </span>
            </div>)}
          </div>
        </details>}
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={()=>setShowDeposit(v=>!v)}
            className="rounded-xl border px-3 py-2 text-xs font-semibold"
            style={{borderColor:'var(--border-strong)',color:'var(--ink)'}}>
            {showDeposit?'Hide Add funds':'Add funds'}
          </button>
          <button type="button" disabled title="Unified Send requires signed Gateway transfer integration and a verified destination receipt."
            className="rounded-xl border px-3 py-2 text-xs opacity-50"
            style={{borderColor:'var(--border)',color:'var(--muted)'}}>Send from Unified</button>
        </div>
        <p className="mt-3 text-[11px] leading-5" style={{color:'var(--muted)'}}>
          Pending deposits and reserved transfers are not yet included here.
          Source-chain confirmation alone is not Gateway finality.
        </p>
      </div>
      {showDeposit&&<GatewayAddFunds key={wallet} onUpdate={()=>void refresh()}/>}
      <button type="button" onClick={()=>setShowWallets(v=>!v)}
        className="text-xs font-semibold underline" style={{color:'var(--muted)'}}>
        {showWallets?'Hide Wallet balances':'Wallet balances · separate funds'}
      </button>
      {showWallets&&<div className="rounded-xl border p-3 space-y-3" style={{borderColor:'var(--border)'}}>
        <p className="text-sm font-bold" style={{color:'var(--ink)'}}>Wallet balances</p>
        <p className="text-xl font-bold" style={{color:'var(--ink)'}}>
          {!current||current.loading?'Reading…'
            :displayTotal!==null?formatArcUsdcBalance(displayTotal)+' USDC':'—'}
        </p>
        <p className="text-xs" style={{color:'var(--muted)'}}>
          Sum of ERC-20 USDC still held by the wallet across three Testnets.
          This is NOT spendable as one balance and must not be added to Gateway Available twice.
        </p>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 text-xs" style={{color:'var(--muted)'}}>
          Wallet <span className="font-mono" style={{color:'var(--ink)'}}>{address.slice(0,6)}…{address.slice(-4)}</span>
          {' · '}USDC only
        </p>
        <button type="button" onClick={()=>void refresh()} disabled={!enabled||Boolean(current?.loading)}
          className="inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold disabled:opacity-50"
          style={{borderColor:'var(--border-strong)',color:'var(--ink)'}}>
          <RefreshCw className="size-3.5"/> {current?.loading?'Reading…':'Refresh'}
        </button>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        {UNIFIED_TESTNET_USDC.map(source=>{
          const reading=balances.find(x=>x.chainId===source.chainId);
          return <div key={source.chainId} className="min-w-0 space-y-2 rounded-xl border p-3"
            style={{borderColor:'var(--border)',background:'var(--surface-muted)'}}>
            <p className="text-xs font-semibold" style={{color:'var(--ink)'}}>{source.name}</p>
            <p className="break-all font-mono text-sm font-bold" style={{color:'var(--ink)'}}>
              {!current||current.loading?'Reading…'
                :reading?.status==='AVAILABLE'?formatArcUsdcBalance(reading.balance)+' USDC'
                :'Unavailable'}
            </p>
            <p className="text-[11px] leading-4" style={{color:'var(--muted)'}}>
              {!current||current.loading?'Checking pinned RPC and USDC contract'
                :reading?.status==='AVAILABLE'?'Verified on this Testnet'
                :reading?.status==='UNAVAILABLE'?reading.reason
                :'No verified reading'}
            </p>
          </div>;
        })}
      </div>
      </div>}
      {latestRead>0 && !current?.loading && (
        <p className="text-[11px]" style={{color:'var(--muted)'}}>
          Last verified read: {new Date(latestRead).toLocaleTimeString()}
        </p>
      )}
      <p className="text-[11px] leading-5" style={{color:'var(--subtle)'}}>
        Wallet balance reads are informational. Gateway Available is an independent
        provider API balance; an unverified deposit is never considered spendable.
      </p>
    </div>
  );
}
