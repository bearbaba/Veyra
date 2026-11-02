/** Mainnet-first Veyra Home: money, actions, attention, activity — in that order. */
import {useEffect,useState} from 'react';
import {useAccount,useReadContract} from 'wagmi';
import {ConnectKitButton} from 'connectkit';
import {erc20Abi,formatUnits} from 'viem';
import {ArrowUpRight,ArrowDownLeft,Copy,RefreshCw,Users,Clock3,Wallet,LayoutList} from 'lucide-react';
import {getUsdc} from '@/onchain-facts';
import {readLocalOperations,type LocalOperation} from '@/mainnet/localOperations';
import {useUnifiedSocial} from '@/features/social/UnifiedSocial';
import {listVerifiedMainnetPayReceipts,type MainnetPayServerReceipt} from '@/lib/api/mainnetPayReceipts';
import type {VeyraPage} from '../layout/AppShell';

const ARC=5042;
const explorer=(hash:string,chain:number)=>chain===8453?'https://basescan.org/tx/'+hash:'https://explorer.arc.io/tx/'+hash;
export function MainnetHomePage({onNavigate}:{onNavigate:(page:VeyraPage)=>void}){
 const {address,isConnected,chainId}=useAccount();
 const social=useUnifiedSocial();
 const [accountReceipts,setAccountReceipts]=useState<MainnetPayServerReceipt[]>([]);
 const [receive,setReceive]=useState(false);
 const [copied,setCopied]=useState(false);
 const [copyError,setCopyError]=useState(false);
 const [operations,setOperations]=useState<LocalOperation[]>([]);
 const usdc=getUsdc(ARC);
 const {data,refetch,isError,isFetching}=useReadContract({
  address:usdc?.address as `0x${string}` | undefined,abi:erc20Abi,functionName:'balanceOf',
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
 useEffect(()=>{
  setAccountReceipts([]);
  const token=social.session?.token;
  if(!address||!token||social.identityOrigin!=='ready')return;
  const controller=new AbortController();
  let active=true;
  async function reload(){
   try{
    const items=await listVerifiedMainnetPayReceipts(token!,controller.signal);
    if(active)setAccountReceipts(items.slice(0,10));
   }catch{/* Offline identity history falls back to local transactions without fake receipts. */}
  }
  void reload();
  const handle=()=>void reload();
  window.addEventListener('focus',handle);
  window.addEventListener('veyra:mainnet:server-receipt',handle);
  return()=>{active=false;controller.abort();
   window.removeEventListener('focus',handle);
   window.removeEventListener('veyra:mainnet:server-receipt',handle);};
 },[address,social.session?.token,social.identityOrigin]);
 const recentVerified=accountReceipts.slice(0,3);
 const knownHashes=new Set(accountReceipts.map(x=>x.txHash.toLowerCase()));
 const localRecent=operations.filter(x=>!(x.type==='Pay'&&knownHashes.has(x.hash.toLowerCase())));
 const wrong=isConnected&&chainId!==ARC;
 const available=!address?'—':isError?'Unavailable':data!==undefined?formatUnits(data,6):'Reading…';
 const pending=operations.filter(x=>x.status==='SUBMITTED');
 const actions:{id:'send'|'receive'|'people'|'activity';label:string;icon:React.ReactNode}[]=[
  {id:'send',label:'Send',icon:<ArrowUpRight className="size-5"/>},
  {id:'receive',label:'Receive',icon:<ArrowDownLeft className="size-5"/>},
  {id:'people',label:'People',icon:<Users className="size-5"/>},
  {id:'activity',label:'Activity',icon:<LayoutList className="size-5"/>},
 ];
 function selectAction(id:(typeof actions)[number]['id']){
  if(id==='receive')setReceive(v=>!v);
  else onNavigate(id==='send'?'pay':id==='people'?'social':'activity');
 }
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
    {actions.map((item,i)=><button key={item.id} type="button"
      onClick={()=>selectAction(item.id)}
      className="flex min-h-24 flex-col items-start justify-between rounded-xl p-4 text-left transition-transform hover:-translate-y-0.5"
      style={i===0?{background:'var(--accent)',color:'#0d1b2f'}:{...cardStyle,color:'var(--ink)'}}>
      {item.icon}
      <span className="mt-4 text-sm font-bold">{item.label}</span>
    </button>)}
   </div>
   <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs" style={{color:'var(--muted)'}}>
    <span>Send: review and confirm in your wallet</span>
    <span>Exchange is under More · choose assets and Veyra checks Swap or Bridge routes</span>
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
  <section className="grid gap-3 lg:grid-cols-[1fr_0.7fr]">
   {pending.length>0&&<div className={card} style={cardStyle}>
    <div className="flex items-center justify-between">
     <h2 className="text-base font-bold" style={{color:'var(--ink)'}}>Needs attention</h2>
     <button type="button" onClick={()=>onNavigate('activity')}
      className="text-xs font-semibold" style={{color:'var(--accent)'}}>View Activity</button>
    </div>
    <div className="mt-3 space-y-2">{pending.slice(0,3).map(x=><div key={x.hash} className="flex items-center gap-2 rounded-lg p-3"
      style={{background:'var(--surface-raised)'}}>
      <Clock3 className="size-4 shrink-0" style={{color:'var(--warning)'}}/>
      <span className="min-w-0 flex-1 truncate text-sm" style={{color:'var(--ink)'}}>{x.type} · {x.amount} {x.asset}</span>
      <button type="button" onClick={()=>onNavigate(x.type==='Bridge'?'bridge':x.type==='Swap'?'convert':x.type==='Settlement'?'settlement':'activity')}
       className="text-xs font-semibold" style={{color:'var(--accent)'}}>Continue</button>
     </div>)}</div>
   </div>}
   <div className={card} style={cardStyle}>
    <p className="text-base font-bold" style={{color:'var(--ink)'}}>Your people</p>
    {social.session&&social.identityOrigin==='ready'?<>
     <p className="mt-3 text-base font-semibold" style={{color:'var(--ink)'}}>
      {'@'+social.session.profile.veyraHandle+'.veyra'}
     </p>
     <p className="mt-1 text-sm" style={{color:'var(--muted)'}}>
      {social.friends.filter(x=>x.state==='CONNECTED').length} connected friends · signed-in Veyra ID
     </p>
    </>:<>
     <p className="mt-3 text-sm font-semibold" style={{color:'var(--ink)'}}>
      {address?address.slice(0,7)+'…'+address.slice(-5):'Connect wallet'}
     </p>
     <p className="mt-2 text-xs leading-5" style={{color:'var(--muted)'}}>
      Connect a verified Veyra ID when the Mainnet identity backend is available. Local contacts are not verified friends.
     </p>
    </>}
    <button onClick={()=>onNavigate('social')} className="mt-3 text-xs font-semibold"
     style={{color:'var(--accent)'}}>People & Veyra ID</button>
   </div>
  </section>
  <section className={card} style={cardStyle} aria-label="Recent activity">
   <div className="flex items-center justify-between gap-3">
    <h2 className="text-base font-bold" style={{color:'var(--ink)'}}>Recent activity</h2>
    <button onClick={()=>onNavigate('activity')} className="text-xs font-semibold" style={{color:'var(--accent)'}}>View all</button>
   </div>
   {recentVerified.length===0&&localRecent.length===0?
    <p className="mt-3 text-sm" style={{color:'var(--muted)'}}>No transactions yet. Your verified payments will appear here when account history is available.</p>:
    <div className="mt-3 divide-y" style={{borderColor:'var(--border)'}}>
     {recentVerified.map(x=><div className="flex items-center gap-3 py-3" key={'remote:'+x.txHash}>
      <div className="min-w-0 flex-1">
       <p className="text-sm font-semibold" style={{color:'var(--ink)'}}>
        {x.direction==='sent'?'Sent':'Received'} · {formatUnits(BigInt(x.amountRaw),6)} USDC
       </p>
       <p className="mt-1 text-xs" style={{color:'var(--success)'}}>
        Verified · {x.recipientLabel??'Arc Mainnet'} · {new Date(x.paidAt).toLocaleDateString()}
       </p>
      </div>
      <button type="button" onClick={()=>onNavigate('activity')} className="text-xs font-semibold"
       style={{color:'var(--accent)'}}>Receipt</button>
     </div>)}
     {localRecent.slice(0,Math.max(0,3-recentVerified.length)).map(x=><div className="flex items-center gap-3 py-3" key={x.type+x.hash}>
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
