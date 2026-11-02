/** Single signing entry. A pending wallet request cannot disappear behind a method switch. */
import {useEffect,useState} from 'react';
import {useAccount} from 'wagmi';
import {ArrowRight,ShieldCheck,Wallet} from 'lucide-react';
import {readMainnetJournal,storageForMainnet} from '@/mainnet/arcMainnetJournal';
import {readSettlementIntent,settlementUnresolved} from '@/mainnet/settlementJournal';
import {MainnetPayPage} from './MainnetPayPage';
import {SettlementPage} from './SettlementPage';

declare const __VEYRA_RELEASE_SHA__:string;
declare const __VEYRA_RELEASE_ENV__:string;
type Method='wallet'|'contract';
export function MainnetPayHub({
 initialMethod='wallet',friendHandle,recipientWallet,onRecipientUsed,
}:{
 initialMethod?:Method;friendHandle?:string|null;recipientWallet?:string|null;onRecipientUsed?:()=>void;
}){
 const {address}=useAccount();
 const [method,setMethod]=useState<Method>(initialMethod);
 const [visited,setVisited]=useState({wallet:initialMethod==='wallet',contract:initialMethod==='contract'});
 const [revision,setRevision]=useState(0);
 useEffect(()=>{
  const sync=()=>setRevision(i=>i+1);
  window.addEventListener('veyra:mainnet:journal',sync);
  window.addEventListener('focus',sync);
  window.addEventListener('storage',sync);
  return()=>{
   window.removeEventListener('veyra:mainnet:journal',sync);
   window.removeEventListener('focus',sync);
   window.removeEventListener('storage',sync);
  };
 },[]);
 void revision;
 const pay=address?readMainnetJournal(address,storageForMainnet()):{kind:'empty' as const};
 const settlement=address?readSettlementIntent(address):{kind:'empty' as const};
 const payLocked=pay.kind==='blocked'||pay.kind==='active'&&
  ['AWAITING_WALLET','UNKNOWN','PENDING'].includes(pay.value.stage);
 const settlementLocked=settlementUnresolved(settlement);
 const locked=payLocked||settlementLocked;
 const lockedMethod:Method=settlementLocked?'contract':payLocked?'wallet':method;
 const forcedMethod:Method|null=locked?lockedMethod:null;
 const selected=forcedMethod??method;
 useEffect(()=>{
  if(locked){
   setMethod(lockedMethod);
   setVisited(v=>v[lockedMethod]?v:{...v,[lockedMethod]:true});
  }else{
   setMethod(initialMethod);
   setVisited(v=>v[initialMethod]?v:{...v,[initialMethod]:true});
  }
 // LockedMethod tracks the persisted signature, so no form can override it.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[initialMethod,address,forcedMethod]);
 function choose(next:Method){
  if(locked)return;
  setMethod(next);
  setVisited(v=>v[next]?v:{...v,[next]:true});
 }
 return <main className="mx-auto w-full max-w-4xl space-y-4 px-4 py-7 md:px-7 md:py-9">
  <header>
   <p className="text-xs font-semibold uppercase tracking-wider" style={{color:'var(--accent)'}}>Veyra · Arc Mainnet</p>
   <h1 className="display mt-2 text-3xl font-bold" style={{color:'var(--ink)'}}>Send USDC</h1>
   <p className="mt-2 text-sm" style={{color:'var(--muted)'}}>Choose a payment method, review the destination, and let Veyra track the original receipt.</p>
   {__VEYRA_RELEASE_ENV__==='preview'
    ?<p className="mt-2 text-xs font-semibold" style={{color:'var(--warning)'}}>REAL MAINNET Preview · commit {__VEYRA_RELEASE_SHA__.slice(0,12)} · controlled wallets only</p>
    :<details className="mt-2 text-xs" style={{color:'var(--muted)'}}>
      <summary>Release details</summary>
      Build {__VEYRA_RELEASE_SHA__.slice(0,12)} · {__VEYRA_RELEASE_ENV__}
     </details>}
  </header>
  <div className="grid grid-cols-2 gap-2" role="group" aria-label="Choose payment method">
   <button type="button" disabled={locked} aria-pressed={selected==='wallet'} onClick={()=>choose('wallet')}
    className="rounded-xl border p-3 text-left disabled:cursor-not-allowed disabled:opacity-50"
    style={{borderColor:selected==='wallet'?'var(--accent)':'var(--border)',
     background:selected==='wallet'?'var(--accent-muted)':'var(--surface)',color:'var(--ink)'}}>
    <span className="flex items-center gap-2 text-sm font-bold"><Wallet className="size-4"/>Wallet transfer</span>
    <span className="mt-1 block text-xs" style={{color:'var(--muted)'}}>Direct · one confirmation</span>
   </button>
   <button type="button" disabled={locked} aria-pressed={selected==='contract'} onClick={()=>choose('contract')}
    className="rounded-xl border p-3 text-left disabled:cursor-not-allowed disabled:opacity-50"
    style={{borderColor:selected==='contract'?'var(--accent)':'var(--border)',
     background:selected==='contract'?'var(--accent-muted)':'var(--surface)',color:'var(--ink)'}}>
    <span className="flex items-center gap-2 text-sm font-bold"><ShieldCheck className="size-4"/>Contract payment</span>
    <span className="mt-1 block text-xs" style={{color:'var(--muted)'}}>May require approval</span>
   </button>
  </div>
  {locked&&<p role="status" className="rounded-xl border p-3 text-xs"
   style={{borderColor:'var(--border)',color:'var(--warning)'}}>
   A wallet request is being checked. Switching methods is paused to prevent another payment.
  </p>}
  {visited.wallet&&<section aria-label="Wallet transfer" hidden={selected!=='wallet'}>
   <MainnetPayPage embedded friendHandle={friendHandle} recipientWallet={recipientWallet} onRecipientUsed={onRecipientUsed}/>
  </section>}
  {visited.contract&&<section aria-label="Contract payment" hidden={selected!=='contract'}
   className="overflow-hidden rounded-xl border" style={{borderColor:'var(--border)',background:'var(--surface)'}}>
   <SettlementPage embedded/>
  </section>}
  <p className="flex items-start gap-2 text-xs leading-5" style={{color:'var(--muted)'}}>
   <ArrowRight className="mt-0.5 size-4 shrink-0"/>
   A pending or uncertain wallet request never triggers an automatic retry. Activity checks the original receipt.
  </p>
 </main>;
}
