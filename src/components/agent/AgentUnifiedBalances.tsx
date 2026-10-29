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
import { MANIFEST_CONSTANTS as M } from '../../providers/registry/providerManifest';
import { VEYRA_ENV } from '../../lib/env';

type UnifiedState = { owner:string; loading:boolean; entries:UnifiedRead[] } | null;

export function AgentUnifiedBalances(){
  const {address}=useAccount();
  const arc=usePublicClient({chainId:M.ARC_TESTNET_CHAIN_ID});
  const ethereum=usePublicClient({chainId:M.ETH_SEPOLIA_CHAIN_ID});
  const base=usePublicClient({chainId:M.BASE_SEPOLIA_CHAIN_ID});
  const [state,setState]=useState<UnifiedState>(null);
  const latest=useRef(0);
  const wallet=address?.toLowerCase()??'';
  const enabled=Boolean(wallet)&&VEYRA_ENV!=='mainnet';
  const current=state?.owner===wallet?state:null;
  const refresh=useCallback(async()=>{
    if(!address||VEYRA_ENV==='mainnet')return;
    const id=++latest.current;
    const owner=address.toLowerCase();
    setState({owner,loading:true,entries:[]});
    const clients=[arc,ethereum,base] as const;
    const entries=await Promise.all(UNIFIED_TESTNET_USDC.map((source,index)=>
      readPinnedTestnetUsdc(clients[index],source,address)));
    if(id===latest.current)setState({owner,loading:false,entries});
  },[address,arc,ethereum,base]);
  useEffect(()=>{
    void refresh();
    const onFocus=()=>{if(document.visibilityState==='visible')void refresh();};
    window.addEventListener('focus',onFocus);
    return ()=>{latest.current++;window.removeEventListener('focus',onFocus);};
  },[refresh]);

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
    <div className="space-y-3" aria-label="Unified Testnet USDC balances">
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
      {!current?.loading && current && (
        <div role="status" className="rounded-xl border p-3 text-xs leading-5"
          style={{borderColor:'var(--border)',color:'var(--muted)'}}>
          {displayTotal!==null
            ? <>Across 3 Testnets (display only): <strong style={{color:'var(--ink)'}}>
                {formatArcUsdcBalance(displayTotal)} USDC
              </strong>. These balances are separate; Veyra cannot spend them as one balance.</>
            : <>{success}/3 networks verified. Combined display hidden until all networks are readable.
                Unavailable never means zero.</>}
          {latestRead>0 && <span className="block">Last verified read: {new Date(latestRead).toLocaleTimeString()}</span>}
        </div>
      )}
      <p className="text-[11px] leading-5" style={{color:'var(--subtle)'}}>
        Read-only Testnet view · No wallet signature, gas, route execution or transfer.
        USDC on Arc is not counted again as a separate native-gas balance.
      </p>
    </div>
  );
}
