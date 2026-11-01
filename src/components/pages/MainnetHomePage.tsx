/** Mainnet-first Veyra Home: money, actions, attention, activity — in that order. */
import {useEffect,useState} from 'react';
import {useAccount,useReadContract} from 'wagmi';
import {ConnectKitButton} from 'connectkit';
import {erc20Abi,formatUnits} from 'viem';
import {ArrowLeftRight,ArrowUpRight,ArrowDownLeft,Route,Copy,RefreshCw,ShieldCheck,Clock3,Wallet} from 'lucide-react';
import {getUsdc} from '@/onchain-facts';
import {MAINNET_ROUTES,type MainnetRoute} from '@/mainnet/mainnetProduct';
import {readLocalOperations,type LocalOperation} from '@/mainnet/localOperations';
import type {VeyraPage} from '../layout/AppShell';

const ARC=5042;
const explorer=(hash:string,chain:number)=>chain===8453?'https://basescan.org/tx/'+hash:'https://explorer.arc.io/tx/'+hash;
export function MainnetHomePage({onNavigate}:{onNavigate:(page:VeyraPage)=>void}){
 const {address,isConnected,chainId}=useAccount();
 const [receive,setReceive]=useState(false);
 const [copied,setCopied]=useState(false);
 const [copyError,setCopyError]=useState(false);
 const [operations,setOperations]=useState<LocalOperation[]>([]);
 const usdc=getUsdc(ARC);
 const {data,refetch,isError,isFetching}=useReadContract({
  address:usdc?.address,abi:erc20Abi,functionName:'balanceOf',
  args:address?[address]:undefined,chainId:ARC,
  query:{enabled:!!address&&!!usdc,staleTime:8000,refetchInterval:15000},
 });
 useEffect(()=>{
  if(!address){setOperations([]);return;}
  const update=()=>setOperations(readLocalOperations(address));
  update();
  window.addEventListener('focus',update);
  const timer=window.setInterval(update,15000);
  return()=>{window.removeEventListener('focus',update);window.clearInterval(timer);};
 },[address]);
 const wrong=isConnected&&chainId!==ARC;
 const available=!address?'—':isError?'Unavailable':data!==undefined?formatUnits(data,6):'Reading…';
 const pending=operations.filter(x=>x.status==='SUBMITTED');
 const actions:{route:MainnetRoute;label:string;icon:React.ReactNode}[]=[
  {route:'pay',label:'Send',icon:<ArrowUpRight className="size-5"/>},
  {route:'swap',label:'Swap',icon:<ArrowLeftRight className="size-5"/>},
  {route:'bridge',label:'Bridge',icon:<Route className="size-5"/>},
  {route:'settlement',label:'Contract Pay',icon:<ShieldCheck className="size-5"/>},
 ];
 const card='rounded-2xl p-5 sm:p-6';
 const cardStyle={background:'var(--surface)',border:'1px solid var(--border)'};
 async function copy(){
  if(!address)return;
  try{await navigator.clipboard.writeText(address);setCopied(true);setCopyError(false);}
  catch{setCopyError(true);}
 }
 return <div className="mx-auto w-full max-w-6xl space-y-5 px-4 py-6 md:px-7 md:py-8">
  <header className="flex flex-wrap items-center justify-between gap-3">
   <div><p className="text-xs font-semibold uppercase tracking-widest" style={{color:'var(--accent)'}}>
    Veyra · Arc Mainnet</p>
    <h1 className="display mt-1 text-2xl font-bold sm:text-3xl" style={{color:'var(--ink)'}}>Your money, in one place.</h1>
   </div>
   <span className="rounded-full px-3 py-1.5 text-xs font-semibold"
    style={{background:'var(--surface)',color:wrong?'var(--warning)':'var(--muted)',border:'1px solid var(--border)'}}>
    {wrong?'Wallet on another network':isConnected?'Wallet connected':'Wallet disconnected'}
   </span>
  </header>
  <div className="grid gap-3 lg:grid-cols-[1.3fr_0.7fr]">
   <section className={card} style={{...cardStyle,background:'var(--surface-strong)'}} aria-label="Wallet balance">
    <div className="flex items-center justify-between">
     <span className="flex items-center gap-2 text-sm font-semibold" style={{color:'var(--muted)'}}>
      <Wallet className="size-4"/> Arc Mainnet · Wallet USDC
     </span>
     <button type="button" onClick={()=>void refetch()} disabled={!address||isFetching}
      className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs disabled:opacity-40"
      style={{color:'var(--muted)'}}><RefreshCw className={'size-3.5 '+(isFetching?'animate-spin':'')}/> Refresh</button>
    </div>
    <div className="mt-4 flex flex-wrap items-baseline gap-2">
     <strong className="display text-3xl font-bold tabular-nums sm:text-4xl" style={{color:'var(--ink)'}}>{available}</strong>
     <span className="text-base font-semibold" style={{color:'var(--muted)'}}>USDC</span>
    </div>
    <p className="mt-3 text-xs" style={{color:'var(--muted)'}}>Spendable wallet tokens, not Circle Gateway deposits.</p>
    {!address&&<div className="mt-4"><ConnectKitButton/></div>}
   </section>
   <section className={card} style={cardStyle} aria-label="Circle Gateway Unified">
    <p className="text-sm font-semibold" style={{color:'var(--ink)'}}>Unified · Circle Gateway</p>
    <p className="mt-4 text-lg font-semibold" style={{color:'var(--muted)'}}>Not connected</p>
    <p className="mt-2 text-xs leading-5" style={{color:'var(--muted)'}}>
     Deposited funds are separate. Available and pending balances cannot be confirmed until Gateway is connected.
    </p>
   </section>
  </div>
  <section aria-label="Money actions">
   <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
    {actions.map((item,i)=><button key={item.route} type="button"
      onClick={()=>onNavigate(MAINNET_ROUTES[item.route].destination)}
      className="flex min-h-24 flex-col items-start justify-between rounded-xl p-4 text-left transition-transform hover:-translate-y-0.5"
      style={i===0?{background:'var(--accent)',color:'#0d1b2f'}:{...cardStyle,color:'var(--ink)'}}>
      {item.icon}
      <span className="mt-4 text-sm font-bold">{item.label}</span>
    </button>)}
   </div>
   <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs" style={{color:'var(--muted)'}}>
    <span>Pay & Settlement: wallet-confirmed</span>
    <span>Swap & Bridge: live provider quote required</span>
   </div>
  </section>
  {wrong&&<p role="status" className="rounded-xl px-4 py-3 text-sm" style={{background:'var(--surface)',color:'var(--warning)'}}>
   Balance shown is on Arc Mainnet. Switch your wallet to Arc Mainnet before signing; no Testnet fallback is permitted.
  </p>}
  <section className="grid gap-3 lg:grid-cols-[1fr_0.7fr]">
   <div className={card} style={cardStyle}>
    <div className="flex items-center justify-between">
     <h2 className="text-base font-bold" style={{color:'var(--ink)'}}>Needs attention</h2>
     <button type="button" onClick={()=>onNavigate('activity')}
      className="text-xs font-semibold" style={{color:'var(--accent)'}}>View Activity</button>
    </div>
    {pending.length===0?
     <p className="mt-3 text-sm" style={{color:'var(--muted)'}}>
      No locally recorded pending operations. Provider-side transactions may still need checking.
     </p>:
     <div className="mt-3 space-y-2">{pending.slice(0,3).map(x=><div key={x.hash} className="flex items-center gap-2 rounded-lg p-3"
      style={{background:'var(--surface-raised)'}}>
      <Clock3 className="size-4 shrink-0" style={{color:'var(--warning)'}}/>
      <span className="min-w-0 flex-1 truncate text-sm" style={{color:'var(--ink)'}}>{x.type} · {x.amount} {x.asset}</span>
      <button type="button" onClick={()=>onNavigate(x.type==='Bridge'?'bridge':x.type==='Swap'?'convert':x.type==='Settlement'?'settlement':'activity')}
       className="text-xs font-semibold" style={{color:'var(--accent)'}}>Continue</button>
     </div>)}</div>}
   </div>
   <div className={card} style={cardStyle}>
    <p className="text-base font-bold" style={{color:'var(--ink)'}}>Your account</p>
    <p className="mt-3 text-sm font-semibold" style={{color:'var(--ink)'}}>{address?address.slice(0,7)+'…'+address.slice(-5):'Connect wallet'}</p>
    <p className="mt-2 text-xs leading-5" style={{color:'var(--muted)'}}>
     Veyra ID and X linking require a verified service session; connecting a wallet alone does not sign in.
    </p>
    <button onClick={()=>onNavigate('settings')} className="mt-3 text-xs font-semibold"
     style={{color:'var(--accent)'}}>Identity & settings</button>
   </div>
  </section>
  <section className={card} style={cardStyle} aria-label="Recent activity">
   <div className="flex items-center justify-between gap-3">
    <h2 className="text-base font-bold" style={{color:'var(--ink)'}}>Recent activity</h2>
    <button onClick={()=>onNavigate('activity')} className="text-xs font-semibold" style={{color:'var(--accent)'}}>View all</button>
   </div>
   {operations.length===0?
    <p className="mt-3 text-sm" style={{color:'var(--muted)'}}>No operations recorded in this browser yet. Activity can look up your onchain transaction hashes.</p>:
    <div className="mt-3 divide-y" style={{borderColor:'var(--border)'}}>
     {operations.slice(0,3).map(x=><div className="flex items-center gap-3 py-3" key={x.type+x.hash}>
      <div className="min-w-0 flex-1"><p className="text-sm font-semibold" style={{color:'var(--ink)'}}>
       {x.type} · {x.amount} {x.asset}</p>
       <p className="mt-1 text-xs" style={{color:'var(--muted)'}}>
        {x.status==='SUBMITTED'?'Needs receipt check':'Locally recorded · reverify onchain'}</p></div>
      <a href={explorer(x.hash,x.chainId)} target="_blank" rel="noreferrer"
       className="text-xs font-semibold" style={{color:'var(--accent)'}}>Explorer</a>
     </div>)}
    </div>}
  </section>
  <section className="rounded-xl" aria-label="Receive wallet USDC">
   <button type="button" onClick={()=>setReceive(v=>!v)}
    className="flex w-full items-center justify-between rounded-xl border p-4 text-sm font-semibold"
    style={{borderColor:'var(--border)',color:'var(--ink)',background:'var(--surface)'}}>
    <span className="flex items-center gap-2"><ArrowDownLeft className="size-4"/> Receive USDC</span>
    <span className="text-xs" style={{color:'var(--muted)'}}>{receive?'Close':'Show wallet address'}</span>
   </button>
   {receive&&<div className="mt-2 rounded-xl border p-4" style={cardStyle}>
    <p className="text-xs" style={{color:'var(--muted)'}}>Use only Arc Mainnet USDC for this displayed wallet route.</p>
    <p className="my-3 break-all font-mono text-sm" style={{color:'var(--ink)'}}>{address??'Connect wallet to receive'}</p>
    <button disabled={!address} onClick={()=>void copy()} className="flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-semibold disabled:opacity-40"
      style={{borderColor:'var(--border)',color:'var(--ink)'}}><Copy className="size-4"/>{copied?'Copied':'Copy address'}</button>
    {copyError&&<p role="alert" className="mt-2 text-xs" style={{color:'var(--warning)'}}>Clipboard unavailable. Copy the address manually.</p>}
   </div>}
  </section>
 </div>;
}
