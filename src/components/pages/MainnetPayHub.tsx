/** Mainnet Pay: one send surface, wallet default and verified-contract option.
 * No draft, note or locally saved contact is recipient authentication.
 * Signing is still gated by the separate wallet journals and canonical receipt checks.
 */
import {useEffect,useState} from 'react';
import {useAccount,useReadContract,useBalance} from 'wagmi';
import {erc20Abi,formatUnits} from 'viem';
import {settlementFundingShortfall} from '@/mainnet/unifiedSettlementFunding';
import {ARC_MAINNET_USDC} from '@/mainnet/arcMainnetPay';
import {ShieldCheck} from 'lucide-react';
import {readMainnetJournal,storageForMainnet} from '@/mainnet/arcMainnetJournal';
import {readSettlementIntent,settlementUnresolved,resumablePaymentAttempt} from '@/mainnet/settlementJournal';
import {readPayDraft,writePayDraft,type MainnetPayDraft} from '@/mainnet/payDraft';
import {readPaySource,writePaySource,type PaySource} from '@/mainnet/paySourcePreference';
import {MainnetPayRecipientPicker} from './MainnetPayRecipientPicker';
import {VeyraIdentityAccess} from '../identity/VeyraIdentityAccess';
import type {RecipientSearchResult} from '@/mainnet/recipientLookup';
import {useUnifiedSocial} from '@/features/social/UnifiedSocial';
import {isMainnetSessionForWallet} from '@/mainnet/signedWalletReceiptScope';
import {SettlementPage} from './SettlementPage';
import {MAINNET_EMERGENCY_READ_ONLY,MAINNET_SETTLEMENT_CANARY_ONLY,MAINNET_CANARY_OWNER} from '@/mainnet/releaseGates';
import type {VerifiedMainnetRecipient} from '@/mainnet/verifiedRecipient';
import type {VeyraPaymentRequest} from '@/lib/api/paymentRequests';
import {MainnetUnifiedBalancePanel} from './MainnetUnifiedBalancePanel';
import {MainnetPayFundingRecoveryWorker} from '@/mainnet/MainnetPayFundingRecoveryWorker';
import {readGatewayMainnetOperation,readGatewayMainnetHistory} from '@/mainnet/gatewayMainnetJournal';
import {readPayFundingJourney,samePayFundingTarget,derivePayFundingJourneyState,
 dismissPayFundingJourney,type FundingJourneyState} from '@/mainnet/payFundingJourney';

declare const __VEYRA_RELEASE_SHA__:string;
declare const __VEYRA_RELEASE_ENV__:string;
export function MainnetPayHub({
 recipientWallet,verifiedRecipient,paymentRequest,onClearVerified,onRecipientUsed,onVerifiedSelected,
}:{
 recipientWallet?:string|null;
 verifiedRecipient?:VerifiedMainnetRecipient|null;paymentRequest?:VeyraPaymentRequest|null;
 onClearVerified?:()=>void;onRecipientUsed?:()=>void;
 onVerifiedSelected?:(recipient:VerifiedMainnetRecipient)=>void;
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
 const {data:arcGas,isError:gasError}=useBalance({address,chainId:5042,
  query:{enabled:!!address,staleTime:10000}});
 const [showUnifiedFunding,setShowUnifiedFunding]=useState(()=>readPaySource(owner)==='unified');
 useEffect(()=>{setShowUnifiedFunding(readPaySource(owner)==='unified');},[owner]);
 function selectPaymentSource(source:PaySource){
  if(!address)return;
  writePaySource(address,source);setShowUnifiedFunding(source==='unified');
 }
 const [localVerified,setLocalVerified]=useState<VerifiedMainnetRecipient|null>(null);
 const draft=draftHolder.owner===owner?draftHolder.value:readPayDraft(owner);
 const requestAmount=paymentRequest?formatUnits(BigInt(paymentRequest.amountRaw),6):'';
 const requestLocked=Boolean(paymentRequest);
 const shortfall=settlementFundingShortfall(draft.amount,
  walletBalance===undefined?null:walletBalance);
 const needsFunding=shortfall!==null&&shortfall!=='0';
 const selectedVerified=signedWallet&&verifiedRecipient&&verifiedRecipient.owner.toLowerCase()===owner&&
  verifiedRecipient.wallet.toLowerCase()===draft.recipient.toLowerCase()?verifiedRecipient:
  signedWallet&&localVerified&&localVerified.owner.toLowerCase()===owner&&
  localVerified.wallet.toLowerCase()===draft.recipient.toLowerCase()?localVerified:null;
 useEffect(()=>{setLocalVerified(null);},[owner,social.session?.token]);
 useEffect(()=>{
  const sync=()=>setRevision(i=>i+1);
  window.addEventListener('veyra:mainnet:journal',sync);
  window.addEventListener('veyra:gateway:mainnet',sync);
  window.addEventListener('veyra:pay:funding',sync);
  window.addEventListener('focus',sync);
  window.addEventListener('storage',sync);
  return()=>{
   window.removeEventListener('veyra:mainnet:journal',sync);
   window.removeEventListener('veyra:gateway:mainnet',sync);
   window.removeEventListener('veyra:pay:funding',sync);
   window.removeEventListener('focus',sync);
   window.removeEventListener('storage',sync);
  };
 },[]);
 void revision;
 const fundingRead=address?readPayFundingJourney(address):{kind:'empty' as const};
 const fundingGateway=address?readGatewayMainnetOperation(address):null;
 const fundingHistory=address?readGatewayMainnetHistory(address):[];
 const fundingJourney=fundingRead.kind==='active'?fundingRead.value:null;
 const fundingState:FundingJourneyState=fundingJourney?
  derivePayFundingJourneyState({journey:fundingJourney,gatewayOperation:fundingGateway,
   history:fundingHistory,settlement:address?readSettlementIntent(address):{kind:'empty'},
   arcWalletUsdc:walletBalance===undefined?null:walletBalance}):
  fundingRead.kind==='blocked'?'BLOCKED':'NOT_STARTED';
 const sameFundingTarget=fundingJourney?samePayFundingTarget(fundingJourney,{
  owner, payee:draft.recipient,grossUsdc:draft.amount,
  ...(paymentRequest?{requestId:paymentRequest.requestId}:{})}):true;
 const fundingUnresolved=['FUNDING_UNKNOWN','FUNDING_PENDING','SETTLEMENT_PENDING','BLOCKED'].includes(fundingState);
 const fundingBlocked=fundingRead.kind==='blocked'||fundingJourney!==null&&
  (!sameFundingTarget||fundingUnresolved||fundingState==='SETTLEMENT_ONCHAIN_VERIFIED');
 const unifiedNeedsFunding=showUnifiedFunding&&needsFunding;
 // A gateway receipt is not a Settlement payment. Never expose the contract
 // signing surface until a separate funding receipt and live wallet read pass.
 const settlementFromUnifiedReady=(!fundingJourney&& !unifiedNeedsFunding)||
  fundingJourney!==null&&sameFundingTarget&&
  (fundingState==='READY_TO_SETTLE'&&!needsFunding||
   fundingState==='SETTLEMENT_PENDING');
 // The original Settlement component must stay mounted for wallet refusal
 // and UNKNOWN recovery. Its own journal forbids a second financial attempt.
 const recoveringSettlement=fundingState==='SETTLEMENT_PENDING'&&sameFundingTarget;
 const showSettlement=(recoveringSettlement||!fundingBlocked)&&
  (recoveringSettlement||!showUnifiedFunding||
   fundingJourney?settlementFromUnifiedReady:!unifiedNeedsFunding)&&
  fundingState!=='SETTLEMENT_ONCHAIN_VERIFIED';
 const pay=address?readMainnetJournal(address,storageForMainnet()):{kind:'empty' as const};
 const settlement=address?readSettlementIntent(address):{kind:'empty' as const};
 const payLocked=pay.kind==='blocked'||pay.kind==='active'&&
  ['AWAITING_WALLET','UNKNOWN','PENDING'].includes(pay.value.stage);
 const settlementLocked=settlementUnresolved(settlement);
 const resumable=Boolean(address&&paymentRequest&&resumablePaymentAttempt(settlement,{
  owner:address,requestId:paymentRequest.requestId,recipient:paymentRequest.recipientWallet,
  amount:requestAmount,ref:paymentRequest.paymentRef}));
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
  if(!verifiedRecipient||!address||verifiedRecipient.owner.toLowerCase()!==address.toLowerCase()||
    (locked&&!resumable))return;
  const stored=readPayDraft(owner);
  // Restored human labels require fresh server proof, but a matching wallet
  // may keep the user's earlier amount for an independent new Review.
  const sameWallet=stored.recipient.toLowerCase()===verifiedRecipient.wallet.toLowerCase();
  const next={...stored,recipient:verifiedRecipient.wallet,
   amount:paymentRequest?requestAmount:sameWallet?stored.amount:''};
  setDraftHolder({owner,value:next});writePayDraft(owner,next);
 // One new verified recipient selection, never an old draft, changes the target.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[verifiedRecipient?.snapshotId,owner,paymentRequest?.requestId]);
 function changeDraft(patch:Partial<MainnetPayDraft>){
  if(!address||locked||requestLocked&&(patch.recipient!==undefined||patch.amount!==undefined)||selectedVerified&&patch.recipient!==undefined)return;
  const next={...draft,...patch};
  setDraftHolder({owner,value:next});
  writePayDraft(owner,next);
 }
 function resolveSelected(result:RecipientSearchResult|null){
  if(!result||!address||locked||requestLocked)return;
  if(result.kind==='x-unavailable')return;
  onClearVerified?.();
  const wallet=result.kind==='veyra'?result.person.wallet:result.wallet;
  const next={...readPayDraft(owner),recipient:wallet,amount:''};
  setDraftHolder({owner,value:next});writePayDraft(owner,next);
  setLocalVerified(result.kind==='veyra'?result.person:null);
  if(result.kind==='veyra')onVerifiedSelected?.(result.person);
 }
 function changeWalletRecipient(value:string){
  if(!address||locked||requestLocked)return;
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
  {address&&signedWallet&&<MainnetPayFundingRecoveryWorker/>}
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
   </p>:MAINNET_SETTLEMENT_CANARY_ONLY&&address&&address.toLowerCase()!==MAINNET_CANARY_OWNER.toLowerCase()?
    <p role="status" className="rounded-xl border p-3 text-sm" style={{borderColor:'var(--border)',color:'var(--warning)'}}>
     Payments are limited to the pilot wallet for now.
    </p>:MAINNET_SETTLEMENT_CANARY_ONLY&&<details className="text-xs" style={{color:'var(--muted)'}}>
     <summary className="cursor-pointer">Pilot · up to 0.01 USDC per payment</summary>
     <p className="mt-2">Only the authorized wallet can sign in Veyra. Public contracts may be called outside the app.</p>
    </details>}
  {address&&!signedWallet&&
   <section aria-label="Sign in to send USDC"><VeyraIdentityAccess/></section>}
  {locked&&!resumable&&<p role="status" className="rounded-xl border p-3 text-sm"
   style={{borderColor:'var(--border)',color:'var(--warning)'}}>
   Payment still processing. Check Activity before trying again.
  </p>}
  {paymentRequest&&<section role="status" className="rounded-xl border p-3 text-sm" style={{borderColor:"var(--border-strong)"}}>
    <p className="font-semibold">Payment Request · {paymentRequest.requestId.slice(0,16)}…</p>
    <p className="mt-1">{requestAmount} USDC to the requester. Amount, recipient and payment reference are locked to the request.</p>
    <p className="mt-1 text-xs">Expires {new Date(paymentRequest.expiresAt).toLocaleString()}. Funding your own wallet does not mark this request Paid.</p>
   </section>}
  <section aria-label="Payment details" className="space-y-4 rounded-2xl border p-3 sm:p-4"
    style={{background:'var(--surface)',borderColor:'var(--border)'}}>
   <MainnetPayRecipientPicker owner={owner} sessionToken={signedWallet?social.session?.token:undefined}
    signedWallet={signedWallet} disabled={locked||requestLocked} selectedVerified={selectedVerified}
    recipient={draft.recipient} onWalletChange={changeWalletRecipient}
    onSelected={resolveSelected} onClear={clearChosen}/>
   <div>
    <label htmlFor="shared-send-amount" className="text-sm font-semibold" style={{color:'var(--ink)'}}>Amount</label>
    <input id="shared-send-amount" value={draft.amount} inputMode="decimal" maxLength={24}
     onChange={e=>changeDraft({amount:e.target.value})} disabled={!address||locked||requestLocked}
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
  {address&&signedWallet&&draft.amount&&<section aria-label="Choose payment source" className="rounded-xl border p-3 space-y-3" style={{borderColor:"var(--border)"}}>
    <p className="text-sm font-semibold" style={{color:"var(--ink)"}}>Fund this payment</p>
    <div className="grid grid-cols-2 gap-2" role="group" aria-label="USDC source">
     <button type="button" aria-pressed={!showUnifiedFunding} disabled={locked&&!resumable}
      className="veyra-btn-secondary min-h-11 rounded-lg p-2 text-sm disabled:opacity-50"
      onClick={()=>selectPaymentSource('wallet')}>Arc wallet</button>
     <button type="button" aria-pressed={showUnifiedFunding} disabled={locked&&!resumable}
      className="veyra-btn-secondary min-h-11 rounded-lg p-2 text-sm disabled:opacity-50"
      onClick={()=>selectPaymentSource('unified')}>Unified · top up Arc</button>
    </div>
    {fundingRead.kind==='blocked'&&<p role="alert" className="text-xs"
      style={{color:"var(--warning)"}}>Saved funding context is unreadable. Do not initiate another transfer.</p>}
    {fundingJourney&&<section role="status" aria-label="Unified payment progress"
      className="space-y-2 rounded-xl border p-3 text-xs" style={{borderColor:"var(--border)"}}>
      <p className="font-semibold">Unified → Arc wallet → Settlement</p>
      <p>Funding: {fundingState==='FUNDING_PENDING'||fundingState==='FUNDING_UNKNOWN'?
       'Original transfer still being recovered':fundingState==='READY_TO_SETTLE'?'Verified onchain':
       fundingState==='SETTLEMENT_ONCHAIN_VERIFIED'?'Finished; verify the private receipt in Activity':
       fundingState==='FUNDING_DECLINED'?'Wallet signature declined before transfer':
       fundingState==='FUNDING_REVERTED'?'Source transfer reverted':
       fundingState==='WALLET_SHORTFALL'?'Verified transfer, Arc wallet still below required amount':
       fundingState==='CHECKING_ARC_WALLET'?'Checking destination wallet':
       fundingState==='SETTLEMENT_PENDING'?'Settlement signature or receipt pending':
       fundingState==='BLOCKED'?'Recovery needs attention':'Review required'}</p>
      <p>Settlement: {fundingState==='SETTLEMENT_ONCHAIN_VERIFIED'?
       'Verified onchain · backend receipt sync may still be pending':
       fundingState==='SETTLEMENT_PENDING'?'Pending · do not resend':
       fundingState==='READY_TO_SETTLE'?'Ready for a separate signing review':'Not yet sent'}</p>
      {!sameFundingTarget&&<p style={{color:"var(--warning)"}}>
       Current payee/amount differs from the saved journey. Resolve or dismiss the earlier journey before signing.
      </p>}
      {fundingHistory!=='blocked'&&
       ['NOT_STARTED','FUNDING_DECLINED','FUNDING_REVERTED','SETTLEMENT_ONCHAIN_VERIFIED'].includes(fundingState)&&
       <button type="button" className="veyra-btn-secondary rounded-lg px-3 py-2"
        onClick={()=>{if(address&&dismissPayFundingJourney(address,fundingGateway,settlement,fundingHistory))
         setRevision(n=>n+1);}}>
         Close this journey after reviewing Activity
       </button>}
    </section>}
    {showUnifiedFunding&&<>
     <p className="text-xs" style={{color:"var(--muted)"}}>
      Step 1: fund your Arc wallet from Gateway. Step 2: sign Settlement to the person.
      Funding alone never pays the recipient.
     </p>
     <p className="text-xs" style={{color:"var(--muted)"}}>
      The Settlement protocol fee is deducted from the gross payment amount, not added to wallet funding.
      Arc network gas and any approval gas are separate from Gateway fees; final live gas review is required.
      {gasError?' Arc gas lookup is unavailable.':arcGas?.value===0n?
       ' No Arc native gas is available. Signing will require gas funding.':
       arcGas===undefined?' Checking Arc native gas.':''}
     </p>
     {shortfall===null?<p role="status" className="text-xs" style={{color:"var(--warning)"}}>
       Check your wallet USDC before funding. No amount is guessed.
      </p>:!needsFunding?<p role="status" className="text-xs" style={{color:"var(--success)"}}>
       Arc wallet covers the gross USDC amount. You can pay from the Arc wallet without another Gateway transfer.
      </p>:<>
       <p className="text-sm font-semibold">Wallet shortfall: {shortfall} USDC</p>
       <p className="text-xs" style={{color:"var(--muted)"}}>
        Gateway fees are additional. The quoted net amount must cover this shortfall before any funding signature.
        After a verified Gateway receipt, wallet balance and Settlement fees are checked again.
       </p>
       {fundingJourney&&fundingState!=='NOT_STARTED'&&fundingState!=='FUNDING_DECLINED'&&fundingState!=='FUNDING_REVERTED'?
        <p className="text-xs" style={{color:"var(--warning)"}}>
         A funding attempt is already recorded. Follow its original transaction in Activity; no retry is initiated.
        </p>:
        <MainnetUnifiedBalancePanel fundingToWallet={address} fundingNeeded={shortfall}
         fundingTarget={{payee:draft.recipient,grossUsdc:draft.amount,
          ...(paymentRequest?{requestId:paymentRequest.requestId}:{})}}/>}
      </>}
    </>}
   </section>}
   {payLocked?<p role="status" className="rounded-xl border p-3 text-sm"
    style={{borderColor:'var(--border)',color:'var(--warning)'}}>
    Previous wallet payment is pending or unknown. Check Activity; do not sign another payment.
   </p>:!showSettlement?<p role="status" className="rounded-xl border p-3 text-sm"
    style={{borderColor:"var(--border)",color:"var(--warning)"}}>
    {fundingState==='SETTLEMENT_ONCHAIN_VERIFIED'?
     'Settlement verified onchain. Check Activity for synced sender and recipient receipts; do not send again.':
     'Complete or recover the original Unified funding journey before signing Settlement. No automatic resend.'}
   </p>:<section aria-label="Contract payment">
    <SettlementPage key={owner+":"+(paymentRequest?.requestId??"")} embedded sharedDraft={draft} onDraftChange={changeDraft}
      verifiedRecipient={selectedVerified} paymentRequest={paymentRequest}/>
   </section>}
  </div>
 </main>;
}
