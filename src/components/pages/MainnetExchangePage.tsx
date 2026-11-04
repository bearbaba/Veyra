/** Exchange: asset pair first, provider route second. No silently chained or fictitious transactions.
 * Only pre-reviewed Circle Arc Swap and Arc/Base USDC CCTP expose the existing executor.
 */
import {useEffect,useMemo,useRef,useState} from 'react';
import {useAccount,useReadContracts} from 'wagmi';
import {useUnifiedSocial} from '@/features/social/UnifiedSocial';
import {erc20Abi,formatUnits,parseUnits} from 'viem';
import {ArrowDownUp,ArrowRight,Search,Wallet,ChevronDown,ShieldCheck,X,Clock3} from 'lucide-react';
import {ConnectKitButton} from 'connectkit';
import {BrandLogo} from '../brand/BrandLogo';
import {MainnetCirclePage,type ExchangeExecutionSelection} from './MainnetCirclePage';
import {EXCHANGE_ASSETS,exchangeAssetId,resolveExchangeRoute,searchExchangeAssets,
 type ExchangeAsset} from '@/mainnet/exchangeCatalog';
import {getAcrossExchangeQuote,type ExchangeQuoteSummary} from '@/mainnet/exchangeProviderQuote';
import {readExchangeIntents,type ExchangeIntent} from '@/mainnet/exchangeIntentJournal';

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
 return <BrandLogo logoKey={asset.logo} size={40}/>;
}
function AssetPicker({side,value,other,balances,acrossReady,mode,onChoose,onClose}:{
 side:Side;value:ExchangeAsset;other:ExchangeAsset;balances:Record<string,bigint>;acrossReady:boolean;mode:'swap'|'bridge';
 onChoose:(asset:ExchangeAsset)=>void;onClose:()=>void;
}){
 const [query,setQuery]=useState('');
 const [chain,setChain]=useState<'all'|number>('all');
 const [ownedFirst,setOwnedFirst]=useState(true);
 const [showUnsupported,setShowUnsupported]=useState(false);
 const networks=Array.from(new Map(EXCHANGE_ASSETS.map(a=>[a.chainId,{id:a.chainId,name:a.network}])).values());
 const support=(asset:ExchangeAsset)=>{
  const routes=side==='from'?EXCHANGE_ASSETS.map(to=>resolveExchangeRoute(asset,to)):[resolveExchangeRoute(other,asset)];
  return routes.some(route=>route.kind===mode)?'tradable-route':
   acrossReady&&false?'quote-only':'unsupported';
 };
 const score=(asset:ExchangeAsset)=>support(asset)==='tradable-route'?0:2;
 const items=searchExchangeAssets(query,chain).filter(a=>showUnsupported||support(a)!=='unsupported')
  .sort((a,b)=>{
   const ab=(balances[exchangeAssetId(a)]??0n)>0n,bb=(balances[exchangeAssetId(b)]??0n)>0n;
   return score(a)-score(b)||ownedFirst&&ab!==bb?(ab?-1:1):a.chainId===ARC&&b.chainId!==ARC?-1:
    b.chainId===ARC&&a.chainId!==ARC?1:a.symbol.localeCompare(b.symbol);
  });
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
     <p className="text-xs" style={{color:'var(--muted)'}}>Choose a token and network</p></div>
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
    <label className="flex items-center gap-1.5 text-xs" style={{color:'var(--muted)'}}>
     <input type="checkbox" checked={showUnsupported} onChange={e=>setShowUnsupported(e.target.checked)}/>Show unsupported
    </label>
   </div>
   <div className="mt-3 min-h-0 flex-1 overflow-auto" role="listbox" aria-label="Assets">
    {items.length===0?<p className="py-7 text-center text-sm" style={{color:'var(--muted)'}}>
     No reviewed token matched. Contract lookup never automatically grants verified status.
    </p>:items.map(asset=>{
     const balance=balances[exchangeAssetId(asset)];
     const active=exchangeAssetId(asset)===exchangeAssetId(value);
     const availability=support(asset);
     return <button type="button" key={exchangeAssetId(asset)} role="option" aria-selected={active}
      disabled={availability==='unsupported'} onClick={()=>onChoose(asset)}
      className="flex w-full items-center gap-3 rounded-xl p-3 text-left hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-40"
      style={{background:active?'var(--accent-muted)':'transparent',color:'var(--ink)'}}>
      <AssetMark asset={asset}/>
      <span className="min-w-0 flex-1">
       <span className="block font-semibold">{asset.symbol} <span className="text-xs font-normal" style={{color:'var(--muted)'}}>· {readableChain(asset)}</span></span>
       <span className="block truncate text-xs" style={{color:'var(--muted)'}}>{asset.name}</span>
       <span className="block text-xs" style={{color:availability==='unsupported'?'var(--warning)':'var(--accent)'}}>
        {availability==='tradable-route'?'Supported route · live quote required':availability==='quote-only'?'Live quote candidate · signing disabled':'Not supported'}
       </span>
      </span>
      <span className="text-right text-xs tabular-nums">
       <span className="block font-semibold">{balance!==undefined?formatUnits(balance,asset.decimals):'—'}</span>
       <span className="block" style={{color:'var(--muted)'}}>Wallet</span>
      </span>
     </button>;
    })}
   </div>
   <details className="mt-3 border-t pt-3 text-xs" style={{color:'var(--muted)',borderColor:'var(--border)'}}>
    <summary className="cursor-pointer">Details</summary>
    <p className="mt-2">Token listing does not guarantee liquidity. — means balance unavailable.</p>
   </details>
  </section>
 </div>;
}
export function MainnetExchangePage({initialBridge=false}:{initialBridge?:boolean}){
 const {address}=useAccount();
 const social=useUnifiedSocial();
 const [acrossAmount,setAcrossAmount]=useState('');
 const [acrossQuote,setAcrossQuote]=useState<ExchangeQuoteSummary|null>(null);
 const [quoteProblem,setQuoteProblem]=useState('');
 const [quoteLoading,setQuoteLoading]=useState(false);
 const [quoteRefresh,setQuoteRefresh]=useState(0);
 const [acrossReady,setAcrossReady]=useState(false);
 const quoteController=useRef<AbortController|null>(null);
 const [from,setFrom]=useState<ExchangeAsset>(()=>usdc(ARC));
 const [to,setTo]=useState<ExchangeAsset>(()=>initialBridge?usdc(BASE):eurc);
 const [picking,setPicking]=useState<Side|null>(null);
 const [prior,setPrior]=useState<ReturnType<typeof recordedExchange>>(null);
 const [unknownPrior,setUnknownPrior]=useState(false);
 const [intentPrior,setIntentPrior]=useState<ExchangeIntent|null>(null);
 const [intentBlocked,setIntentBlocked]=useState(false);
 const [engineBusy,setEngineBusy]=useState(false);
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
  if(!address){setPrior(null);setUnknownPrior(false);setIntentPrior(null);setIntentBlocked(false);return;}
  const refresh=()=>{
   try{
    const records=['swap','bridge'].map(m=>localStorage.getItem('veyra:mainnet:circle:v1:'+m+':'+owner));
    setUnknownPrior(records.some((raw,i)=>!!raw&&!recordedExchange(owner)&&i>=0));
    const existing=recordedExchange(owner);setPrior(existing);
    const queued=readExchangeIntents(owner);
    setIntentBlocked(queued.kind==='blocked');
    setIntentPrior(queued.kind==='ready'?queued.items.find(x=>!
     ['DESTINATION_VERIFIED','REFUNDED','SOURCE_REVERTED','CANCELLED_BEFORE_SOURCE'].includes(x.stage))??null:null);
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
 const locked=!!prior||unknownPrior||engineBusy||!!intentPrior||intentBlocked;
 const viewMode=initialBridge?'bridge':'swap';
 const candidateRoute=resolveExchangeRoute(from,to);
 const route:ReturnType<typeof resolveExchangeRoute>=candidateRoute.kind===viewMode?candidateRoute:{kind:'unavailable',reason:viewMode==='swap'?'Choose supported Arc USDC/EURC pair.':'Choose USDC between Arc and Base.'};
 const pairKey=exchangeAssetId(from)+'>'+exchangeAssetId(to);
 useEffect(()=>{
  const controller=new AbortController();
  void fetch('/api/mainnet/exchange/across/capability',{method:'GET',cache:'no-store',
   signal:controller.signal}).then(async response=>{
    if(!response.ok)return null;
    const result:unknown=await response.json();
    return result;
   }).then(result=>{
    if(controller.signal.aborted||!result||typeof result!=='object'||Array.isArray(result))return;
    const cap=result as Record<string,unknown>;
    setAcrossReady(cap.ok===true&&cap.quoteAvailable===true&&cap.executionEnabled===false);
   }).catch(()=>{/* Provider remains hidden unless backend explicitly confirms readiness. */});
  return()=>controller.abort();
 },[]);
 useEffect(()=>{
  quoteController.current?.abort();
  setAcrossQuote(null);setQuoteProblem('');setAcrossAmount('');setQuoteLoading(false);
  return()=>quoteController.current?.abort();
 },[pairKey,address,social.session?.token]);
 useEffect(()=>{const t=window.setInterval(()=>setQuoteRefresh(Date.now()),1000);
  return()=>window.clearInterval(t);},[]);
 async function getAcrossQuote(){
  if(route.kind!=='quote-only'||!address||!social.session?.token||locked)return;
  let units:string;
  try{
   if(!/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,18})?$/.test(acrossAmount))
    throw Error('Enter a positive WETH amount with at most 18 decimals.');
   units=parseUnits(acrossAmount,18).toString();
   if(BigInt(units)<1000000000000n||BigInt(units)>10000000000000000000n)
    throw Error('The Across pilot accepts a quote from 0.000001 to 10 WETH.');
  }catch(e){setQuoteProblem(e instanceof Error?e.message:'Invalid WETH amount.');return;}
  setQuoteLoading(true);setQuoteProblem('');setAcrossQuote(null);
  quoteController.current?.abort();
  const controller=new AbortController();quoteController.current=controller;
  try{
   const quote=await getAcrossExchangeQuote({token:social.session.token,owner:address,
    fromContract:from.contractAddress,toContract:to.contractAddress,amountRaw:units,signal:controller.signal});
   if(controller.signal.aborted)return;
   if(quote.inputAssetId!==exchangeAssetId(from)||quote.outputAssetId!==exchangeAssetId(to)||
    quote.inputRaw!==units||quote.expiresAt<=Date.now())throw Error('Quote mismatch or expired; review again.');
   setAcrossQuote(quote);
  }catch(e){if(!controller.signal.aborted)setQuoteProblem(e instanceof Error?e.message:'Live quote unavailable.');}
  finally{if(!controller.signal.aborted)setQuoteLoading(false);}
 }
 const choose=(asset:ExchangeAsset)=>{
  if(locked)return;
  if(picking==='from'){
   setFrom(asset);
   const currentSupport=resolveExchangeRoute(asset,to);
   if(currentSupport.kind!==viewMode){
    const first=EXCHANGE_ASSETS.find(x=>resolveExchangeRoute(asset,x).kind===viewMode);
    if(first)setTo(first);
   }
  }
  if(picking==='to')setTo(asset);
  setPicking(null);
 };
 const executable=(route.kind==='swap'||route.kind==='bridge')&&!unknownPrior;
 const selection:ExchangeExecutionSelection={fromChainId:from.chainId,toChainId:to.chainId,
  fromToken:from.symbol as 'USDC'|'EURC',toToken:to.symbol as 'USDC'|'EURC'};
 return <main className="mx-auto w-full max-w-2xl space-y-4 px-4 py-5 md:px-7 md:py-8">
  <header>
   <p className="text-xs font-bold uppercase tracking-wider" style={{color:'var(--accent)'}}>VEYRA · ARC MAINNET</p>
   <h1 className="display mt-2 text-3xl font-bold" style={{color:'var(--ink)'}}>{viewMode==='swap'?'Swap':'Bridge'}</h1>
   <p className="mt-2 text-sm" style={{color:'var(--muted)'}}>{viewMode==='swap'?'You pay · You receive':'From · To · Amount'}</p>
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
    <summary className="cursor-pointer">Details</summary>
    {[from,to].map((asset,i)=><p key={i} className="mt-2 break-all">
     {i===0?'From':'To'} · {asset.network} (chain {asset.chainId}) · {asset.contractAddress}
     {' · '}<a href={asset.sourceUrl} target="_blank" rel="noreferrer" className="underline">Issuer source</a>
    </p>)}
   </details>
  </section>
  <section className="rounded-xl border p-4" style={{background:'var(--surface)',borderColor:'var(--border)'}}>
   {route.kind==='unavailable'?<div role="status" className="space-y-2">
    <p className="text-sm font-semibold">No supported {viewMode} route</p>
    <p className="text-sm" style={{color:'var(--muted)'}}>{route.reason}</p>
    <p className="text-xs" style={{color:'var(--muted)'}}>Choose another pair. No transaction started.</p>
   </div>:<div className="flex items-start gap-3">
    {route.kind==='swap'?<ArrowDownUp className="mt-1 size-5" style={{color:'var(--accent)'}}/>:
     <ArrowRight className="mt-1 size-5" style={{color:'var(--accent)'}}/>}
    <div className="min-w-0 flex-1">
     <p className="text-sm font-semibold">{route.kind==='swap'?'Same-network Swap':route.kind==='quote-only'?'Cross-network Swap + Bridge · quote candidate':'Cross-network Bridge'}</p>
     <p className="mt-1 text-xs" style={{color:'var(--muted)'}}>
      {route.provider} · {from.network} → {to.network} · live quote required
     </p>
     <details className="mt-2 text-xs" style={{color:'var(--muted)'}}>
      <summary className="cursor-pointer">Route details</summary>
      <p className="mt-2">Minimum received depends on the live quote.</p>
     </details>
     {route.kind==='quote-only'&&<p className="mt-1 text-xs" style={{color:'var(--warning)'}}>Quote only · payment unavailable</p>}
    </div><ShieldCheck className="size-4" style={{color:'var(--accent)'}}/>
   </div>}
   {(locked||unknownPrior)&&<p role="status" className="mt-3 flex items-start gap-2 text-xs"
    style={{color:'var(--warning)'}}><Clock3 className="size-4 shrink-0"/>
    {intentBlocked?'Exchange recovery storage cannot be read. No new transaction is permitted.':
     intentPrior?.stage==='PARTIAL'? 'Partial Exchange: original source completed but destination not confirmed. Open Activity to review current funds and recovery.':
     'Original Exchange activity is still stored. Resolve or inspect that operation before changing assets; do not submit a second transaction.'}
   </p>}
  </section>
  {route.kind==='quote-only'&&<section className="space-y-3 rounded-2xl border p-4 sm:p-5"
   style={{background:'var(--surface)',borderColor:'var(--border)',color:'var(--ink)'}}>
   <p className="font-semibold">Across · WETH on Base → USDC on Arc</p>
   <p className="text-xs" style={{color:'var(--muted)'}}>
    Preview a quote. No transaction will be sent.
   </p>
   <label className="block text-sm">Amount you have (WETH)
    <input inputMode="decimal" value={acrossAmount} disabled={locked||quoteLoading}
     onChange={e=>{setAcrossAmount(e.target.value);setAcrossQuote(null);setQuoteProblem('');}}
     placeholder="0.01" className="mt-2 w-full rounded-xl border p-3 text-xl font-semibold"
     style={{borderColor:'var(--border)',background:'var(--surface-raised)',color:'var(--ink)'}}/>
   </label>
   {!address?<ConnectKitButton/>:<button type="button"
    disabled={locked||quoteLoading||!social.session?.token||!acrossReady} onClick={()=>void getAcrossQuote()}
    className="w-full rounded-xl px-4 py-3 font-semibold disabled:opacity-40"
    style={{background:'var(--accent)',color:'#0d1b2f'}}>
    {quoteLoading?'Requesting live Across quote…':'Get live quote (no signing)'}
   </button>}
   {!acrossReady&&<p className="text-xs" style={{color:'var(--warning)'}}>
    Across is not configured on this Mainnet backend. No quote or signing is available for this route.
   </p>}
   {address&&!social.session?.token&&<p className="text-xs" style={{color:'var(--warning)'}}>
    Sign in to your Veyra ID before requesting an Across quote.
   </p>}
   {quoteProblem&&<p role="alert" className="text-sm" style={{color:'var(--warning)'}}>{quoteProblem}</p>}
   {acrossQuote&&<div role="status" className="space-y-2 rounded-xl border p-3 text-sm"
    style={{borderColor:'var(--border)'}}>
    <p className="font-semibold">Live provider quote · {acrossQuote.provider}</p>
    <p>Estimated receive: {formatUnits(BigInt(acrossQuote.expectedOutputRaw),acrossQuote.outputDecimals)} USDC</p>
    <p>Minimum receive: {formatUnits(BigInt(acrossQuote.minimumOutputRaw),acrossQuote.outputDecimals)} USDC</p>
    {acrossQuote.fees.map((f,i)=><p key={i} className="text-xs">Fees: {f}</p>)}
    <p className="text-xs">Provider steps: {acrossQuote.steps.join(' → ')} · {acrossQuote.walletConfirmations??'Unknown'} potential wallet confirmation(s)</p>
    <p className="text-xs">Estimated time: {acrossQuote.estimatedSeconds===null?'Not available':acrossQuote.estimatedSeconds+' seconds'}</p>
    <p className="text-xs">Expires: {new Date(acrossQuote.expiresAt).toLocaleTimeString()}</p>
    <p className="text-xs" style={{color:acrossQuote.expiresAt<=quoteRefresh?'var(--warning)':'var(--muted)'}}>
     {acrossQuote.expiresAt<=quoteRefresh?'Quote expired; request another before reviewing.':'Execution is disabled until spender, wallet approval and destination proof pass acceptance.'}

    </p>
   </div>}
  </section>}
  {executable?<MainnetCirclePage key={route.kind+':'+exchangeAssetId(from)+':'+exchangeAssetId(to)}
   embedded mode={route.kind==='swap'?'swap':'bridge'} selection={selection}
   onFinancialBusyChange={setEngineBusy}/>:
   !address&&route.kind!=='quote-only'?<ConnectKitButton/>:null}
  <p className="flex items-start gap-2 text-xs leading-5" style={{color:'var(--muted)'}}>
   <Wallet className="size-4 shrink-0"/>Wallet funds only. Gateway deposits are separate.
  </p>
  {picking&&<AssetPicker key={picking} side={picking} value={picking==='from'?from:to}
   other={picking==='from'?to:from} balances={balances} acrossReady={acrossReady} mode={viewMode} onChoose={choose} onClose={()=>setPicking(null)}/>}
 </main>;
}
