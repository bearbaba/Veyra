/** Mainnet Pay: one send surface, wallet default and verified-contract option.
 * No draft, note or locally saved contact is recipient authentication.
 * Signing is still gated by the separate wallet journals and canonical receipt checks.
 */
import {useEffect,useState} from 'react';
import {useAccount,useReadContract,useBalance,usePublicClient} from 'wagmi';
import {erc20Abi,formatUnits,parseUnits} from 'viem';
import {arcSharedUsdcFunding,quoteSettlementProtocolNet} from '@/mainnet/arcSharedUsdcFunding';
import {getVeyraSettlementDeployment,VEYRA_SETTLEMENT_ABI} from '@/config/veyraSettlement';
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
import {readServerPayJourney,type ServerPayJourney} from '@/lib/api/mainnetPayJourneys';
import {readGatewayMainnetOperation,readGatewayMainnetHistory} from '@/mainnet/gatewayMainnetJournal';
import {readPayFundingJourney,genericPayFundingRef,samePayFundingTarget,derivePayFundingJourneyState,
 dismissPayFundingJourney,type FundingJourneyState} from '@/mainnet/payFundingJourney';

declare const __VEYRA_RELEASE_SHA__:string;
declare const __VEYRA_RELEASE_ENV__:string;
export function MainnetPayHub({
 recipientWallet,verifiedRecipient,paymentRequest,onClearVerified,onRecipientUsed,onVerifiedSelected,onDirectPay,
}:{
 recipientWallet?:string|null;
 verifiedRecipient?:VerifiedMainnetRecipient|null;paymentRequest?:VeyraPaymentRequest|null;
 onClearVerified?:()=>void;onRecipientUsed?:()=>void;
 onVerifiedSelected?:(recipient:VerifiedMainnetRecipient)=>void;
 onDirectPay?:()=>void;
}){
 const {address,connector}=useAccount();
 const social=useUnifiedSocial();
 const signedWallet=social.identityOrigin==='ready'&&
  isMainnetSessionForWallet(social.session,address,connector?.uid);
 const owner=(address??'').toLowerCase();
 const arcClient=usePublicClient({chainId:5042});
 const [gasPrice,setGasPrice]=useState<bigint|null>(null);
 useEffect(()=>{
  if(!address||!arcClient){setGasPrice(null);return;}
  let active=true;
  const refresh=()=>{void arcClient.getGasPrice().then(x=>{if(active)setGasPrice(x);})
   .catch(()=>{if(active)setGasPrice(null);});};
  refresh();
  const timer=window.setInterval(refresh,25000);
  window.addEventListener('focus',refresh);
  return()=>{active=false;window.clearInterval(timer);window.removeEventListener('focus',refresh);};
 },[address,arcClient]);
 const registry=getVeyraSettlementDeployment(5042);
 const {data:protocolFeeBps}=useReadContract({
  address:registry?.address,abi:VEYRA_SETTLEMENT_ABI,functionName:'feeBps',
  chainId:5042,query:{enabled:!!address&&!!registry,staleTime:25000,refetchInterval:30000},
 });
 const {data:walletBalance,isError:balanceError,isLoading:balanceLoading}=useReadContract({
  address:ARC_MAINNET_USDC,abi:erc20Abi,functionName:'balanceOf',
  args:address?[address]:undefined,chainId:5042,
  query:{enabled:!!address,staleTime:10000,refetchInterval:15000},
 });
 const [draftHolder,setDraftHolder]=useState<{owner:string;value:MainnetPayDraft}>(()=>({owner,value:readPayDraft(owner)}));
 const [revision,setRevision]=useState(0);
 const {data:arcGas,isError:gasError}=useBalance({address,chainId:5042,
  query:{enabled:!!address,staleTime:10000,refetchInterval:15000}});
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
 const fundingQuote=arcSharedUsdcFunding({
  gross:draft.amount,nativeBalanceWei:arcGas?.value??null,
  erc20BalanceMicro:walletBalance??null,gasPriceWei:gasPrice,
 });
 const shortfall=fundingQuote?.shortfall??null;
 const needsFunding=shortfall!==null&&shortfall!=='0';
 const settlementCost=quoteSettlementProtocolNet(draft.amount,
  typeof protocolFeeBps==='bigint'?protocolFeeBps:null);
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
 const token=social.session?.token;
 const scope=owner+':'+(signedWallet?token??'':'');
 const [remote,setRemote]=useState<{
  scope:string;status:'checking'|'ready'|'unavailable';
  journey:ServerPayJourney|null;
 }>({scope:'',status:'checking',journey:null});
 useEffect(()=>{
  if(!signedWallet||!address||!token){setRemote({scope:'',status:'checking',journey:null});return;}
  let live=true;
  const activeScope=address.toLowerCase()+':'+token;
  setRemote({scope:activeScope,status:'checking',journey:null});
  const refresh=()=>{
   void readServerPayJourney(token,address).then(journey=>{
    if(live)setRemote({scope:activeScope,status:'ready',journey});
   }).catch(()=>{
    if(live)setRemote({scope:activeScope,status:'unavailable',journey:null});
   });
  };
  refresh();
  const timer=window.setInterval(refresh,20000);
  window.addEventListener('focus',refresh);
  window.addEventListener('veyra:pay:funding',refresh);
  window.addEventListener('veyra:mainnet:server-receipt',refresh);
  return()=>{live=false;window.clearInterval(timer);
   window.removeEventListener('focus',refresh);
   window.removeEventListener('veyra:pay:funding',refresh);
   window.removeEventListener('veyra:mainnet:server-receipt',refresh);
  };
 },[address,signedWallet,token]);
 const currentRemote=remote.scope===scope?remote:null;
 const fundingRead=address?readPayFundingJourney(address):{kind:'empty' as const};
 const fundingGateway=address?readGatewayMainnetOperation(address):null;
 const fundingHistory=address?readGatewayMainnetHistory(address):[];
 const fundingJourney=fundingRead.kind==='active'?fundingRead.value:null;
 const remoteVerified=Boolean(fundingJourney&&currentRemote?.status==='ready'&&
  currentRemote.journey?.status==='SETTLEMENT_VERIFIED'&&
  currentRemote.journey.journeyId===fundingJourney.id&&
  currentRemote.journey.ownerWallet.toLowerCase()===owner&&
  currentRemote.journey.payeeWallet.toLowerCase()===fundingJourney.payee.toLowerCase()&&
  currentRemote.journey.amountRaw===parseUnits(fundingJourney.grossUsdc,6).toString()&&
  currentRemote.journey.gatewayOperationId===fundingJourney.fundingOperationId&&
  currentRemote.journey.paymentRef.toLowerCase()===(paymentRequest?
   paymentRequest.paymentRef:genericPayFundingRef(fundingJourney.id)).toLowerCase());
 const remotePending=currentRemote?.status==='ready'&&currentRemote.journey?.status==='RESERVED'?
  currentRemote.journey:null;
 const remoteMismatch=remotePending!==null&&
  (!fundingJourney||remotePending.journeyId!==fundingJourney.id||
   remotePending.ownerWallet.toLowerCase()!==owner||
   remotePending.payeeWallet.toLowerCase()!==fundingJourney.payee.toLowerCase()||
   remotePending.amountRaw!==parseUnits(fundingJourney.grossUsdc,6).toString()||
   (fundingJourney.fundingOperationId!==undefined&&
    remotePending.gatewayOperationId!==fundingJourney.fundingOperationId));
 const remoteReady=currentRemote?.status==='ready'&&!remoteMismatch;
 const fundingState:FundingJourneyState=fundingJourney?
  derivePayFundingJourneyState({journey:fundingJourney,gatewayOperation:fundingGateway,
   history:fundingHistory,settlement:address?readSettlementIntent(address):{kind:'empty'},
   arcWalletUsdc:walletBalance===undefined?null:walletBalance,
   serverSettlementVerified:remoteVerified}):
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
 const showSettlement=remoteReady&&(recoveringSettlement||!fundingBlocked)&&
  (recoveringSettlement||!showUnifiedFunding||
   (fundingJourney?settlementFromUnifiedReady:!unifiedNeedsFunding))&&
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
 return <main className="veyra-page veyra-pay-page mx-auto w-full max-w-[620px] space-y-4 px-4 py-6 md:py-9">
  {address&&signedWallet&&<MainnetPayFundingRecoveryWorker/>}
  <header>
   <h1 className="veyra-page-title">Pay</h1>
   <p className="veyra-page-subtitle">Send USDC to someone you trust.</p>
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
  {signedWallet&&address&&!remoteReady&&<p role="alert"
    className="rounded-xl border p-3 text-sm" style={{borderColor:"var(--border)",color:"var(--warning)"}}>
    {remoteMismatch?
     'Another device already has a payment journey. The original proof can be inspected, but no new signature is allowed.':
     'Cross-device coordination is unavailable. Signing is paused to prevent duplicate transfers.'}
   </p>}
  {locked&&!resumable&&<p role="status" className="rounded-xl border p-3 text-sm"
   style={{borderColor:'var(--border)',color:'var(--warning)'}}>
   Payment still processing. Check Activity before trying again.
  </p>}
  {address&&signedWallet&&!paymentRequest&&onDirectPay&&<div className="flex items-center justify-between gap-3 text-xs">
   <p style={{color:'var(--muted)'}}>Prefer a wallet transfer without the Settlement contract?</p>
   <button type="button"
    disabled={MAINNET_EMERGENCY_READ_ONLY||address.toLowerCase()!==MAINNET_CANARY_OWNER.toLowerCase()||
     !remoteReady||!!remotePending||locked||fundingRead.kind!=='empty'}
    onClick={onDirectPay}
    className="veyra-btn-secondary min-h-10 shrink-0 px-3 text-xs disabled:opacity-45">
    Direct USDC · pilot
   </button>
  </div>}
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
  {draft.amount&&<section aria-label="Pay preview" className="rounded-xl border p-3 space-y-1"
    style={{borderColor:"var(--border)",color:"var(--muted)"}}>
    <p className="font-semibold text-sm" style={{color:"var(--ink)"}}>Payment preview</p>
    <div className="flex justify-between gap-3 text-xs"><span>You pay</span><span>{draft.amount} USDC</span></div>
    <div className="flex justify-between gap-3 text-xs"><span>Settlement fee</span>
     <span>{settlementCost?settlementCost.protocolFee+' USDC':'Checking live fee…'}</span></div>
    <div className="flex justify-between gap-3 text-sm font-semibold" style={{color:"var(--ink)"}}>
     <span>Recipient receives</span><span>{settlementCost?settlementCost.recipientNet+' USDC':'—'}</span></div>
    <p className="text-xs">Final Review refreshes gas, fees, allowances and contract simulation.</p>
   </section>}
  <details className="border-t pt-3 text-xs" style={{borderColor:'var(--border)',color:'var(--muted)'}}>
   <summary className="flex cursor-pointer items-center gap-2 font-semibold" style={{color:'var(--muted)'}}>
    <ShieldCheck className="size-4"/>Fees & payment safety
   </summary>
   <p className="mt-2 leading-5">
    Wallet and Friends use the same Veyra Settlement contract. Review recipient, platform fee, network gas and token approval in the final wallet review. No escrow or automatic refund.
   </p>
  </details>
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
      Native Arc gas and ERC-20 USDC are the same underlying balance.
      Gateway fees are separate. Settlement protocol fee is deducted from gross.
      A provisional gas reserve is checked again during the final Settlement Review.
      {gasError?' Arc balance lookup unavailable.':arcGas===undefined?
       ' Checking Arc USDC balance.':''}
     </p>
     {fundingQuote&&<div className="rounded-lg p-3 space-y-1 text-xs"
      style={{background:"var(--surface-raised)"}}>
      <div className="flex justify-between gap-2"><span>Payment gross</span><span>{fundingQuote.paymentGross} USDC</span></div>
      <div className="flex justify-between gap-2"><span>Provisional Arc gas reserve</span><span>{fundingQuote.gasReserve} USDC</span></div>
      <div className="flex justify-between gap-2 font-semibold"><span>Minimum Arc balance before Review</span>
       <span>{fundingQuote.minimumTotal} USDC</span></div>
      <p>Planning buffer only; gas can change before signature.</p>
     </div>}
     {shortfall===null?<p role="status" className="text-xs" style={{color:"var(--warning)"}}>
       Arc balance or gas price could not be verified, or native/ERC-20 views disagree. Funding is paused.
      </p>:!needsFunding?<p role="status" className="text-xs" style={{color:"var(--success)"}}>
       Arc wallet covers payment gross plus provisional gas. Final Review checks actual fees.
      </p>:<>
       <p className="text-sm font-semibold">Arc shortfall including gas reserve: {shortfall} USDC</p>
       <p className="text-xs" style={{color:"var(--muted)"}}>
        Gateway fees are additional. The quoted net amount must cover this shortfall before any funding signature.
        After a verified Gateway receipt, wallet balance and Settlement fees are checked again.
       </p>
       {fundingJourney&&fundingState!=='NOT_STARTED'&&fundingState!=='FUNDING_DECLINED'&&fundingState!=='FUNDING_REVERTED'?
        <p className="text-xs" style={{color:"var(--warning)"}}>
         A funding attempt is already recorded. Follow its original transaction in Activity; no retry is initiated.
        </p>:
        remoteReady?
        <MainnetUnifiedBalancePanel fundingToWallet={address} fundingNeeded={shortfall}
         fundingTarget={{payee:draft.recipient,grossUsdc:draft.amount,
          ...(paymentRequest?{requestId:paymentRequest.requestId}:{})}}/>:
        <p role="alert" className="text-xs" style={{color:"var(--warning)"}}>
         Funding is paused until the backend confirms no other device reserved this payment.
        </p>}
      </>}
    </>}
   </section>}
   {payLocked?<p role="status" className="rounded-xl border p-3 text-sm"
    style={{borderColor:'var(--border)',color:'var(--warning)'}}>
    Previous wallet payment is pending or unknown. Check Activity; do not sign another payment.
   </p>:!showSettlement?<p role="status" className="rounded-xl border p-3 text-sm"
    style={{borderColor:"var(--border)",color:!address?'var(--muted)':'var(--warning)' }}>
    {!address?'Connect a wallet to review this payment.':
     !signedWallet?'Sign in to your Veyra ID to review payment details.':
     fundingState==='SETTLEMENT_ONCHAIN_VERIFIED'?
     'Settlement verified onchain. Check Activity for synced sender and recipient receipts; do not send again.':
     'Complete or recover the original Unified funding journey before signing Settlement. No automatic resend.'}
   </p>:<section aria-label="Contract payment">
    <SettlementPage key={owner+":"+(paymentRequest?.requestId??"")} embedded sharedDraft={draft} onDraftChange={changeDraft}
      verifiedRecipient={selectedVerified} paymentRequest={paymentRequest}
      journeyRef={fundingJourney&&!paymentRequest?genericPayFundingRef(fundingJourney.id):undefined}/>
   </section>}
  </div>
 </main>;
}
