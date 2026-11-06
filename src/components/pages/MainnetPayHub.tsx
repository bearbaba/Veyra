/** Mainnet Pay: one send surface, wallet default and verified-contract option.
 * No draft, note or locally saved contact is recipient authentication.
 * Signing is still gated by the separate wallet journals and canonical receipt checks.
 */
import {useEffect,useState} from 'react';
import {useAccount,useReadContract} from 'wagmi';
import {erc20Abi,formatUnits} from 'viem';
import {ARC_MAINNET_USDC} from '@/mainnet/arcMainnetPay';
import {ShieldCheck} from 'lucide-react';
import {readMainnetJournal,storageForMainnet} from '@/mainnet/arcMainnetJournal';
import {readSettlementIntent,settlementUnresolved} from '@/mainnet/settlementJournal';
import {readPayDraft,writePayDraft,type MainnetPayDraft} from '@/mainnet/payDraft';
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
export function MainnetPayHub({
 recipientWallet,verifiedRecipient,onClearVerified,onRecipientUsed,
}:{
 recipientWallet?:string|null;
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
 return <main className="veyra-page veyra-pay-page mx-auto w-full max-w-2xl space-y-4 px-4 py-5 md:py-7">
  <header>
   <p className="veyra-eyebrow">VEYRA · ARC MAINNET</p>
   <h1 className="veyra-page-title">Pay</h1>
   <p className="veyra-page-subtitle">Send USDC to a wallet or friend.</p>
   {__VEYRA_RELEASE_ENV__==='preview'&&<span className="text-xs" style={{color:'var(--warning)'}}>Preview · read only</span>}
  </header>
  <div className="veyra-pay-panel space-y-4 rounded-2xl border p-4 sm:p-5">
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
  <div className="flex items-start gap-2 border-t pt-4 text-sm" style={{borderColor:'var(--border)'}}>
   <ShieldCheck className="mt-0.5 size-4 shrink-0" style={{color:'var(--accent)'}}/>
   <div><p className="font-semibold" style={{color:'var(--ink)'}}>Veyra Settlement</p>
    <p className="mt-1 text-xs leading-5" style={{color:'var(--muted)'}}>
     Wallet and Friends share one contract payment. Review recipient, platform and network fees before signing.
     USDC approval may be required. No escrow or automatic refund.
    </p></div>
  </div>
  {payLocked?<p role="status" className="rounded-xl border p-3 text-sm"
    style={{borderColor:'var(--border)',color:'var(--warning)'}}>
    Previous wallet payment is pending or unknown. Check Activity; do not sign another payment.
   </p>:<section aria-label="Contract payment">
    <SettlementPage key={owner} embedded sharedDraft={draft} onDraftChange={changeDraft}
      verifiedRecipient={selectedVerified}/>
   </section>}
  </div>
 </main>;
}
