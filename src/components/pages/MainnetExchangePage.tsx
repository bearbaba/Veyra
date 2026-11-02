/** Exchange: asset pair first, provider route second. No silently chained or fictitious transactions.
 * Only pre-reviewed Circle Arc Swap and Arc/Base USDC CCTP expose the existing executor.
 */
import {useEffect,useMemo,useState} from 'react';
import {useAccount,useReadContracts} from 'wagmi';
import {erc20Abi,formatUnits} from 'viem';
import {ArrowDownUp,ArrowRight,Search,Wallet,ChevronDown,ShieldCheck,X,Clock3} from 'lucide-react';
import {ConnectKitButton} from 'connectkit';
import {MainnetCirclePage,type ExchangeExecutionSelection} from './MainnetCirclePage';
import {EXCHANGE_ASSETS,exchangeAsset,exchangeAssetId,resolveExchangeRoute,searchExchangeAssets,
 type ExchangeAsset} from '@/mainnet/exchangeCatalog';

type Side='from'|'to';
const ARC=5042,BASE=8453;
const usdc=(chain:number)=>EXCHANGE_ASSETS.find(a=>a.chainId===chain&&a.symbol==='USDC')!;
const eurc=EXCHANGE_ASSETS.find(a=>a.chainId===ARC&&a.symbol==='EURC')!;
const readableChain=(a:ExchangeAsset)=>a.chainId===ARC?'Arc':a.network;
function recordedExchange(owner:string):null|{mode:'swap'|'bridge';source:ExchangeAsset;destination:ExchangeAsset;status:string}{
 if(!owner)return null;
 try{
  for(const mode of ['swap','bridge'] as const){
   const raw=localStorage.getItem('veyra:mainnet:circle:v1:'+mode+':'+owner.toLowerCase());
   if(!raw)continue;
   const data:unknown=JSON.parse(raw);
   if(!data||typeof data!=='object'||Array.isArray(data))return null;
   const x=data as Record<string,unknown>;
   if(x.owner!==owner.toLowerCase()||!['UNKNOWN','PENDING','VERIFIED','REVERTED'].includes(String(x.status)))
    return null;
   const source=EXCHANGE_ASSETS.find(a=>a.chainId===x.source&&a.symbol===x.fromToken);
   const destination=EXCHANGE_ASSETS.find(a=>a.chainId===x.destination&&a.symbol===x.toToken);
   if(source&&destination)return {mode,source,destination,status:String(x.status)};
  }
 }catch{return null;}
 return null;
}
function AssetMark({asset}:{asset:ExchangeAsset}){
 return <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-bold"
   style={{background:asset.logo==='eurc'?'#3156b1':'#257b61',color:'#fff'}}>
    {asset.logo==='eurc'?'€':'$'}
  </span>;
}
function AssetPicker({side,value,balances,onChoose,onClose}:{
 side:Side;value:ExchangeAsset;balances:Record<string,bigint>;
 onChoose:(asset:ExchangeAsset)=>void;onClose:()=>void;
}){
 const [query,setQuery]=useState('');
 const [chain,setChain]=useState<'all'|number>('all');
 const [ownedFirst,setOwnedFirst]=useState(true);
 const networks=Array.from(new Map(EXCHANGE_ASSETS.map(a=>[a.chainId,{id:a.chainId,name:a.network}])).values());
 const items=useMemo(()=>searchExchangeAssets(query,chain).sort((a,b)=>{
  const ab=(balances[exchangeAssetId(a)]??0n)>0n,bb=(balances[exchangeAssetId(b)]??0n)>0n;
  return ownedFirst&&ab!==bb?(ab?-1:1):a.chainId===ARC&&b.chainId!==ARC?-1:
   b.chainId===ARC&&a.chainId!==ARC?1:a.symbol.localeCompare(b.symbol);
 }),[query,chain,ownedFirst,balances]);
 useEffect(()=>{
  const esc=(ev:KeyboardEvent)=>{if(ev.key==='Escape')onClose();};
  window.addEventListener('keydown',esc);return()=>window.removeEventListener('keydown',esc);
 },[onClose]);
 return <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-5"
  role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}>
  <section role="dialog" aria-modal="true" aria-label={'Choose '+(side==='from'?'source':'destination')+' asset'}
   className="flex max-h-[92dvh] w-full max-w-lg flex-col rounded-t-3xl border p-4 shadow-2xl sm:rounded-2xl sm:p-5"
   style={{background:'var(--surface)',borderColor:'var(--border)',color:'var(--ink)'}}>
   <div className="flex items-center justify-between gap-3">
    <div><h2 className="text-lg font-bold">Select {side==='from'?'asset you have':'asset to receive'}</h2>
     <p className="text-xs" style={{color:'var(--muted)'}}>Contract and network identify each asset · no unverified imports</p></div>
    <button type="button" onClick={onClose} aria-label="Close asset selector" className="rounded-lg border p-2"
     style={{borderColor:'var(--border)'}}><X className="size-5"/></button>
   </div>
   <label className="relative mt-4 block">
    <Search className="absolute left-3 top-3.5 size-4" style={{color:'var(--muted)'}}/>
    <input autoFocus aria-label="Search assets by name, symbol or contract" placeholder="Search token or 0x contract"
     value={query} onChange={e=>setQuery(e.target.value)} className="w-full rounded-xl border py-3 pl-10 pr-3 text-sm"
     style={{background:'var(--surface-raised)',borderColor:'var(--border)',color:'var(--ink)'}}/>
   </label>
   <div className="mt-3 flex flex-wrap items-center gap-2">
    <label className="text-xs" style={{color:'var(--muted)'}}>Network</label>
    <select aria-label="Filter asset network" value={chain} onChange={e=>setChain(e.target.value==='all'?'all':Number(e.target.value))}
     className="min-w-0 flex-1 rounded-lg border p-2 text-sm"
     style={{borderColor:'var(--border)',background:'var(--surface-raised)',color:'var(--ink)'}}>
     <option value="all">All networks</option>
     {networks.map(n=><option key={n.id} value={n.id}>{n.name}</option>)}
    </select>
    <label className="flex items-center gap-1.5 text-xs" style={{color:'var(--muted)'}}>
     <input type="checkbox" checked={ownedFirst} onChange={e=>setOwnedFirst(e.target.checked)}/>Owned first
    </label>
   </div>
   <div className="mt-3 min-h-0 flex-1 overflow-auto" role="listbox" aria-label="Assets">
    {items.length===0?<p className="py-7 text-center text-sm" style={{color:'var(--muted)'}}>
     No reviewed token matched. Contract lookup never automatically grants verified status.
    </p>:items.map(asset=>{
     const balance=balances[exchangeAssetId(asset)];
     const active=exchangeAssetId(asset)===exchangeAssetId(value);
     return <button type="button" key={exchangeAssetId(asset)} role="option" aria-selected={active}
      onClick={()=>onChoose(asset)}
      className="flex w-full items-center gap-3 rounded-xl p-3 text-left hover:opacity-80"
      style={{background:active?'var(--accent-muted)':'transparent',color:'var(--ink)'}}>
      <AssetMark asset={asset}/>
      <span className="min-w-0 flex-1">
       <span className="block font-semibold">{asset.symbol} <span className="text-xs font-normal" style={{color:'var(--muted)'}}>· {readableChain(asset)}</span></span>
       <span className="block truncate text-xs" style={{color:'var(--muted)'}}>{asset.name} · {asset.contractAddress.slice(0,8)}…{asset.contractAddress.slice(-5)}</span>
      </span>
      <span className="text-right text-xs tabular-nums">
       <span className="block font-semibold">{balance!==undefined?formatUnits(balance,asset.decimals):'—'}</span>
       <span className="block" style={{color:'var(--muted)'}}>Wallet</span>
      </span>
     </button>;
    })}
   </div>
   <p className="mt-3 border-t pt-3 text-xs" style={{color:'var(--muted)',borderColor:'var(--border)'}}>
    Reviewed contract identity does not guarantee value, liquidity or a safe execution route.
    A dash means balance was not verified, not zero.
   </p>
  </section>
 </div>;
}
export function MainnetExchangePage({initialBridge=false}:{initialBridge?:boolean}){
 const {address}=useAccount();
 const [from,setFrom]=useState<ExchangeAsset>(()=>usdc(ARC));
 const [to,setTo]=useState<ExchangeAsset>(()=>initialBridge?usdc(BASE):eurc);
 const [picking,setPicking]=useState<Side|null>(null);
 const [prior,setPrior]=useState<ReturnType<typeof recordedExchange>>(null);
 const [unknownPrior,setUnknownPrior]=useState(false);
 const owner=address?.toLowerCase()??'';
 const readable=EXCHANGE_ASSETS.filter(a=>[ARC,BASE].includes(a.chainId));
 const {data:walletBalances}=useReadContracts({
  contracts:readable.map(asset=>({address:asset.contractAddress,abi:erc20Abi,
   functionName:'balanceOf' as const,chainId:asset.chainId,args:[address??'0x0000000000000000000000000000000000000000'] as const})),
  query:{enabled:!!address,staleTime:16000,refetchInterval:30000},
 });
 const balances=useMemo(()=>{
  const result:Record<string,bigint>={};
  readable.forEach((asset,i)=>{
   const raw=walletBalances?.[i];
   if(raw?.status==='success'&&typeof raw.result==='bigint')result[exchangeAssetId(asset)]=raw.result;
  });
  return result;
 },[walletBalances]);
 useEffect(()=>{
  if(!address){setPrior(null);setUnknownPrior(false);return;}
  const refresh=()=>{
   try{
    const records=['swap','bridge'].map(m=>localStorage.getItem('veyra:mainnet:circle:v1:'+m+':'+owner));
    setUnknownPrior(records.some((raw,i)=>!!raw&&!recordedExchange(owner)&&i>=0));
    const existing=recordedExchange(owner);setPrior(existing);
    if(existing){
     setFrom(existing.source);setTo(existing.destination);
    }
   }catch{setPrior(null);setUnknownPrior(true);}
  };
  refresh();
  const timer=window.setInterval(refresh,3000);
  window.addEventListener('storage',refresh);window.addEventListener('focus',refresh);
  return()=>{window.clearInterval(timer);window.removeEventListener('storage',refresh);window.removeEventListener('focus',refresh);};
 },[address,owner]);
 const locked=!!prior||unknownPrior;
 const route=resolveExchangeRoute(from,to);
 const choose=(asset:ExchangeAsset)=>{
  if(locked)return;
  if(picking==='from')setFrom(asset);
  if(picking==='to')setTo(asset);
  setPicking(null);
 };
 const executable=route.kind!=='unavailable'&&!unknownPrior;
 const selection:ExchangeExecutionSelection={fromChainId:from.chainId,toChainId:to.chainId,
  fromToken:from.symbol as 'USDC'|'EURC',toToken:to.symbol as 'USDC'|'EURC'};
 return <main className="mx-auto w-full max-w-3xl space-y-5 px-4 py-6 md:px-7 md:py-9">
  <header>
   <p className="text-xs font-bold uppercase tracking-wider" style={{color:'var(--accent)'}}>Veyra · Exchange</p>
   <h1 className="display mt-2 text-3xl font-bold" style={{color:'var(--ink)'}}>Exchange assets</h1>
   <p className="mt-2 text-sm" style={{color:'var(--muted)'}}>Choose what you have and what you want. Veyra checks the route before any wallet authorization.</p>
  </header>
  <section className="space-y-3 rounded-2xl border p-4 sm:p-5" style={{borderColor:'var(--border)',background:'var(--surface)'}}>
   <p className="text-xs font-semibold" style={{color:'var(--muted)'}}>YOU PAY</p>
   <button type="button" disabled={locked} onClick={()=>setPicking('from')}
    className="flex w-full items-center gap-3 rounded-xl border p-3 text-left disabled:opacity-70"
    style={{borderColor:'var(--border)',background:'var(--surface-raised)',color:'var(--ink)'}}>
    <AssetMark asset={from}/>
    <span className="min-w-0 flex-1"><strong>{from.symbol}</strong> <span className="block text-xs" style={{color:'var(--muted)'}}>{from.network} · {from.name}</span></span>
    <span className="text-xs" style={{color:'var(--muted)'}}>
     {balances[exchangeAssetId(from)]!==undefined?formatUnits(balances[exchangeAssetId(from)],from.decimals)+' available':'Balance unavailable'}
    </span><ChevronDown className="size-5"/>
   </button>
   <div className="flex justify-center">
    <button type="button" disabled={locked} onClick={()=>{setFrom(to);setTo(from);}}
     aria-label="Reverse assets" className="-my-1 rounded-xl border p-2.5 disabled:opacity-40"
     style={{borderColor:'var(--border-strong)',background:'var(--surface)',color:'var(--accent)'}}><ArrowDownUp className="size-5"/></button>
   </div>
   <p className="text-xs font-semibold" style={{color:'var(--muted)'}}>YOU RECEIVE</p>
   <button type="button" disabled={locked} onClick={()=>setPicking('to')}
    className="flex w-full items-center gap-3 rounded-xl border p-3 text-left disabled:opacity-70"
    style={{borderColor:'var(--border)',background:'var(--surface-raised)',color:'var(--ink)'}}>
    <AssetMark asset={to}/>
    <span className="min-w-0 flex-1"><strong>{to.symbol}</strong> <span className="block text-xs" style={{color:'var(--muted)'}}>{to.network} · {to.name}</span></span>
    <ChevronDown className="size-5"/>
   </button>
   <details className="text-xs" style={{color:'var(--muted)'}}>
    <summary className="cursor-pointer">Token contract and network details</summary>
    {[from,to].map((asset,i)=><p key={i} className="mt-2 break-all">
     {i===0?'From':'To'} · {asset.network} (chain {asset.chainId}) · {asset.contractAddress}
     {' · '}<a href={asset.sourceUrl} target="_blank" rel="noreferrer" className="underline">Issuer source</a>
    </p>)}
   </details>
  </section>
  <section className="rounded-xl border p-4" style={{background:'var(--surface)',borderColor:'var(--border)'}}>
   {route.kind==='unavailable'?<div role="status" className="space-y-2">
    <p className="text-sm font-semibold">No verified exchange route</p>
    <p className="text-sm" style={{color:'var(--muted)'}}>{route.reason}</p>
    <p className="text-xs" style={{color:'var(--muted)'}}>No quote, approval or wallet signing will be requested. Choose another pair.</p>
   </div>:<div className="flex items-start gap-3">
    {route.kind==='swap'?<ArrowDownUp className="mt-1 size-5" style={{color:'var(--accent)'}}/>:
     <ArrowRight className="mt-1 size-5" style={{color:'var(--accent)'}}/>}
    <div className="min-w-0 flex-1">
     <p className="text-sm font-semibold">{route.kind==='swap'?'Same-network Swap':'Cross-network Bridge'}</p>
     <p className="mt-1 text-xs" style={{color:'var(--muted)'}}>
      {route.provider} · {from.network} → {to.network} · live quote required
     </p>
     <p className="mt-1 text-xs" style={{color:'var(--muted)'}}>Route availability and minimum received are decided only by the live provider, not the token list.</p>
    </div><ShieldCheck className="size-4" style={{color:'var(--accent)'}}/>
   </div>}
   {(locked||unknownPrior)&&<p role="status" className="mt-3 flex items-start gap-2 text-xs"
    style={{color:'var(--warning)'}}><Clock3 className="size-4 shrink-0"/>
    Original Exchange activity is still stored. Resolve or inspect that operation before changing assets; do not submit a second transaction.
   </p>}
  </section>
  {executable?<MainnetCirclePage key={route.kind+':'+exchangeAssetId(from)+':'+exchangeAssetId(to)}
   embedded mode={route.kind} selection={selection}/>:
   !address?<ConnectKitButton/>:null}
  <p className="flex items-start gap-2 text-xs leading-5" style={{color:'var(--muted)'}}>
   <Wallet className="size-4 shrink-0"/>Wallet funds only. Unified Gateway deposits are separate and cannot fund this route directly.
   Multi-step Bridge + Swap, arbitrary asset execution and third-party recipient routing remain unavailable until independently accepted.
  </p>
  {picking&&<AssetPicker key={picking} side={picking} value={picking==='from'?from:to}
   balances={balances} onChoose={choose} onClose={()=>setPicking(null)}/>}
 </main>;
}
