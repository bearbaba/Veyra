/** Automatic wallet-scoped Mainnet Activity. Transactions are captured by each Veyra flow.
 * Onchain evidence is re-read rather than trusting browser-local status.
 */
import {useEffect,useRef,useState} from 'react';
import {useAccount} from 'wagmi';
import {formatUnits} from 'viem';
import {useUnifiedSocial} from '@/features/social/UnifiedSocial';
import {listVerifiedMainnetPayReceipts,type MainnetPayServerReceipt} from '@/lib/api/mainnetPayReceipts';
import {readReceiptOutbox,storageForReceiptOutbox,type ReceiptOutboxItem} from '@/mainnet/receiptOutbox';
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
 return ({VERIFIED:'Completed · verified',REVERTED:'Reverted · not delivered',PENDING:'Sent · processing',
  UNKNOWN:'Status unknown · checking',UNVERIFIED:'Needs verification',PROVIDER:'Not verified in Activity · open tracking'} as const)[x.status];
}
function color(x:OperationInspection|undefined){
 return x?.status==='VERIFIED'?'var(--success)':
  x?.status==='REVERTED'||x?.status==='UNVERIFIED'?'var(--warning)':'var(--muted)';
}
export function MainnetActivityPage({onPay,onNavigate}:{onPay:()=>void;onNavigate:(page:VeyraPage)=>void}){
 const {address}=useAccount();
 const social=useUnifiedSocial();
 const [serverReceipts,setServerReceipts]=useState<MainnetPayServerReceipt[]>([]);
 const [serverReceiptScope,setServerReceiptScope]=useState('');
 const [serverHistoryStatus,setServerHistoryStatus]=useState<'unavailable'|'checking'|'ready'>('unavailable');
 const [entries,setEntries]=useState<LocalOperation[]>([]);
 const [localOwner,setLocalOwner]=useState('');
 const [states,setStates]=useState<Record<string,OperationInspection>>({});
 const [syncing,setSyncing]=useState(false);
 const [unknownSettlement,setUnknownSettlement]=useState(false);
 const [filter,setFilter]=useState<'All'|'Send'|'Swap'|'Bridge'>('All');
 const verifiedCache=useRef(new Map<string,{checked:number;state:OperationInspection}>());
 const [queuedReceipts,setQueuedReceipts]=useState<ReceiptOutboxItem[]>([]);
 const [queuedOwner,setQueuedOwner]=useState('');
 const [outboxBlocked,setOutboxBlocked]=useState(false);
 useEffect(()=>{
  let active=true,working=false;
  verifiedCache.current.clear();setLocalOwner('');setEntries([]);setStates({});setUnknownSettlement(false);
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
       chainId:5042,destination:p.to,status:'SUBMITTED',note:p.note,recipientLabel:p.recipientLabel,
       recipientSnapshotId:p.recipientSnapshotId});
    }
    const contract=readSettlementIntent(owner);
    if(contract.kind==='active'&&contract.value.phase==='PAYMENT'&&contract.value.hash){
      const tx=contract.value;
      if(!readLocalOperations(owner).some(v=>v.type==='Settlement'&&v.hash.toLowerCase()===tx.hash?.toLowerCase()))
        recordLocalOperation({owner,hash:tx.hash!,type:'Settlement',amount:tx.amount,
          asset:'USDC',chainId:5042,destination:tx.recipient,status:'SUBMITTED'});
    }
    if(active)setUnknownSettlement(contract.kind==='blocked'||contract.kind==='active'&&
      !contract.value.hash&&['AWAITING_WALLET','UNKNOWN'].includes(contract.value.stage));
    const list=readLocalOperations(owner);
    if(!active)return;
    setEntries(list);setLocalOwner(owner.toLowerCase());
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
 useEffect(()=>{
  setServerReceipts([]);setServerReceiptScope('');setServerHistoryStatus('unavailable');
  const token=social.session?.token;
  if(!address||!token||social.identityOrigin!=='ready')return;
  const controller=new AbortController();
  let active=true,fetching=false;
  async function reload(){
   if(!active||fetching)return;
   fetching=true;
   setServerHistoryStatus(previous=>previous==='ready'?'ready':'checking');
   try{
    const records=await listVerifiedMainnetPayReceipts(token!,controller.signal);
    if(active){setServerReceipts(records);setServerReceiptScope(address!.toLowerCase()+':'+token);setServerHistoryStatus('ready');}
   }catch{if(active)setServerHistoryStatus('unavailable');}
   finally{fetching=false;}
  }
  void reload();
  // Receiver B gets a newly indexed original receipt without manually reloading.
  const timer=window.setInterval(()=>void reload(),20000);
  const onChange=()=>void reload();
  window.addEventListener('focus',onChange);
  window.addEventListener('veyra:mainnet:server-receipt',onChange);
  return()=>{active=false;window.clearInterval(timer);controller.abort();window.removeEventListener('focus',onChange);
   window.removeEventListener('veyra:mainnet:server-receipt',onChange);};
 },[address,social.session?.token,social.identityOrigin]);
 // Read-only outbox view. The app-scoped worker exclusively performs idempotent uploads.
 useEffect(()=>{
  setQueuedOwner('');setQueuedReceipts([]);setOutboxBlocked(false);
  if(!address)return;
  let active=true;
  const owner=address;
  const refresh=()=>{
   const queue=readReceiptOutbox(owner,storageForReceiptOutbox());
   if(!active)return;
   setQueuedReceipts(queue.kind==='ready'?queue.items:[]);setQueuedOwner(owner.toLowerCase());
   setOutboxBlocked(queue.kind==='blocked');
  };
  refresh();
  const interval=window.setInterval(refresh,15000);
  window.addEventListener('veyra:mainnet:outbox',refresh);
  window.addEventListener('veyra:mainnet:server-receipt',refresh);
  window.addEventListener('focus',refresh);
  const storageChange=(event:StorageEvent)=>{
   if(event.key?.startsWith('veyra:arc-mainnet-5042-receipt-outbox:v1:'+owner.toLowerCase()+':'))refresh();
  };
  window.addEventListener('storage',storageChange);
  return()=>{active=false;window.clearInterval(interval);
   window.removeEventListener('veyra:mainnet:outbox',refresh);
   window.removeEventListener('veyra:mainnet:server-receipt',refresh);
   window.removeEventListener('focus',refresh);window.removeEventListener('storage',storageChange);};
 },[address]);
 const scopedReceipts=address&&social.session?.token&&
   serverReceiptScope===address.toLowerCase()+':'+social.session.token?serverReceipts:[];
 const scopedEntries=address&&localOwner===address.toLowerCase()?entries:[];
 const scopedStates=address&&localOwner===address.toLowerCase()?states:{};
 const scopedQueue=address&&queuedOwner===address.toLowerCase()?queuedReceipts:[];
 const scopedOutboxBlocked=address&&queuedOwner===address.toLowerCase()?outboxBlocked:false;
 const verifiedRemote=filter==='All'||filter==='Send'?scopedReceipts:[];
 const remoteHashes=new Set(scopedReceipts.map(r=>r.txHash.toLowerCase()));
 // Server-verified payment appears ONCE, even when there is a browser journal pointer.
 const shown=scopedEntries.filter(v=>!((v.type==='Pay')&&remoteHashes.has(v.hash.toLowerCase()))&&
   (filter==='All'||(filter==='Send'?(v.type==='Pay'||v.type==='Settlement'):v.type===filter)));
 return <div className="mx-auto w-full max-w-5xl space-y-5 px-4 py-7 md:px-7 md:py-9">
  <header className="flex flex-wrap items-center justify-between gap-3">
   <div>
    <span className="text-xs font-bold uppercase" style={{color:'var(--accent)'}}>Arc Mainnet · 5042</span>
    <h1 className="display mt-2 text-3xl font-bold" style={{color:'var(--ink)'}}>Activity</h1>
    <p className="mt-2 text-sm" style={{color:'var(--muted)'}}>
     Veyra records original transactions. Wallet Pay receipts are checked onchain; Swap and Bridge still require their route tracking.
    </p>
   </div>
   {address&&<span className="flex items-center gap-2 text-xs" style={{color:'var(--muted)'}}>
    {syncing&&<RefreshCw className="size-4 animate-spin"/>}{syncing?'Checking wallet receipts…':'Wallet payments auto-checked'}
   </span>}
  </header>
  {address&&localOwner===address.toLowerCase()&&unknownSettlement&&<div role="alert" className="rounded-xl border p-4 text-sm"
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
     {(['All','Send','Swap','Bridge'] as const).map(v=><button type="button" key={v}
      aria-pressed={filter===v} onClick={()=>setFilter(v)} className="rounded-lg border px-3 py-2 text-xs font-semibold"
      style={{borderColor:'var(--border)',background:filter===v?'var(--accent-muted)':'var(--surface)',
       color:filter===v?'var(--accent)':'var(--muted)'}}>{v}</button>)}
    </div>
    <button type="button" onClick={onPay} className="rounded-xl px-4 py-2 text-xs font-bold"
     style={{background:'var(--accent)',color:'#0d1b2f'}}>New payment</button>
   </div>
   {(social.session||scopedQueue.length>0||scopedOutboxBlocked)&&
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs" style={{color:'var(--muted)'}}>
     <span>{scopedOutboxBlocked?'Local receipt recovery storage needs attention. Do not retry the original payment.':
      scopedQueue.some(x=>x.status==='review')?'Some verified transfers need receipt review; no new transfer required.':
      scopedQueue.length&&!social.session?.token?'Money sent · sign in to save the receipt to your account.':
      scopedQueue.length?'Money sent · syncing '+scopedQueue.length+' receipt(s).':
      'Veyra account history: '+(serverHistoryStatus==='ready'?'server verified':
       serverHistoryStatus==='checking'?'loading':'offline; local history stays visible')}</span>
     {scopedQueue.length>0&&<button type="button" onClick={onPay}
      className="font-semibold" style={{color:'var(--accent)'}}>View payment receipt</button>}
    </div>}
   {verifiedRemote.length>0&&<section aria-label="Verified Veyra account receipts"
      className="overflow-hidden rounded-2xl border" style={{borderColor:'var(--border)',background:'var(--surface)'}}>
    {verifiedRemote.map(v=><article key={v.txHash} className="border-b p-4 last:border-0" style={{borderColor:'var(--border)'}}>
      <p className="text-sm font-semibold" style={{color:'var(--ink)'}}>
       {v.direction==='sent'?'Sent':'Received'} · {formatUnits(BigInt(v.amountRaw),6)} USDC
      </p>
      <p className="mt-1 text-sm" style={{color:'var(--success)'}}>Completed · independently verified by Veyra backend</p>
      <p className="text-sm" style={{color:'var(--ink)'}}>
       {v.direction==='sent'?'To '+(v.recipientLabel??v.recipientAddress):
        'From wallet '+v.senderAddress.slice(0,8)+'…'+v.senderAddress.slice(-6)}
      </p>
      <details className="text-xs" style={{color:'var(--muted)'}}><summary className="cursor-pointer">Counterparty wallet</summary>
       <p className="mt-2 break-all">{v.direction==='sent'?v.recipientAddress:v.senderAddress}</p>
      </details>
      {v.direction==='sent'&&v.privateNote&&
       <p className="mt-2 text-sm" style={{color:'var(--muted)'}}>Your private note: {v.privateNote}</p>}
      <p className="mt-2 text-xs" style={{color:'var(--muted)'}}>
       Paid {new Date(v.paidAt).toLocaleString()} · Arc Mainnet
      </p>
      <details className="mt-3 text-xs" style={{color:'var(--muted)'}}>
       <summary className="cursor-pointer">Receipt details</summary>
       <p className="mt-2">Verified by Veyra: {new Date(v.verifiedAt).toLocaleString()}</p>
       <p className="mt-1">Block {v.blockNumber} · network fee {v.feeWei} wei</p>
       <a href={'https://explorer.arc.io/tx/'+v.txHash} target="_blank" rel="noreferrer"
        className="mt-2 inline-flex items-center gap-1" style={{color:'var(--accent)'}}>
        Original transaction <ExternalLink className="size-3.5"/>
       </a>
      </details>
     </article>)}
   </section>}
   {shown.length===0&&verifiedRemote.length===0?<section className="rounded-2xl border p-7 text-center" style={{borderColor:'var(--border)',background:'var(--surface)'}}>
     <Clock3 className="mx-auto mb-3 size-6" style={{color:'var(--muted)'}}/>
     <p className="font-semibold" style={{color:'var(--ink)'}}>No {filter==='All'?'transactions':filter+' transactions'} recorded yet</p>
     <p className="mt-2 text-sm" style={{color:'var(--muted)'}}>Veyra saves the original transaction automatically when your wallet returns its hash.</p>
    </section>:
    <section className="overflow-hidden rounded-2xl border" style={{borderColor:'var(--border)',background:'var(--surface)'}}>
     {shown.map(v=>{
      const proof=scopedStates[id(v)],ink=color(proof);
      const queued=scopedQueue.find(x=>x.hash.toLowerCase()===v.hash.toLowerCase());
      return <article key={id(v)} className="border-b p-4 sm:p-5 last:border-0" style={{borderColor:'var(--border)'}}>
       <div className="flex flex-wrap items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-xl" style={{background:'var(--surface-raised)'}}>
         {proof?.status==='VERIFIED'?<CheckCircle2 className="size-5" style={{color:ink}}/>:<Clock3 className="size-5" style={{color:ink}}/>}
        </div>
        <div className="min-w-0 flex-1 space-y-1">
         <p className="font-semibold" style={{color:'var(--ink)'}}>{v.type==='Pay'||v.type==='Settlement'?'Send':v.type} · {v.amount} {v.asset}</p>
         <p className="text-xs" style={{color:ink}}>{v.type==='Pay'&&proof?.status==='VERIFIED'?
          !social.session?.token||social.identityOrigin!=='ready'?
           'Money sent · sign in to save receipt to your account':
          queued?.status==='sign-in'?'Money sent · sign in again to sync receipt':
          queued?.status==='review'?'Money sent · receipt needs review (do not resend)':
          queued?'Money sent · syncing receipt':'Money sent · open receipt history for account sync':label(proof)}</p>
         {v.recipientLabel&&<p className="text-sm" style={{color:'var(--ink)'}}>{v.recipientLabel} · label saved at review (this browser only)</p>}
         {v.destination&&<p className="break-all text-xs" style={{color:'var(--muted)'}}>Recipient wallet: {v.destination}</p>}
         {v.note&&<p className="text-sm" style={{color:'var(--muted)'}}>Your note: {v.note}</p>}
         <p className="text-xs" style={{color:'var(--muted)'}}>
          {v.chainId===8453?'Base':'Arc'} Mainnet · saved {new Date(v.submittedAt??v.updatedAt).toLocaleString()} · last updated {new Date(v.updatedAt).toLocaleString()}</p>
        </div>
       </div>
       <details className="ml-12 mt-3 text-xs" style={{color:'var(--muted)'}}>
        <summary className="cursor-pointer">Receipt and technical details</summary>
        {proof&&<p className="mt-2 break-words leading-5">{proof.detail}</p>}
        <a href={explorer(v)} rel="noreferrer" target="_blank"
         className="mt-2 inline-flex items-center gap-1 font-semibold" style={{color:'var(--accent)'}}>
         View original transaction <ExternalLink className="size-3.5"/></a>
       </details>
       {(v.type==='Swap'||v.type==='Bridge')&&<button type="button" onClick={()=>onNavigate(v.type==='Swap'?'convert':'bridge')}
        className="ml-12 mt-3 text-xs font-semibold" style={{color:'var(--accent)'}}>Open {v.type} tracking</button>}
      </article>;
     })}
    </section>}
   <p className="text-xs leading-5" style={{color:'var(--muted)'}}>
    Signed-in accounts show backend-verified USDC transfers where available; other transactions remain browser-local. Private notes are sender-only and never shared with recipients.
    Direct Pay and Settlement are checked against Arc receipts. Swap and Bridge still need a shared task proof in Activity;
    a saved browser record is never proof of success.
   </p>
  </>}
 </div>;
}
