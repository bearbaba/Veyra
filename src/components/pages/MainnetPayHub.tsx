/** Send USDC: the normal path is one direct transfer. Contract is explicitly advanced.
 * No draft, note or locally saved contact is recipient authentication.
 * Signing is still gated by the separate wallet journals and canonical receipt checks.
 */
import {useEffect,useState} from 'react';
import {useAccount} from 'wagmi';
import {ArrowRight,ChevronDown,Wallet,ShieldCheck} from 'lucide-react';
import {readMainnetJournal,storageForMainnet} from '@/mainnet/arcMainnetJournal';
import {readSettlementIntent,settlementUnresolved} from '@/mainnet/settlementJournal';
import {readPayDraft,writePayDraft,type MainnetPayDraft} from '@/mainnet/payDraft';
import {MainnetPayPage} from './MainnetPayPage';
import {MainnetRecipientSearch} from '../identity/MainnetRecipientSearch';
import type {RecipientSearchResult} from '@/mainnet/recipientLookup';
import {useUnifiedSocial} from '@/features/social/UnifiedSocial';
import {SettlementPage} from './SettlementPage';
import {MAINNET_EMERGENCY_READ_ONLY,MAINNET_CANARY_ONLY,MAINNET_CANARY_OWNER} from '@/mainnet/releaseGates';
import type {VerifiedMainnetRecipient} from '@/mainnet/verifiedRecipient';

declare const __VEYRA_RELEASE_SHA__:string;
declare const __VEYRA_RELEASE_ENV__:string;
type Method='wallet'|'contract';
export function MainnetPayHub({
 initialMethod='wallet',friendHandle,recipientWallet,verifiedRecipient,onClearVerified,onRecipientUsed,
}:{
 initialMethod?:Method;friendHandle?:string|null;recipientWallet?:string|null;
 verifiedRecipient?:VerifiedMainnetRecipient|null;onClearVerified?:()=>void;onRecipientUsed?:()=>void;
}){
 const {address}=useAccount();
 const social=useUnifiedSocial();
 const owner=(address??'').toLowerCase();
 const [method,setMethod]=useState<Method>(initialMethod);
 const [optionsOpen,setOptionsOpen]=useState(initialMethod==='contract');
 const [visited,setVisited]=useState({wallet:initialMethod==='wallet',contract:initialMethod==='contract'});
 const [draftHolder,setDraftHolder]=useState<{owner:string;value:MainnetPayDraft}>(()=>({owner,value:readPayDraft(owner)}));
 const [revision,setRevision]=useState(0);
 const [localVerified,setLocalVerified]=useState<VerifiedMainnetRecipient|null>(null);
 const draft=draftHolder.owner===owner?draftHolder.value:readPayDraft(owner);
 const selectedVerified=verifiedRecipient&&verifiedRecipient.owner.toLowerCase()===owner&&
  verifiedRecipient.wallet.toLowerCase()===draft.recipient.toLowerCase()?verifiedRecipient:
  localVerified&&localVerified.owner.toLowerCase()===owner&&
  localVerified.wallet.toLowerCase()===draft.recipient.toLowerCase()?localVerified:null;
 useEffect(()=>{setLocalVerified(null);},[owner,social.session?.token]);
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
 const forcedMethod:Method|null=settlementLocked?'contract':payLocked?'wallet':null;
 const selected=forcedMethod??method;
 // A completed transaction must not silently switch a person back to Wallet.
 useEffect(()=>{
  setMethod(initialMethod);
  setVisited(v=>v[initialMethod]?v:{...v,[initialMethod]:true});
 },[initialMethod,owner]);
 useEffect(()=>{
  if(forcedMethod){
   setMethod(forcedMethod);
   setVisited(v=>v[forcedMethod]?v:{...v,[forcedMethod]:true});
  }
 },[forcedMethod]);
 useEffect(()=>{
  if(!recipientWallet)return;
  if(/^0x[0-9a-fA-F]{40}$/.test(recipientWallet)&&owner&&address&&!locked){
   // A new contact is a new payee: clear the old amount to avoid accidental re-use.
   const next={...readPayDraft(owner),recipient:recipientWallet,amount:''};
   setDraftHolder({owner,value:next});
   writePayDraft(owner,next);
  }
  onRecipientUsed?.();
 // A new recipient is consumed exactly once by the parent route.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[recipientWallet,owner]);
 useEffect(()=>{
  if(!verifiedRecipient||!address||verifiedRecipient.owner.toLowerCase()!==address.toLowerCase()||locked)return;
  const next={...readPayDraft(owner),recipient:verifiedRecipient.wallet,amount:''};
  setDraftHolder({owner,value:next});writePayDraft(owner,next);
  setMethod('wallet');setVisited(v=>({...v,wallet:true}));
 // One new verified recipient selection, never an old draft, changes the target.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[verifiedRecipient?.snapshotId,owner]);
 function changeDraft(patch:Partial<MainnetPayDraft>){
  if(!address||locked||selectedVerified&&patch.recipient!==undefined)return;
  const next={...draft,...patch};
  setDraftHolder({owner,value:next});
  writePayDraft(owner,next);
 }
 function resolveSelected(result:RecipientSearchResult|null){
  if(!result||!address||locked)return;
  if(result.kind==='x-unavailable')return;
  onClearVerified?.();
  const wallet=result.kind==='veyra'?result.person.wallet:result.wallet;
  const next={...readPayDraft(owner),recipient:wallet,amount:''};
  setDraftHolder({owner,value:next});writePayDraft(owner,next);
  setLocalVerified(result.kind==='veyra'?result.person:null);
  setMethod('wallet');setVisited(v=>({...v,wallet:true}));
 }
 function clearChosen(){
  if(locked)return;
  onClearVerified?.();setLocalVerified(null);
  const next={...draft,recipient:'',amount:''};
  setDraftHolder({owner,value:next});writePayDraft(owner,next);
 }
 function choose(next:Method){
  if(locked||next==='contract'&&selectedVerified)return;
  setMethod(next);
  setVisited(v=>v[next]?v:{...v,[next]:true});
  setOptionsOpen(false);
 }
 return <main className="mx-auto w-full max-w-3xl space-y-4 px-4 py-7 md:px-7 md:py-9">
  <header>
   <p className="text-xs font-semibold uppercase tracking-wider" style={{color:'var(--accent)'}}>Veyra · Arc Mainnet</p>
   <h1 className="display mt-2 text-3xl font-bold" style={{color:'var(--ink)'}}>Send USDC</h1>
   <p className="mt-2 text-sm" style={{color:'var(--muted)'}}>Choose who receives it, review the amount, then confirm in your wallet.</p>
   {__VEYRA_RELEASE_ENV__==='preview'
    ?<p className="mt-2 text-xs font-semibold" style={{color:'var(--warning)'}}>REAL MAINNET Preview · commit {__VEYRA_RELEASE_SHA__.slice(0,12)} · controlled wallets only</p>
    :<details className="mt-2 text-xs" style={{color:'var(--muted)'}}>
      <summary>Release details</summary>
      Build {__VEYRA_RELEASE_SHA__.slice(0,12)} · {__VEYRA_RELEASE_ENV__}
     </details>}
  </header>
  {MAINNET_EMERGENCY_READ_ONLY?<p role="alert" className="rounded-xl border p-3 text-sm"
   style={{borderColor:'var(--border)',color:'var(--warning)'}}>
    Emergency read-only mode. New transfers and approvals are disabled; existing receipts remain in Activity.
  </p>:MAINNET_CANARY_ONLY&&<p role="status" className="rounded-xl border p-3 text-sm"
   style={{borderColor:'var(--border)',color:'var(--muted)'}}>
    Mainnet acceptance pilot: only the approved owner wallet
    ({MAINNET_CANARY_OWNER.slice(0,6)}…{MAINNET_CANARY_OWNER.slice(-4)}) may send up to 0.01 USDC
    per transaction. Everyone else can review, but cannot sign. Contract/Swap/Bridge writes remain off.
  </p>}
  {locked&&<p role="status" className="rounded-xl border p-3 text-sm"
   style={{borderColor:'var(--border)',color:'var(--warning)'}}>
   Your original wallet request is still being checked. Veyra will not switch payment methods or submit it again.
  </p>}
  <section aria-label="Payment details" className="space-y-4 rounded-xl border p-4 sm:p-5"
    style={{background:'var(--surface)',borderColor:'var(--border)'}}>
   <div>
    {selectedVerified?<div className="rounded-xl border p-4" style={{borderColor:'var(--border)',color:'var(--ink)'}}>
      <p className="text-sm font-semibold">{selectedVerified.displayName||'Veyra recipient'} · @{selectedVerified.veyraHandle}.veyra</p>
      <p className="mt-1 text-xs" style={{color:'var(--accent)'}}>Verified Veyra ID · receiving wallet rechecked before signature</p>
      <details className="mt-2 text-xs" style={{color:'var(--muted)'}}>
       <summary className="cursor-pointer">Receiving wallet</summary><p className="mt-2 break-all font-mono">{selectedVerified.wallet}</p>
      </details>
      <button type="button" disabled={locked} onClick={clearChosen}
       className="mt-3 text-xs font-semibold disabled:opacity-40" style={{color:'var(--accent)'}}>Change recipient</button>
     </div>:
     <>
      <MainnetRecipientSearch key={owner} owner={address} sessionToken={social.session?.token} disabled={locked}
       initialQuery="" label="Who are you paying?" onSelection={resolveSelected}
       onQueryEdit={()=>{
        if(!address||locked)return;
        const next={...readPayDraft(owner),recipient:'',amount:''};
        setDraftHolder({owner,value:next});writePayDraft(owner,next);setLocalVerified(null);
       }}/>
      {draft.recipient&&<p className="mt-2 text-xs" style={{color:'var(--muted)'}}>
        Recipient: {draft.recipient.slice(0,10)}…{draft.recipient.slice(-6)} · direct wallet transfer (not a verified Veyra ID)
       </p>}
     </>}
   </div>
   <div>
    <label htmlFor="shared-send-amount" className="text-sm font-semibold" style={{color:'var(--ink)'}}>Amount · USDC</label>
    <input id="shared-send-amount" value={draft.amount} inputMode="decimal" maxLength={24}
     onChange={e=>changeDraft({amount:e.target.value})} disabled={!address||locked}
     placeholder="0.00" className="mt-2 w-full rounded-xl border px-4 py-3 text-lg font-semibold"
     style={{background:'var(--surface-raised)',borderColor:'var(--border)',color:'var(--ink)'}}/>
   </div>
   <div>
    <label className="text-xs font-semibold" htmlFor="pay-private-note" style={{color:'var(--muted)'}}>Your note (optional)</label>
    <input id="pay-private-note" value={draft.note} maxLength={120} disabled={!address||locked}
     onChange={e=>changeDraft({note:e.target.value})}
     placeholder="e.g. Dinner with Alex" className="mt-2 w-full rounded-lg border px-3 py-2 text-sm"
     style={{background:'var(--surface-raised)',borderColor:'var(--border)',color:'var(--ink)'}}/>
    <p className="mt-1 text-xs" style={{color:'var(--muted)'}}>Private to you. Saved on this device first, then to your account after verified receipt sync. Never onchain or shared with the recipient.</p>
   </div>
  </section>
  <section className="rounded-xl border p-3 sm:p-4" style={{background:'var(--surface)',borderColor:'var(--border)'}}>
   <div className="flex items-center justify-between gap-3">
    <div>
     <p className="text-sm font-semibold" style={{color:'var(--ink)'}}>Payment method · {selected==='wallet'?'Wallet transfer':'Contract payment'}</p>
     <p className="mt-1 text-xs" style={{color:'var(--muted)'}}>
      {selected==='wallet'?'Direct USDC transfer · one wallet confirmation':
       'Onchain payment reference · allowance approval may require a second confirmation. No escrow or refund.'}
     </p>
    </div>
    <button type="button" onClick={()=>setOptionsOpen(v=>!v)} aria-expanded={optionsOpen}
     aria-label="Change payment method" className="flex shrink-0 items-center gap-1 rounded-lg border px-3 py-2 text-xs font-semibold"
     style={{color:'var(--accent)',borderColor:'var(--border)'}}>
     Change <ChevronDown className="size-3.5"/>
    </button>
   </div>
   {optionsOpen&&<div className="mt-3 grid gap-2 sm:grid-cols-2" role="group" aria-label="Choose payment method">
    <button type="button" disabled={locked} aria-pressed={selected==='wallet'} onClick={()=>choose('wallet')}
     className="rounded-lg border p-3 text-left disabled:opacity-40"
     style={{borderColor:selected==='wallet'?'var(--accent)':'var(--border)',background:selected==='wallet'?'var(--accent-muted)':'transparent',color:'var(--ink)'}}>
     <span className="flex items-center gap-2 text-sm font-semibold"><Wallet className="size-4"/> Wallet transfer</span>
     <span className="mt-1 block text-xs" style={{color:'var(--muted)'}}>Everyday payments · direct to recipient</span>
    </button>
    <button type="button" disabled={locked||!!selectedVerified} aria-pressed={selected==='contract'} onClick={()=>choose('contract')}
     className="rounded-lg border p-3 text-left disabled:opacity-40"
     style={{borderColor:selected==='contract'?'var(--accent)':'var(--border)',background:selected==='contract'?'var(--accent-muted)':'transparent',color:'var(--ink)'}}>
     <span className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck className="size-4"/> Contract payment</span>
     <span className="mt-1 block text-xs" style={{color:'var(--muted)'}}>Advanced · onchain reference for reconciliation</span>
    </button>
   </div>}
  </section>
  {/* Both forms stay mounted after first visit. Their visible drafts share owner-scoped fields. */}
  {visited.wallet&&<section aria-label="Wallet transfer" hidden={selected!=='wallet'}>
   <MainnetPayPage key={owner} embedded friendHandle={friendHandle} verifiedRecipient={selectedVerified}
    sharedDraft={draft} onDraftChange={changeDraft}/>
  </section>}
  {visited.contract&&<section aria-label="Contract payment" hidden={selected!=='contract'}>
   <SettlementPage key={owner} embedded sharedDraft={draft} onDraftChange={changeDraft}/>
  </section>}
  <p className="flex items-start gap-2 text-xs leading-5" style={{color:'var(--muted)'}}>
   <ArrowRight className="mt-0.5 size-4 shrink-0"/>
   Every payment uses an explicit wallet signature. Activity checks the original transaction, not a replacement.
  </p>
 </main>;
}
