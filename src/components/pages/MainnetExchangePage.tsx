/** Human-first Swap and Bridge. Only routes accepted by the current Circle
 * quote executor are selectable. The wider exchange catalog is NOT a trade menu.
 * The single embedded Circle component owns amount, live quote, signing and recovery.
 */
import {useEffect,useMemo,useState} from 'react';
import {useAccount,useReadContracts} from 'wagmi';
import {erc20Abi,formatUnits} from 'viem';
import {ArrowDownUp,ArrowRightLeft,ChevronDown,Search,X,ShieldCheck,Info} from 'lucide-react';
import {BrandLogo} from '../brand/BrandLogo';
import {MainnetCirclePage,circleSigningBlock,isCircleSigningReady,type ExchangeExecutionSelection} from './MainnetCirclePage';
import {signingNotice} from '@/mainnet/exchangeSigningGate';
import {SigningNoticeBanner} from '@/components/ui/SigningNoticeBanner';
import {EXCHANGE_ASSETS,exchangeAssetId,resolveExchangeRoute,type ExchangeAsset} from '@/mainnet/exchangeCatalog';
import {reviewedExchangeAssets,reviewedExchangeNetworks,reviewedRouteStatus,
 type ReviewedExchangeMode,type ReviewedSide} from '@/mainnet/reviewedExchangeRoutes';
import {readExchangeIntents,type ExchangeIntent} from '@/mainnet/exchangeIntentJournal';

const ARC=5042,BASE=8453;
const asset=(chain:number,symbol:string)=>EXCHANGE_ASSETS.find(a=>a.chainId===chain&&a.symbol===symbol)!;
const nameOf=(chain:number)=>chain===ARC?'Arc':chain===BASE?'Base':chain===1?'Ethereum':'Unknown network';
function recordedExchange(owner:string):null|{mode:'swap'|'bridge';source:ExchangeAsset;destination:ExchangeAsset;status:string}{
 if(!owner)return null;
 try{
  for(const mode of ['swap','bridge'] as const){
   const raw=localStorage.getItem('veyra:mainnet:circle:v1:'+mode+':'+owner.toLowerCase());
   if(!raw)continue;
   const value:unknown=JSON.parse(raw);
   if(!value||typeof value!=='object'||Array.isArray(value))return null;
   const v=value as Record<string,unknown>;
   if(v.owner!==owner.toLowerCase()||!['UNKNOWN','PENDING','VERIFIED','REVERTED'].includes(String(v.status)))
    return null;
   const source=EXCHANGE_ASSETS.find(a=>a.chainId===v.source&&a.symbol===v.fromToken);
   const destination=EXCHANGE_ASSETS.find(a=>a.chainId===v.destination&&a.symbol===v.toToken);
   if(source&&destination)return {mode,source,destination,status:String(v.status)};
  }
 }catch{return null;}
 return null;
}
function AssetPicker({side,mode,value,other,balances,onChoose,onClose}:{
 side:ReviewedSide;mode:ReviewedExchangeMode;value:ExchangeAsset;other:ExchangeAsset;
 balances:Record<string,bigint>;onChoose:(asset:ExchangeAsset)=>void;onClose:()=>void;
}){
 const [query,setQuery]=useState('');
 const eligible=reviewedExchangeAssets(mode,side,side==='to'?other:undefined);
 const term=query.trim().toLowerCase();
 const items=eligible.filter(a=>!term||[a.name,a.symbol,a.contractAddress,a.network]
  .some(s=>s.toLowerCase().includes(term)))
  .sort((a,b)=>{
   const aOwned=(balances[exchangeAssetId(a)]??0n)>0n;
   const bOwned=(balances[exchangeAssetId(b)]??0n)>0n;
   return aOwned===bOwned?a.symbol.localeCompare(b.symbol):aOwned?-1:1;
  });
 useEffect(()=>{
  const esc=(e:KeyboardEvent)=>{if(e.key==='Escape')onClose();};
  window.addEventListener('keydown',esc);
  return()=>window.removeEventListener('keydown',esc);
 },[onClose]);
 return <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 sm:items-center sm:p-4"
  role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}>
  <section role="dialog" aria-modal="true" aria-label={side==='from'?'Choose token to pay':'Choose token to receive'}
   className="flex max-h-[85dvh] w-full max-w-md flex-col gap-3 rounded-t-2xl border p-4 shadow-2xl sm:rounded-2xl"
   style={{background:'var(--surface)',borderColor:'var(--border-strong)',color:'var(--ink)'}}>
   <header className="flex items-center justify-between gap-3">
    <div><h2 className="text-lg font-bold">{side==='from'?'You pay':'You receive'}</h2>
     <p className="text-xs" style={{color:'var(--muted)'}}>Arc · tokens with a reviewed Swap pair</p></div>
    <button type="button" onClick={onClose} className="veyra-btn-secondary" aria-label="Close token picker"><X className="size-4"/></button>
   </header>
   <label className="relative block">
    <Search className="absolute left-3 top-3.5 size-4" style={{color:'var(--muted)'}}/>
    <input autoFocus aria-label="Search supported tokens" value={query}
     placeholder="Search token" onChange={e=>setQuery(e.target.value)}
     className="veyra-route-input w-full rounded-xl border py-3 pl-10 pr-3 text-sm"
     style={{background:'var(--surface-raised)',borderColor:'var(--border)',color:'var(--ink)'}}/>
   </label>
   <div className="min-h-0 flex-1 space-y-1 overflow-auto" role="listbox" aria-label="Swap tokens">
    {items.length===0?<p className="py-8 text-center text-sm" style={{color:'var(--muted)'}}>
     No supported token matches your search.
    </p>:items.map(token=>{
     const selected=exchangeAssetId(token)===exchangeAssetId(value);
     const balance=balances[exchangeAssetId(token)];
     return <button type="button" role="option" aria-selected={selected} key={exchangeAssetId(token)}
      onClick={()=>onChoose(token)}
      className="flex min-h-16 w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors"
      style={{color:'var(--ink)',borderColor:selected?'var(--border-strong)':'transparent',
       background:selected?'var(--accent-muted)':'transparent'}}>
      <BrandLogo logoKey={token.logo} size={36}/>
      <span className="min-w-0 flex-1"><span className="block font-semibold">{token.symbol}</span>
       <span className="block truncate text-xs" style={{color:'var(--muted)'}}>{token.name} · Arc</span>
      </span>
      <span className="text-right text-xs tabular-nums" style={{color:'var(--muted)'}}>
       {balance===undefined?'Balance —':formatUnits(balance,token.decimals)}
      </span>
     </button>;
    })}
   </div>
  </section>
 </div>;
}
function BridgeNetworkPicker({side,from,balances,onChoose,onClose}:{
 side:ReviewedSide;from:ExchangeAsset;balances:Record<string,bigint>;
 onChoose:(a:ExchangeAsset)=>void;onClose:()=>void;
}){
 const [query,setQuery]=useState('');
 const options=reviewedExchangeNetworks('bridge',side,side==='to'?from:undefined)
  .filter(x=>x.name.toLowerCase().includes(query.trim().toLowerCase()));
 useEffect(()=>{
  const onKey=(e:KeyboardEvent)=>{if(e.key==='Escape')onClose();};
  window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey);
 },[onClose]);
 return <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 sm:items-center sm:p-5"
   role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}>
  <section role="dialog" aria-modal="true" aria-label={'Select '+side+' network'}
   className="flex max-h-[85dvh] w-full max-w-md flex-col gap-3 rounded-t-2xl border p-4 shadow-2xl sm:rounded-2xl"
   style={{background:'var(--surface)',borderColor:'var(--border-strong)',color:'var(--ink)'}}>
   <header className="flex items-center justify-between gap-3">
    <div><h2 className="text-lg font-bold">{side==='from'?'From network':'To network'}</h2>
     <p className="text-xs" style={{color:'var(--muted)'}}>Native USDC · integrated CCTP routes</p></div>
    <button type="button" onClick={onClose} aria-label="Close network selector"
     className="veyra-btn-secondary rounded-lg p-2"><X className="size-4"/></button>
   </header>
   <label className="relative block">
    <Search className="absolute left-3 top-3.5 size-4" style={{color:'var(--muted)'}}/>
    <input autoFocus value={query} onChange={e=>setQuery(e.target.value)}
     placeholder="Search network" aria-label="Search supported networks"
     className="veyra-route-input w-full rounded-xl border py-3 pl-10 pr-3 text-sm"
     style={{background:'var(--surface-raised)',borderColor:'var(--border)',color:'var(--ink)'}}/>
   </label>
   <div className="min-h-0 overflow-y-auto space-y-2">
    {options.length===0?<p className="py-6 text-center text-sm" style={{color:'var(--muted)'}}>
     No available network matches your search.</p>:
     options.map(x=><button key={x.chainId} type="button" onClick={()=>onChoose(x.asset)}
      className="veyra-route-control flex w-full items-center gap-3 rounded-xl p-3 text-left">
      <BrandLogo logoKey={x.logo} size={34}/>
      <span className="min-w-0 flex-1"><span className="block font-semibold">{x.name}</span>
       <span className="block text-xs" style={{color:'var(--muted)'}}>USDC · Mainnet</span></span>
      <span className="text-right text-xs tabular-nums" style={{color:'var(--muted)'}}>
       {balances[exchangeAssetId(x.asset)]===undefined?'Balance —':formatUnits(balances[exchangeAssetId(x.asset)],6)+' USDC'}
      </span>
     </button>)}
   </div>
   <p className="text-xs" style={{color:'var(--muted)'}}>Arc routes require independent quote, contract and destination mint acceptance.</p>
  </section>
 </div>;
}
export function MainnetExchangePage({initialBridge=false}:{initialBridge?:boolean}){
 const {address}=useAccount();
 const mode:ReviewedExchangeMode=initialBridge?'bridge':'swap';
 const [from,setFrom]=useState<ExchangeAsset>(()=>asset(initialBridge?ARC:ARC,'USDC'));
 const [to,setTo]=useState<ExchangeAsset>(()=>initialBridge?asset(BASE,'USDC'):asset(ARC,'EURC'));
 const [picking,setPicking]=useState<ReviewedSide|null>(null);
 const [prior,setPrior]=useState<ReturnType<typeof recordedExchange>>(null);
 const [unknownPrior,setUnknownPrior]=useState(false);
 const [intentPrior,setIntentPrior]=useState<ExchangeIntent|null>(null);
 const [intentBlocked,setIntentBlocked]=useState(false);
 const [engineBusy,setEngineBusy]=useState(false);
 const owner=address?.toLowerCase()??'';
 const availableDestinations=reviewedExchangeAssets(mode,'to',from);
 const readable=useMemo(()=>{
  const unique=new Map<string,ExchangeAsset>();
  for(const a of [...reviewedExchangeAssets(mode,'from'),...reviewedExchangeAssets(mode,'to')])
   unique.set(exchangeAssetId(a),a);
  return [...unique.values()];
 },[mode]);
 const {data:walletBalances}=useReadContracts({
  contracts:readable.map(a=>({address:a.contractAddress,abi:erc20Abi,
   functionName:'balanceOf' as const,chainId:a.chainId,
   args:[address??'0x0000000000000000000000000000000000000000'] as const})),
  query:{enabled:!!address,staleTime:16000,refetchInterval:30000},
 });
 const balances=useMemo(()=>{
  const b:Record<string,bigint>={};
  readable.forEach((a,i)=>{
   const x=walletBalances?.[i];
   if(x?.status==='success'&&typeof x.result==='bigint')b[exchangeAssetId(a)]=x.result;
  });
  return b;
 },[readable,walletBalances]);
 useEffect(()=>{
  if(!address){setPrior(null);setUnknownPrior(false);setIntentPrior(null);setIntentBlocked(false);return;}
  const refresh=()=>{
   try{
    const previous=recordedExchange(owner);
    const raws=['swap','bridge'].map(m=>localStorage.getItem('veyra:mainnet:circle:v1:'+m+':'+owner));
    setUnknownPrior(raws.some(raw=>!!raw&&!previous));
    setPrior(previous);
    const pending=readExchangeIntents(owner);
    setIntentBlocked(pending.kind==='blocked');
    setIntentPrior(pending.kind==='ready'?pending.items.find(i=>
     !['DESTINATION_VERIFIED','REFUNDED','SOURCE_REVERTED','CANCELLED_BEFORE_SOURCE'].includes(i.stage))??null:null);
    if(previous?.mode===mode){setFrom(previous.source);setTo(previous.destination);}
   }catch{setUnknownPrior(true);setPrior(null);}
  };
  refresh();
  const timer=window.setInterval(refresh,3000);
  window.addEventListener('storage',refresh);window.addEventListener('focus',refresh);
  return()=>{window.clearInterval(timer);window.removeEventListener('storage',refresh);window.removeEventListener('focus',refresh);};
 },[address,owner,mode]);
 const locked=!!prior||unknownPrior||engineBusy||!!intentPrior||intentBlocked;
 const route=resolveExchangeRoute(from,to);
 const canQuote=route.kind===mode;
 const status=reviewedRouteStatus(mode,from,to,isCircleSigningReady(mode));
 const signingBlock=circleSigningBlock(mode);
 const notice=signingBlock?signingNotice(signingBlock):null;
 const statusLabel=status==='paused'?(notice?.headline??'Quotes only'):
  status==='reviewable'?'Live quote required before signing':'Route not supported';
 const selection:ExchangeExecutionSelection={fromChainId:from.chainId,toChainId:to.chainId,
  fromToken:from.symbol as 'USDC'|'EURC',toToken:to.symbol as 'USDC'|'EURC'};
 function chooseSource(next:ExchangeAsset){
  if(locked)return;
  const choices=reviewedExchangeAssets(mode,'to',next);
  if(!choices.length)return;
  setFrom(next);
  if(!choices.some(a=>exchangeAssetId(a)===exchangeAssetId(to)))setTo(choices[0]);
  setPicking(null);
 }
 function chooseDestination(next:ExchangeAsset){
  if(locked||!availableDestinations.some(a=>exchangeAssetId(a)===exchangeAssetId(next)))return;
  setTo(next);setPicking(null);
 }
 function reverse(){
  if(locked)return;
  const reversed=resolveExchangeRoute(to,from);
  if(reversed.kind!==mode)return;
  setFrom(to);setTo(from);
 }
 
 const networkButton=(a:ExchangeAsset,side:ReviewedSide,active:boolean)=>(
  <button type="button" key={exchangeAssetId(a)}
   disabled={locked} onClick={()=>setPicking(side)}
   aria-pressed={active}
   className="flex min-h-14 min-w-0 flex-1 items-center gap-1.5 rounded-xl border p-2 text-left disabled:opacity-50 sm:gap-2 sm:p-3"
   style={{background:active?'var(--accent-muted)':'var(--veyra-control)',
    borderColor:active?'var(--border-strong)':'var(--border)',color:'var(--ink)'}}>
   <BrandLogo logoKey={a.chainId===ARC?'arc':a.chainId===1?'ethereum':'base'} size={26}/>
   <span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold sm:text-sm">{nameOf(a.chainId)}</span>
    <span className="block truncate text-[10px]" style={{color:'var(--muted)'}}>USDC <span className="hidden sm:inline">· Mainnet</span></span></span><ChevronDown className="size-3.5 shrink-0"/>
  </button>
 );
 return <main className="veyra-page veyra-route-page mx-auto w-full max-w-2xl space-y-3 px-4 py-4 md:px-7 md:py-6">
  <header>
   <p className="veyra-eyebrow">VEYRA · MAINNET</p>
   <h1 className="veyra-page-title">{mode==='swap'?'Swap':'Bridge'}</h1>
   <p className="veyra-page-subtitle">{mode==='swap'?'Exchange USDC and EURC on Arc.':'Move native USDC across supported Circle CCTP networks.'}</p>
  </header>
  <section className="veyra-card space-y-3 p-3 sm:p-5" aria-label={mode==='swap'?'Swap form':'Bridge form'}>
   {status==='paused'&&notice?<SigningNoticeBanner headline={notice.headline} body={notice.body}/>:
    status!=='reviewable'&&<div role="status" className="flex items-start gap-2 rounded-xl border px-3 py-2.5 text-xs font-semibold"
    style={{color:'var(--muted)',borderColor:'var(--border)',background:'var(--surface-raised)'}}>
    <ShieldCheck className="size-4 shrink-0"/>
    <span className="block">{statusLabel}</span>
   </div>}
   {mode==='swap'?<>
    <div className="flex items-center justify-between">
     <p className="text-xs font-semibold" style={{color:'var(--muted)'}}>SWAP ROUTE</p>
     <span className="inline-flex items-center gap-2 text-xs font-semibold" style={{color:'var(--muted)'}}>
      <BrandLogo logoKey="arc" size={20}/> Arc Mainnet
     </span>
    </div>
    <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-end gap-2"
     aria-label="Swap token route">
     <div className="min-w-0 space-y-1.5">
      <p className="text-[11px] font-semibold" style={{color:'var(--muted)'}}>FROM</p>
      <button type="button" disabled={locked} onClick={()=>setPicking('from')}
       aria-label="Choose token to pay"
       className="veyra-route-control flex min-h-16 w-full min-w-0 items-center gap-1.5 p-2 text-left disabled:opacity-50 sm:gap-2 sm:p-3">
       <BrandLogo logoKey={from.logo} size={30}/>
       <span className="min-w-0 flex-1"><span className="block truncate text-sm font-bold">{from.symbol}</span>
        <span className="block truncate text-[10px]" style={{color:'var(--muted)'}}>{from.name}</span></span>
       <ChevronDown className="size-3.5 shrink-0"/>
      </button>
     </div>
     <button type="button" disabled={locked} onClick={reverse} aria-label="Reverse swap pair"
      className="veyra-btn-secondary mb-3 flex size-9 shrink-0 items-center justify-center rounded-full p-0 disabled:opacity-50">
      <ArrowRightLeft className="size-4"/>
     </button>
     <div className="min-w-0 space-y-1.5">
      <p className="text-[11px] font-semibold" style={{color:'var(--muted)'}}>TO</p>
      <button type="button" disabled={locked} onClick={()=>setPicking('to')}
       aria-label="Choose token to receive"
       className="veyra-route-control flex min-h-16 w-full min-w-0 items-center gap-1.5 p-2 text-left disabled:opacity-50 sm:gap-2 sm:p-3">
       <BrandLogo logoKey={to.logo} size={30}/>
       <span className="min-w-0 flex-1"><span className="block truncate text-sm font-bold">{to.symbol}</span>
        <span className="block truncate text-[10px]" style={{color:'var(--muted)'}}>{to.name}</span></span>
       <ChevronDown className="size-3.5 shrink-0"/>
      </button>
     </div>
    </div>
   </>:<>
    <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-end gap-2"
     aria-label="Bridge route">
     <div className="min-w-0 space-y-1.5">
      <p className="text-[11px] font-semibold" style={{color:'var(--muted)'}}>FROM</p>
      <div className="flex min-w-0">{networkButton(from,'from',true)}</div>
     </div>
     <button type="button" disabled={locked} onClick={reverse} aria-label="Reverse bridge direction"
      className="veyra-btn-secondary mb-1 flex size-9 shrink-0 items-center justify-center rounded-full p-0 disabled:opacity-50"
      ><ArrowRightLeft className="size-4"/></button>
     <div className="min-w-0 space-y-1.5">
      <p className="text-[11px] font-semibold" style={{color:'var(--muted)'}}>TO</p>
      <div className="flex min-w-0">{networkButton(to,'to',true)}</div>
     </div>
    </div>
   </>}
   {canQuote?<MainnetCirclePage key={mode+':'+exchangeAssetId(from)+':'+exchangeAssetId(to)}
    embedded mode={mode} selection={selection} onFinancialBusyChange={setEngineBusy}
    />:
    <p role="status" className="rounded-xl border p-3 text-sm" style={{color:'var(--warning)',borderColor:'var(--border)'}}>
     This pair has no reviewed {mode} quote route. No transaction can start.
    </p>}
   {(locked||intentPrior)&&<p role="status" className="flex items-start gap-2 text-xs leading-5"
     style={{color:'var(--warning)'}}>
     <Info className="mt-0.5 size-4 shrink-0"/>
     {intentBlocked||unknownPrior?'Saved exchange state could not be verified. No new transaction is permitted.':
      intentPrior?.stage==='PARTIAL'?'An earlier transfer reached its source but the destination has not been verified. Review Activity; do not resend.':
      'An earlier operation is still recorded. Review the original transaction before creating a new one.'}
    </p>}
  </section>
  {picking&&mode==='swap'&&<AssetPicker key={picking} side={picking} mode={mode} value={picking==='from'?from:to}
   other={picking==='from'?to:from} balances={balances}
   onChoose={picking==='from'?chooseSource:chooseDestination} onClose={()=>setPicking(null)}/>}
  {picking&&mode==='bridge'&&<BridgeNetworkPicker side={picking} from={from}
    balances={balances} onChoose={picking==='from'?chooseSource:chooseDestination}
    onClose={()=>setPicking(null)}/>}
 </main>;
}
