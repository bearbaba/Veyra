/** Automatic wallet-scoped Mainnet Activity. Transactions are captured by each Veyra flow.
 * Onchain evidence is re-read rather than trusting browser-local status.
 */
import {useEffect,useRef,useState} from 'react';
import {useAccount} from 'wagmi';
import {ConnectKitButton} from 'connectkit';
import {CheckCircle2,Clock3,ExternalLink,RefreshCw} from 'lucide-react';
import {readMainnetJournal,storageForMainnet} from '@/mainnet/arcMainnetJournal';
import {readLocalOperations,recordLocalOperation,type LocalOperation} from '@/mainnet/localOperations';
import {inspectRecordedOperation,type OperationInspection} from '@/mainnet/inspectRecordedOperation';
import {readSettlementIntent,writeSettlementIntent} from '@/mainnet/settlementJournal';
import type {VeyraPage} from '../layout/AppShell';

const id=(v:LocalOperation)=>v.type+':'+v.chainId+':'+v.hash.toLowerCase();
const explorer=(v:LocalOperation)=>(v.chainId===8453?'https://basescan.org/tx/':'https://explorer.arc.io/tx/')+v.hash;
function label(x:OperationInspection|undefined){
 if(!x)return 'Checking onchain…';
 return ({VERIFIED:'Verified onchain',REVERTED:'Reverted',PENDING:'Processing',
  UNKNOWN:'Check unavailable',UNVERIFIED:'Not verified',PROVIDER:'Provider tracking'} as const)[x.status];
}
function color(x:OperationInspection|undefined){
 return x?.status==='VERIFIED'?'var(--success)':
  x?.status==='REVERTED'||x?.status==='UNVERIFIED'?'var(--warning)':'var(--muted)';
}
export function MainnetActivityPage({onPay,onNavigate}:{onPay:()=>void;onNavigate:(page:VeyraPage)=>void}){
 const {address}=useAccount();
 const [entries,setEntries]=useState<LocalOperation[]>([]);
 const [states,setStates]=useState<Record<string,OperationInspection>>({});
 const [syncing,setSyncing]=useState(false);
 const [unknownSettlement,setUnknownSettlement]=useState(false);
 const [filter,setFilter]=useState<'All'|'Pay'|'Settlement'|'Swap'|'Bridge'>('All');
 const verifiedCache=useRef(new Map<string,{checked:number;state:OperationInspection}>());
 useEffect(()=>{
  let active=true,working=false;
  verifiedCache.current.clear();setEntries([]);setStates({});setUnknownSettlement(false);
  if(!address)return;
  const owner=address;
  async function update(){
   if(!active||working)return;
   working=true;setSyncing(true);
   try{
    const journal=readMainnetJournal(owner,storageForMainnet());
    if(journal.kind==='active'&&journal.value.hash){
     const p=journal.value;
     if(!readLocalOperations(owner).some(v=>v.type==='Pay'&&v.hash.toLowerCase()===p.hash?.toLowerCase()))
      recordLocalOperation({owner,hash:p.hash!,type:'Pay',amount:p.amount,asset:'USDC',
       chainId:5042,destination:p.to,status:'SUBMITTED'});
    }
    const contract=readSettlementIntent(owner);
    if(contract.kind==='active'&&contract.value.phase==='PAYMENT'&&contract.value.hash){
      const tx=contract.value;
      if(!readLocalOperations(owner).some(v=>v.type==='Settlement'&&v.hash.toLowerCase()===tx.hash?.toLowerCase()))
        recordLocalOperation({owner,hash:tx.hash,type:'Settlement',amount:tx.amount,
          asset:'USDC',chainId:5042,destination:tx.recipient,status:'SUBMITTED'});
    }
    if(active)setUnknownSettlement(contract.kind==='blocked'||contract.kind==='active'&&
      !contract.value.hash&&['AWAITING_WALLET','UNKNOWN'].includes(contract.value.stage));
    const list=readLocalOperations(owner);
    if(!active)return;
    setEntries(list);
    for(let i=0;i<list.length&&active;i+=3){
     const batch=list.slice(i,i+3);
     const outcome=await Promise.all(batch.map(async v=>{
      const k=id(v),cached=verifiedCache.current.get(k);
      const age=Date.now()-(cached?.checked??0);
      if(cached&&age<(cached.state.status==='VERIFIED'||cached.state.status==='REVERTED'?120000:18000))
       return [v,cached.state] as const;
      let state:OperationInspection;
      try{state=await inspectRecordedOperation(v,owner);}
      catch(e){state={status:'UNKNOWN',detail:e instanceof Error?e.message:'RPC or provider unavailable.'};}
      verifiedCache.current.set(k,{checked:Date.now(),state});
      return [v,state] as const;
     }));
     if(!active)return;
     setStates(prev=>{
      const next={...prev};
      outcome.forEach(([v,status])=>next[id(v)]=status);
      return next;
     });
     for(const [v,state] of outcome){
      if((v.type==='Pay'||v.type==='Settlement')&&(state.status==='VERIFIED'||state.status==='REVERTED')){
       const target=state.status==='VERIFIED'?'RECORDED':'REVERTED';
       if(v.status!==target)recordLocalOperation({...v,status:target});
       if(v.type==='Settlement'){
        const latest=readSettlementIntent(owner);
        if(latest.kind==='active'&&latest.value.phase==='PAYMENT'&&
         latest.value.hash?.toLowerCase()===v.hash.toLowerCase()&&latest.value.stage!==state.status){
         writeSettlementIntent({...latest.value,stage:state.status});
        }
       }
      }
     }
    }
    if(active)setEntries(readLocalOperations(owner));
   }finally{working=false;if(active)setSyncing(false);}
  }
  void update();
  const timer=window.setInterval(()=>void update(),20000);
  const onChange=()=>void update();
  window.addEventListener('focus',onChange);
  window.addEventListener('veyra:mainnet:operation',onChange);
  return()=>{active=false;window.clearInterval(timer);
   window.removeEventListener('focus',onChange);
   window.removeEventListener('veyra:mainnet:operation',onChange);};
 },[address]);
 const shown=entries.filter(v=>filter==='All'||v.type===filter);
 return <div className="mx-auto w-full max-w-5xl space-y-5 px-4 py-7 md:px-7 md:py-9">
  <header className="flex flex-wrap items-center justify-between gap-3">
   <div>
    <span className="text-xs font-bold uppercase" style={{color:'var(--accent)'}}>Arc Mainnet · 5042</span>
    <h1 className="display mt-2 text-3xl font-bold" style={{color:'var(--ink)'}}>Activity</h1>
    <p className="mt-2 text-sm" style={{color:'var(--muted)'}}>
     Transactions made in Veyra appear automatically. Receipts are checked onchain; no hash entry or wallet signature is needed.
    </p>
   </div>
   {address&&<span className="flex items-center gap-2 text-xs" style={{color:'var(--muted)'}}>
    {syncing&&<RefreshCw className="size-4 animate-spin"/>}{syncing?'Checking receipts…':'Auto-sync on'}
   </span>}
  </header>
  {address&&unknownSettlement&&<div role="alert" className="rounded-xl border p-4 text-sm"
     style={{borderColor:'var(--border)',color:'var(--warning)'}}>
     A previous contract wallet request has no returned transaction hash. Its outcome is unknown.
     Veyra will not resubmit the payment automatically. Check the original request in your wallet.
  </div>}
  {!address?<section className="rounded-2xl border p-6" style={{background:'var(--surface)',borderColor:'var(--border)'}}>
   <p className="mb-3 text-sm" style={{color:'var(--muted)'}}>Connect your wallet to see its Veyra history.</p>
   <ConnectKitButton/>
  </section>:<>
   <div className="flex flex-wrap items-center justify-between gap-3">
    <div className="flex flex-wrap gap-2" aria-label="Filter transactions">
     {(['All','Pay','Settlement','Swap','Bridge'] as const).map(v=><button type="button" key={v}
      aria-pressed={filter===v} onClick={()=>setFilter(v)} className="rounded-lg border px-3 py-2 text-xs font-semibold"
      style={{borderColor:'var(--border)',background:filter===v?'var(--accent-muted)':'var(--surface)',
       color:filter===v?'var(--accent)':'var(--muted)'}}>{v}</button>)}
    </div>
    <button type="button" onClick={onPay} className="rounded-xl px-4 py-2 text-xs font-bold"
     style={{background:'var(--accent)',color:'#0d1b2f'}}>New payment</button>
   </div>
   {shown.length===0?<section className="rounded-2xl border p-7 text-center" style={{borderColor:'var(--border)',background:'var(--surface)'}}>
     <Clock3 className="mx-auto mb-3 size-6" style={{color:'var(--muted)'}}/>
     <p className="font-semibold" style={{color:'var(--ink)'}}>No {filter==='All'?'transactions':filter+' transactions'} recorded yet</p>
     <p className="mt-2 text-sm" style={{color:'var(--muted)'}}>Veyra saves the original transaction automatically when your wallet returns its hash.</p>
    </section>:
    <section className="overflow-hidden rounded-2xl border" style={{borderColor:'var(--border)',background:'var(--surface)'}}>
     {shown.map(v=>{
      const proof=states[id(v)],ink=color(proof);
      return <article key={id(v)} className="border-b p-4 sm:p-5 last:border-0" style={{borderColor:'var(--border)'}}>
       <div className="flex flex-wrap items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-xl" style={{background:'var(--surface-raised)'}}>
         {proof?.status==='VERIFIED'?<CheckCircle2 className="size-5" style={{color:ink}}/>:<Clock3 className="size-5" style={{color:ink}}/>}
        </div>
        <div className="min-w-0 flex-1 space-y-1">
         <p className="font-semibold" style={{color:'var(--ink)'}}>{v.type} · {v.amount} {v.asset}</p>
         <p className="text-xs" style={{color:ink}}>{label(proof)}</p>
         {v.destination&&<p className="break-all text-xs" style={{color:'var(--muted)'}}>Recipient: {v.destination}</p>}
         <p className="text-xs" style={{color:'var(--muted)'}}>
          {v.chainId===8453?'Base':'Arc'} Mainnet · {new Date(v.updatedAt).toLocaleString()}</p>
        </div>
        <a href={explorer(v)} rel="noreferrer" target="_blank" className="inline-flex items-center gap-1 text-xs font-semibold"
         style={{color:'var(--accent)'}}>Explorer <ExternalLink className="size-3.5"/></a>
       </div>
       {proof&&<p className="ml-12 mt-3 break-words text-xs leading-5" style={{color:'var(--muted)'}}>{proof.detail}</p>}
       {(v.type==='Swap'||v.type==='Bridge')&&<button type="button" onClick={()=>onNavigate(v.type==='Swap'?'convert':'bridge')}
        className="ml-12 mt-3 text-xs font-semibold" style={{color:'var(--accent)'}}>Open {v.type} tracking</button>}
      </article>;
     })}
    </section>}
   <p className="text-xs leading-5" style={{color:'var(--muted)'}}>
    Only Veyra-origin transactions recorded in this browser are listed. This is not yet a full cross-device indexer.
    Direct Pay and Settlement are checked against Arc receipts. Circle operations retain their provider-specific tracking;
    a saved browser record is never proof of success.
   </p>
  </>}
 </div>;
}
