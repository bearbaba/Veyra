/** Mainnet Settlement: one send surface, contract default and direct fallback.
 * No draft, note or locally saved contact is recipient authentication.
 * Signing is still gated by the separate wallet journals and canonical receipt checks.
 */
import {useEffect,useState} from 'react';
import {useAccount,useReadContract} from 'wagmi';
import {erc20Abi,formatUnits} from 'viem';
import {ARC_MAINNET_USDC} from '@/mainnet/arcMainnetPay';
import {ArrowRight,ChevronDown,Wallet,ShieldCheck} from 'lucide-react';
import {readMainnetJournal,storageForMainnet} from '@/mainnet/arcMainnetJournal';
import {readSettlementIntent,settlementUnresolved} from '@/mainnet/settlementJournal';
import {readPayDraft,writePayDraft,type MainnetPayDraft} from '@/mainnet/payDraft';
import {MainnetPayPage} from './MainnetPayPage';
import {MainnetPayRecipientPicker} from './MainnetPayRecipientPicker';
import {VeyraIdentityAccess} from '../identity/VeyraIdentityAccess';
import type {RecipientSearchResult} from '@/mainnet/recipientLookup';
import {useUnifiedSocial} from '@/features/social/UnifiedSocial';
import {isMainnetSessionForWallet} from '@/mainnet/signedWalletReceiptScope';
import {SettlementPage} from './SettlementPage';
import {MAINNET_EMERGENCY_READ_ONLY,MAINNET_CANARY_ONLY,MAINNET_CANARY_OWNER} from '@/mainnet/releaseGates';
import type {VerifiedMainnetRecipient} from '@/mainnet/verifiedRecipient';

declare const __VEYRA_RELEASE_SHA__:string;
declare const __VEYRA_RELEASE_ENV__:string;
type Method='wallet'|'contract';
export function MainnetPayHub({
 initialMethod='contract',friendHandle,recipientWallet,verifiedRecipient,onClearVerified,onRecipientUsed,
}:{
 initialMethod?:Method;friendHandle?:string|null;recipientWallet?:string|null;
 verifiedRecipient?:VerifiedMainnetRecipient|null;onClearVerified?:()=>void;onRecipientUsed?:()=>void;
}){
 const {address,connector}=useAccount();
 const social=useUnifiedSocial();
 const signedWallet=social.identityOrigin==='ready'&&
  isMainnetSessionForWallet(social.session,address,connector?.uid);
 const owner=(address??'').toLowerCase();
 const {data:walletBalance,isError:balanceError,isLoading:balanceLoading}=useReadContract({
  address:ARC_MAINNET_USDC,abi:erc20Abi,functionName:'balanceOf',
  args:address?[address]:undefined,chainId:5042,
  query:{enabled:!!address,staleTime:10000},
 });
 const [method,setMethod]=useState<Method>(initialMethod);
 const [optionsOpen,setOptionsOpen]=useState(false);
 const [visited,setVisited]=useState({wallet:initialMethod==='wallet',contract:initialMethod==='contract'});
 const [draftHolder,setDraftHolder]=useState<{owner:string;value:MainnetPayDraft}>(()=>({owner,value:readPayDraft(owner)}));
 const [revision,setRevision]=useState(0);
 const [localVerified,setLocalVerified]=useState<VerifiedMainnetRecipient|null>(null);
 const draft=draftHolder.owner===owner?draftHolder.value:readPayDraft(owner);
 const selectedVerified=signedWallet&&verifiedRecipient&&verifiedRecipient.owner.toLowerCase()===owner&&
  verifiedRecipient.wallet.toLowerCase()===draft.recipient.toLowerCase()?verifiedRecipient:
  signedWallet&&localVerified&&localVerified.owner.toLowerCase()===owner&&
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
  setMethod('contract');setVisited(v=>({...v,contract:true}));
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
  setMethod('contract');setVisited(v=>({...v,contract:true}));
 }
 function changeWalletRecipient(value:string){
  if(!address||locked)return;
  onClearVerified?.();setLocalVerified(null);
  const next={...readPayDraft(owner),recipient:value.trim(),amount:''};
  setDraftHolder({owner,value:next});writePayDraft(owner,next);
 }
 function clearChosen(){
  if(locked)return;
  onClearVerified?.();setLocalVerified(null);
  const next={...draft,recipient:'',amount:''};
  setDraftHolder({owner,value:next});writePayDraft(owner,next);
 }
 function choose(next:Method){
  if(locked)return;
  setMethod(next);
  setVisited(v=>v[next]?v:{...v,[next]:true});
  setOptionsOpen(false);
 }
 return <main className="veyra-pay-page mx-auto w-full max-w-2xl px-4 py-5 md:py-7">
  <div className="veyra-pay-panel space-y-4 rounded-3xl border p-4 sm:p-6">
  <header className="flex items-center gap-3">
   <div className="flex size-11 shrink-0 items-center justify-center rounded-xl border"
    style={{background:'linear-gradient(135deg,rgba(8,141,255,.25),rgba(136,65,252,.24))',borderColor:'var(--border-strong)'}}>
    <Wallet className="size-5" style={{color:'var(--accent)'}}/>
   </div>
   <div className="min-w-0">
    <h1 className="display text-2xl font-bold" style={{color:'var(--ink)'}}>Pay</h1>
    <p className="text-sm" style={{color:'var(--muted)'}}>Send USDC on Arc</p>
   </div>
   {__VEYRA_RELEASE_ENV__==='preview'&&<span className="ml-auto text-xs" style={{color:'var(--warning)'}}>Preview · read only</span>}
  </header>
  {MAINNET_EMERGENCY_READ_ONLY?<p role="alert" className="rounded-xl border p-3 text-sm"
    style={{borderColor:'var(--border)',color:'var(--warning)'}}>
     Payments are paused. Your receipts remain in Activity.
   </p>:MAINNET_CANARY_ONLY&&address&&address.toLowerCase()!==MAINNET_CANARY_OWNER.toLowerCase()?
    <p role="status" className="rounded-xl border p-3 text-sm" style={{borderColor:'var(--border)',color:'var(--warning)'}}>
     Payments are limited to the pilot wallet for now.
    </p>:MAINNET_CANARY_ONLY&&<details className="text-xs" style={{color:'var(--muted)'}}>
     <summary className="cursor-pointer">Pilot · up to 0.01 USDC per payment</summary>
     <p className="mt-2">Only the authorized wallet can sign in Veyra. Public contracts may be called outside the app.</p>
    </details>}
  {address&&!signedWallet&&
   <section aria-label="Sign in to send USDC"><VeyraIdentityAccess/></section>}
  {locked&&<p role="status" className="rounded-xl border p-3 text-sm"
   style={{borderColor:'var(--border)',color:'var(--warning)'}}>
   Payment still processing. Check Activity before trying again.
  </p>}
  <section aria-label="Payment details" className="space-y-4 rounded-2xl border p-3 sm:p-4"
    style={{background:'var(--surface)',borderColor:'var(--border)'}}>
   <MainnetPayRecipientPicker owner={owner} sessionToken={signedWallet?social.session?.token:undefined}
    signedWallet={signedWallet} disabled={locked} selectedVerified={selectedVerified}
    recipient={draft.recipient} onWalletChange={changeWalletRecipient}
    onSelected={resolveSelected} onClear={clearChosen}/>
   <div>
    <label htmlFor="shared-send-amount" className="text-sm font-semibold" style={{color:'var(--ink)'}}>Amount</label>
    <input id="shared-send-amount" value={draft.amount} inputMode="decimal" maxLength={24}
     onChange={e=>changeDraft({amount:e.target.value})} disabled={!address||locked}
     placeholder="0.00" className="veyra-pay-input mt-2 w-full rounded-xl border px-4 py-3 text-3xl font-bold tabular-nums"
     style={{background:'var(--surface-raised)',borderColor:'var(--border)',color:'var(--ink)'}}/>
    <p className="mt-2 text-xs" style={{color:'var(--muted)'}}>
     Available: {balanceError?'Unavailable':walletBalance!==undefined?
      formatUnits(walletBalance,6)+' USDC':balanceLoading?'Checking…':'—'}
    </p>
   </div>
   <div>
    <label className="text-xs font-semibold" htmlFor="pay-private-note" style={{color:'var(--muted)'}}>Note (optional)</label>
    <input id="pay-private-note" value={draft.note} maxLength={120} disabled={!address||locked}
     onChange={e=>changeDraft({note:e.target.value})}
     placeholder="What’s this for?" className="veyra-pay-input mt-2 w-full rounded-xl border px-3 py-2 text-sm"
     style={{background:'var(--surface-raised)',borderColor:'var(--border)',color:'var(--ink)'}}/>
    <details className="mt-2 text-xs" style={{color:'var(--muted)'}}>
      <summary className="cursor-pointer">Note privacy</summary>
      <p className="mt-2">Your note is private and never placed onchain.</p>
     </details>
   </div>
  </section>
  <section className="rounded-xl border p-3 sm:p-4" style={{background:'var(--surface)',borderColor:'var(--border)'}}>
   <div className="flex items-center justify-between gap-3">
    <div>
     <p className="text-sm font-semibold" style={{color:'var(--ink)'}}>Payment method · {selected==='wallet'?'Direct transfer':'Contract payment'}</p>
     <details className="mt-1 text-xs" style={{color:'var(--muted)'}}>
      <summary className="cursor-pointer">Details</summary>
      <p className="mt-2">{selected==='wallet'?'One wallet confirmation.':
       'VeyraSettlement contract. Approve may be needed before payment. No escrow or automatic refund.'}</p>
     </details>
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
     <span className="flex items-center gap-2 text-sm font-semibold"><Wallet className="size-4"/> Direct transfer</span>
     <span className="mt-1 block text-xs" style={{color:'var(--muted)'}}>One wallet confirmation</span>
    </button>
    <button type="button" disabled={locked} aria-pressed={selected==='contract'} onClick={()=>choose('contract')}
     className="rounded-lg border p-3 text-left disabled:opacity-40"
     style={{borderColor:selected==='contract'?'var(--accent)':'var(--border)',background:selected==='contract'?'var(--accent-muted)':'transparent',color:'var(--ink)'}}>
     <span className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck className="size-4"/> Contract payment</span>
     <span className="mt-1 block text-xs" style={{color:'var(--muted)'}}>Fee review · verified receipt</span>
    </button>
   </div>}
  </section>
  {/* Both forms stay mounted after first visit. Their visible drafts share owner-scoped fields. */}
  {visited.wallet&&<section aria-label="Wallet transfer" hidden={selected!=='wallet'}>
   <MainnetPayPage key={owner} embedded friendHandle={friendHandle} verifiedRecipient={selectedVerified}
    sharedDraft={draft} onDraftChange={changeDraft}/>
  </section>}
  {visited.contract&&<section aria-label="Contract payment" hidden={selected!=='contract'}>
   <SettlementPage key={owner} embedded sharedDraft={draft} onDraftChange={changeDraft}
     verifiedRecipient={selectedVerified}/>
  </section>}
  <p className="flex items-start gap-2 text-xs leading-5" style={{color:'var(--muted)'}}>
   <ArrowRight className="mt-0.5 size-4 shrink-0"/>
   Review fees and recipient before signing.
  </p>
  </div>
 </main>;
}
