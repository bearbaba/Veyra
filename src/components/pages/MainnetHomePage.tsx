/** Mainnet-first Veyra Home: money, actions, attention, activity — in that order. */
import {useEffect,useState} from 'react';
import {useAccount,useReadContract} from 'wagmi';
import {ConnectKitButton} from 'connectkit';
import {erc20Abi,formatUnits} from 'viem';
import {ArrowDownLeft,ArrowLeftRight,Copy,RefreshCw,Users,Clock3,LayoutList,SendHorizontal,Route,ArrowRight,UserRound,ShieldCheck,Wallet,Check,ChevronRight} from 'lucide-react';
import {getUsdc} from '@/onchain-facts';
import {BrandLogo} from '../brand/BrandLogo';
import {MainnetUnifiedBalancePanel} from './MainnetUnifiedBalancePanel';
import {readLocalOperations,type LocalOperation} from '@/mainnet/localOperations';
import {readExchangeIntents,type ExchangeIntent} from '@/mainnet/exchangeIntentJournal';
import {useUnifiedSocial} from '@/features/social/UnifiedSocial';
import {isMainnetSessionForWallet,scopedMainnetReceipts} from '@/mainnet/signedWalletReceiptScope';
import {listVerifiedMainnetPayReceipts,type MainnetPayServerReceipt} from '@/lib/api/mainnetPayReceipts';
import {listVerifiedMainnetSettlementReceipts,type MainnetSettlementServerReceipt} from '@/lib/api/mainnetSettlementReceipts';
import type {VeyraPage} from '../layout/AppShell';

const ARC=5042;
const explorer=(hash:string,chain:number)=>chain===8453?'https://basescan.org/tx/'+hash:'https://explorer.arc.io/tx/'+hash;
export function MainnetHomePage({onNavigate}:{onNavigate:(page:VeyraPage)=>void}){
 const {address,isConnected,chainId,connector}=useAccount();
 const social=useUnifiedSocial();
 const signedWallet=isMainnetSessionForWallet(social.session,address,connector?.uid);
 const [accountReceipts,setAccountReceipts]=useState<MainnetPayServerReceipt[]>([]);
 const [settlementReceipts,setSettlementReceipts]=useState<MainnetSettlementServerReceipt[]>([]);
 const [settlementScope,setSettlementScope]=useState('');
 const [accountScope,setAccountScope]=useState('');
 const [localScope,setLocalScope]=useState('');
 const [receive,setReceive]=useState(false);
 const [copied,setCopied]=useState(false);
 const [copyError,setCopyError]=useState(false);
 const [operations,setOperations]=useState<LocalOperation[]>([]);
 const [exchangeIntents,setExchangeIntents]=useState<ExchangeIntent[]>([]);
 const usdc=getUsdc(ARC);
 const {data,refetch,isError,isFetching}=useReadContract({
  address:usdc?.address as `0x${string}` | undefined,abi:erc20Abi,functionName:'balanceOf',
  args:address?[address]:undefined,chainId:ARC,
  query:{enabled:!!address&&!!usdc,staleTime:8000,refetchInterval:15000},
 });
 useEffect(()=>{
  setLocalScope('');
  if(!address){setOperations([]);setExchangeIntents([]);return;}
  const update=()=>{setOperations(readLocalOperations(address));setLocalScope(address.toLowerCase());
   const items=readExchangeIntents(address);
   setExchangeIntents(items.kind==='ready'?items.items:[]);};
  update();
  window.addEventListener('focus',update);
  window.addEventListener('storage',update);
  const timer=window.setInterval(update,15000);
  return()=>{window.removeEventListener('focus',update);window.removeEventListener('storage',update);window.clearInterval(timer);};
 },[address]);
 useEffect(()=>{
  setAccountReceipts([]);setAccountScope('');
  const token=social.session?.token;
  if(!address||!token||social.identityOrigin!=='ready'||!signedWallet)return;
  const owner=address;
  const controller=new AbortController();
  let active=true;
  async function reload(){
   try{
    const items=await listVerifiedMainnetPayReceipts(token!,controller.signal);
    if(active){setAccountReceipts(scopedMainnetReceipts(items,owner).slice(0,10));
     setAccountScope(owner.toLowerCase()+':'+token);}
   }catch{/* Offline identity history falls back to local transactions without fake receipts. */}
  }
  void reload();
  const handle=()=>void reload();
  window.addEventListener('focus',handle);
  window.addEventListener('veyra:mainnet:server-receipt',handle);
  return()=>{active=false;controller.abort();
   window.removeEventListener('focus',handle);
   window.removeEventListener('veyra:mainnet:server-receipt',handle);};
 },[address,connector?.uid,social.session?.token,social.session?.walletKey,social.identityOrigin,signedWallet]);
 useEffect(()=>{
  setSettlementReceipts([]);setSettlementScope('');
  const token=social.session?.token;
  if(!address||!token||social.identityOrigin!=='ready'||!signedWallet)return;
  const owner=address,controller=new AbortController();
  let active=true;
  async function reload(){
   try{
    const rows=await listVerifiedMainnetSettlementReceipts(token!,controller.signal);
    if(active){setSettlementReceipts(scopedMainnetReceipts(rows,owner).slice(0,10));
     setSettlementScope(owner.toLowerCase()+':'+token);}
   }catch{/* Direct and local payment history stay visible without contract index. */}
  }
  void reload();
  const trigger=()=>void reload();
  window.addEventListener('focus',trigger);
  window.addEventListener('veyra:mainnet:server-receipt',trigger);
  return()=>{active=false;controller.abort();
   window.removeEventListener('focus',trigger);
   window.removeEventListener('veyra:mainnet:server-receipt',trigger);};
 },[address,connector?.uid,social.session?.token,social.session?.walletKey,social.identityOrigin,signedWallet]);
 const scopedServer=signedWallet&&address&&social.session?.token&&
  accountScope===address.toLowerCase()+':'+social.session.token?accountReceipts:[];
 const scopedLocal=address&&localScope===address.toLowerCase()?operations:[];
 const scopedExchange=address&&localScope===address.toLowerCase()?exchangeIntents:[];
 const scopedSettlement=signedWallet&&address&&social.session?.token&&
  settlementScope===address.toLowerCase()+':'+social.session.token?settlementReceipts:[];
 const recentVerified=[...scopedServer,...scopedSettlement].sort((a,b)=>
  Date.parse(b.paidAt)-Date.parse(a.paidAt)).slice(0,3);
 const knownHashes=new Set([...scopedServer,...scopedSettlement].map(x=>x.txHash.toLowerCase()));
 const exchangeHashes=new Set(scopedExchange.flatMap(task=>[
  ...(task.sourceHash?[task.sourceHash.toLowerCase()]:[]),
  ...(task.destinationHash?[task.destinationHash.toLowerCase()]:[])]));
 const localRecent=scopedLocal.filter(x=>!((x.type==='Pay'||x.type==='Settlement')&&knownHashes.has(x.hash.toLowerCase()))&&
  !((x.type==='Swap'||x.type==='Bridge')&&exchangeHashes.has(x.hash.toLowerCase())));
 const recentExchange=scopedExchange.slice(0,3);
 const wrong=isConnected&&chainId!==ARC;
 const available=!address?'—':isError?'Unavailable':data!==undefined?formatUnits(data,6):'Reading…';
 const pending=scopedLocal.filter(x=>x.status==='SUBMITTED');
 const actions:{id:'send'|'people'|'swap';label:string;icon:React.ReactNode}[]=[
  {id:'send',label:'Send',icon:<SendHorizontal className="size-5"/>},
  {id:'people',label:'People',icon:<Users className="size-5"/>},
  {id:'swap',label:'Swap',icon:<ArrowLeftRight className="size-5"/>},
 ];
 function selectAction(id:(typeof actions)[number]['id']){
  onNavigate(id==='send'?'settlement':id==='people'?'social':'convert');
 }
 const card='veyra-card p-5 sm:p-6';
 const cardStyle={background:'var(--surface)',border:'1px solid var(--border)'};
 async function copy(){
  if(!address)return;
  try{await navigator.clipboard.writeText(address);setCopied(true);setCopyError(false);}
  catch{setCopyError(true);}
 }
 return <div className="veyra-page veyra-home mx-auto w-full max-w-[900px] space-y-4 px-4 py-6 md:px-6 md:py-9">
  <section className="veyra-calm-home-heading flex flex-wrap items-center justify-between gap-4" aria-label="Veyra overview">
  <div className="min-w-0">
   <h1 className="display text-[1.85rem] font-bold tracking-tight sm:text-[2.2rem]" style={{color:'var(--ink)'}}>Your money</h1>
   <p className="mt-1 text-sm" style={{color:'var(--muted)'}}>Pay, connect and track — all in one place.</p>
  </div>
  <button type="button" onClick={()=>onNavigate('social')} className="veyra-calm-id-chip flex max-w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left">
   <span className="flex size-9 shrink-0 items-center justify-center rounded-lg" style={{background:'var(--accent-muted)',color:'var(--accent)'}}>
    <UserRound className="size-[19px]"/>
   </span>
   <span className="min-w-0">
    <span className="block text-[11px]" style={{color:'var(--muted)'}}>Veyra ID</span>
    <span className="block max-w-[240px] truncate text-sm font-semibold" style={{color:'var(--ink)'}}>
     {signedWallet&&social.identityOrigin==='ready'&&social.session?.profile.veyraHandle
       ? '@'+social.session.profile.veyraHandle+'.veyra'
       : address?'Set up your ID':'Connect to begin'}
    </span>
   </span>
   <ChevronRight className="size-4 shrink-0" style={{color:'var(--muted)'}}/>
  </button>
 </section>
 <section className="veyra-card veyra-brand-balance p-5 sm:p-6" aria-label="Wallet balance">
   <div className="flex items-center justify-between gap-3">
    <span className="inline-flex items-center gap-2 text-sm font-semibold" style={{color:'var(--muted)'}}>
     <BrandLogo logoKey="usdc" size={27}/> Wallet USDC
    </span>
    <button type="button" onClick={()=>void refetch()} disabled={!address||isFetching}
     className="veyra-icon-button" aria-label="Refresh balance" title="Refresh balance">
     <RefreshCw className={'size-4 '+(isFetching?'animate-spin':'')}/>
    </button>
   </div>
   <div className="mt-3 flex items-baseline gap-2">
    <strong className="display text-4xl font-bold tabular-nums sm:text-5xl" style={{color:'var(--ink)'}}>{available}</strong>
    <span className="text-lg font-semibold" style={{color:'var(--muted)'}}>USDC</span>
   </div>
   <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-4" style={{borderColor:'var(--border)'}}>
    <span className="flex items-center gap-2 text-xs" style={{color:wrong?'var(--warning)':'var(--muted)'}}>
     <BrandLogo logoKey="arc" size={22}/> {wrong?'Switch to Arc Mainnet':'Arc Mainnet'}
    </span>
    <button type="button" onClick={()=>setReceive(v=>!v)} disabled={!address} aria-expanded={receive}
     className="veyra-btn-secondary inline-flex items-center gap-2 disabled:opacity-50"><ArrowDownLeft className="size-4"/>Receive</button>
   </div>
   <MainnetUnifiedBalancePanel compact/>
  </section>
  <section aria-label="Quick actions">
   <div className="grid grid-cols-3 gap-2.5">
    {actions.map(item=><button key={item.id} type="button"
     onClick={()=>selectAction(item.id)}
     className="veyra-action-card flex min-h-[74px] items-center justify-center gap-2.5 rounded-xl border px-3 text-sm font-semibold">
     <span style={{color:'var(--accent)'}}>{item.icon}</span>
     <span style={{color:'var(--ink)'}}>{item.label}</span>
    </button>)}
   </div>
  </section>
  {receive&&<section className="rounded-xl border p-4" style={cardStyle} aria-label="Receive USDC on Arc Mainnet">
    <div className="flex items-center justify-between gap-3">
     <h2 className="font-semibold" style={{color:'var(--ink)'}}>Receive USDC</h2>
     <button type="button" onClick={()=>setReceive(false)}
      className="text-xs font-semibold" style={{color:'var(--accent)'}}>Close</button>
    </div>
    <div className="mt-2">
    <p className="text-xs" style={{color:'var(--muted)'}}>Use only Arc Mainnet USDC for this displayed wallet route.</p>
    <p className="my-3 break-all font-mono text-sm" style={{color:'var(--ink)'}}>{address??'Connect wallet to receive'}</p>
    <button disabled={!address} onClick={()=>void copy()} className="flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-semibold disabled:opacity-40"
      style={{borderColor:'var(--border)',color:'var(--ink)'}}><Copy className="size-4"/>{copied?'Copied':'Copy address'}</button>
    {copyError&&<p role="alert" className="mt-2 text-xs" style={{color:'var(--warning)'}}>Clipboard unavailable. Copy the address manually.</p>}
    </div>
  </section>}

  {wrong&&<p role="status" className="rounded-xl px-4 py-3 text-sm" style={{background:'var(--surface)',color:'var(--warning)'}}>
   Balance shown is on Arc Mainnet. Switch your wallet to Arc Mainnet before signing; no Testnet fallback is permitted.
  </p>}
  {pending.length>0&&<section role="status" className="veyra-panel flex items-center justify-between gap-3 rounded-xl border p-4">
   <div className="flex items-center gap-2"><Clock3 className="size-4 shrink-0" style={{color:'var(--warning)'}}/>
    <span className="text-sm" style={{color:'var(--ink)'}}>Payment processing · check Activity before sending again</span>
   </div>
   <button type="button" onClick={()=>onNavigate('activity')} className="shrink-0 text-xs font-semibold"
    style={{color:'var(--accent)'}}>View</button>
  </section>}
  <section className={card} style={cardStyle} aria-label="Recent activity">
   <div className="flex items-center justify-between gap-3">
    <h2 className="text-base font-bold" style={{color:'var(--ink)'}}>Recent activity</h2>
    <button onClick={()=>onNavigate('activity')} className="text-xs font-semibold" style={{color:'var(--accent)'}}>View all</button>
   </div>
   {recentVerified.length===0&&localRecent.length===0&&recentExchange.length===0?
    <p className="mt-3 text-sm" style={{color:'var(--muted)'}}>No transactions yet.</p>:
    <div className="mt-3 divide-y" style={{borderColor:'var(--border)'}}>
     {recentVerified.map(x=><div className="flex items-center gap-3 py-3" key={'remote:'+x.txHash}>
      <div className="min-w-0 flex-1">
       <p className="text-sm font-semibold" style={{color:'var(--ink)'}}>
        {x.direction==='sent'?'Sent':'Received'} · {formatUnits(BigInt(
         x.kind==='settlement'&&x.direction==='received'?x.netAmountRaw:x.amountRaw),6)} USDC
       </p>
       <p className="mt-1 text-xs" style={{color:'var(--success)'}}>
        Verified · {x.recipientLabel??'Arc Mainnet'} · {new Date(x.paidAt).toLocaleDateString()}
       </p>
      </div>
      <button type="button" onClick={()=>onNavigate('activity')} className="text-xs font-semibold"
       style={{color:'var(--accent)'}}>Receipt</button>
     </div>)}
     {recentExchange.slice(0,Math.max(0,3-recentVerified.length)).map(task=>
      <div className="flex items-center gap-3 py-3" key={'exchange:'+task.id}>
       <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold" style={{color:'var(--ink)'}}>
         {task.mode==='swap'?'Swap':'Bridge'} · {task.amountIn} {task.tokenIn} → {task.tokenOut}
        </p>
        <p className="mt-1 text-xs" style={{color:task.stage==='PARTIAL'?'var(--warning)':'var(--muted)'}}>
         {task.stage==='DESTINATION_VERIFIED'?'Destination verified · proof in Activity':
          task.stage==='SOURCE_REVERTED'?'Source transaction reverted onchain':
          task.stage==='PARTIAL'?'Partially completed · recovery required':
          task.stage==='REFUNDED'?'Refund recorded · inspect proof':
          'Tracking original Exchange · no duplicate transfer'}
        </p>
       </div>
       <button type="button" onClick={()=>onNavigate('activity')} className="text-xs font-semibold"
        style={{color:'var(--accent)'}}>Details</button>
      </div>)}
     {localRecent.slice(0,Math.max(0,3-recentVerified.length-recentExchange.length)).map(x=><div className="flex items-center gap-3 py-3" key={x.type+x.hash}>
      <div className="min-w-0 flex-1"><p className="text-sm font-semibold" style={{color:'var(--ink)'}}>
       {x.type} · {x.amount} {x.asset}</p>
       <p className="mt-1 text-xs" style={{color:'var(--muted)'}}>
        {x.status==='SUBMITTED'?'Checking onchain in Activity':x.status==='REVERTED'?'Original transaction reverted':'Saved on this device · Open Activity for verification'}</p></div>
      <a href={explorer(x.hash,x.chainId)} target="_blank" rel="noreferrer"
       className="text-xs font-semibold" style={{color:'var(--accent)'}}>Explorer</a>
     </div>)}
    </div>}
  </section>
 </div>;
}
