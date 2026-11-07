/**
 * Veyra — The Intelligent Money Layer on Arc
 *
 * Production root composition. DEV tooling is deliberately excluded from this
 * module and is served only through the separate dev.html entrypoint.
 */

import { useCallback,useEffect,useState } from 'react';
import {useAccount} from 'wagmi';
import { AppShell } from './components/layout/AppShell';
import type { VeyraPage } from './components/layout/AppShell';
import { HomePage } from './components/pages/HomePage';
import { MainnetHomePage } from './components/pages/MainnetHomePage';
import { AgentPage } from './components/pages/AgentPage';
import { PayPage } from './components/pages/PayPage';
import { ConvertPage } from './components/pages/ConvertPage';
import { BridgePage } from './components/pages/BridgePage';
import { ActivityPage } from './components/pages/ActivityPage';
import { MainnetActivityPage } from './components/pages/MainnetActivityPage';
import { UiOnlyPreviewPage } from './components/pages/UiOnlyPreviewPage';
import { IS_UI_ONLY_PREVIEW } from './lib/env';
import { SettingsPage } from './components/pages/SettingsPage';
import {readPayDraft,writePayDraft} from '@/mainnet/payDraft';
import {reviewPeerRequest,type VeyraPaymentRequest} from '@/lib/api/paymentRequests';
import {readRequestNavigation,saveRequestNavigation,clearRequestNavigation} from '@/mainnet/paymentRequestNavigation';
import {lookupMainnetRecipient} from '@/mainnet/recipientLookup';
import {useUnifiedSocial} from '@/features/social/UnifiedSocial';
import {isMainnetSessionForWallet} from '@/mainnet/signedWalletReceiptScope';
import { SocialPage } from './components/pages/SocialPage';
import { SettlementPage } from './components/pages/SettlementPage';
import { MainnetPayHub } from './components/pages/MainnetPayHub';
import { MainnetExchangePage } from './components/pages/MainnetExchangePage';
import {MainnetSoonPage} from './components/pages/MainnetSoonPage';
import { MainnetPeoplePage } from './components/pages/MainnetPeoplePage';
import type {VerifiedMainnetRecipient} from './mainnet/verifiedRecipient';
import { VEYRA_ENV } from './lib/env';
import { UnifiedSocialProvider } from './features/social/UnifiedSocial';
import {MainnetReceiptSyncWorker} from './mainnet/MainnetReceiptSyncWorker';
import {MainnetSettlementReceiptSyncWorker} from './mainnet/MainnetSettlementReceiptSyncWorker';

const sharedVeyraProfile=()=>{
  if(typeof window==='undefined')return '';
  const v=new URLSearchParams(window.location.search).get('veyra')??'';
  return /^@[a-z0-9_-]{2,32}\\.veyra$/i.test(v)?v:'';
};
/** Restore navigation only after BOTH the signed payer session and current
 * receiving wallet are verified again. The session bookmark is never a claim.
 */
function RestoreSignedPaymentRequest({onRecovered}:{
 onRecovered:(recipient:VerifiedMainnetRecipient,request:VeyraPaymentRequest)=>void;
}){
 const {address,connector}=useAccount();
 const social=useUnifiedSocial();
 const [notice,setNotice]=useState<string|null>(null);
 const token=social.session?.token;
 const userId=social.session?.profile.veyraUserId;
 const trusted=!!address&&social.identityOrigin==='ready'&&
  isMainnetSessionForWallet(social.session,address,connector?.uid);
 useEffect(()=>{
  if(VEYRA_ENV!=='mainnet'||!address||!token||!userId||!trusted)return;
  const saved=readRequestNavigation(address);
  if(!saved)return;
  if(saved.payerUserId!==userId){clearRequestNavigation(address);return;}
  let live=true;
  void (async()=>{
   const request=await reviewPeerRequest(token,saved.requestId);
   if(request.payerUserId!==userId||request.requesterUserId!==saved.requesterUserId||
    request.requestId!==saved.requestId||request.status!=='PENDING')
    throw Error('Saved request no longer matches this Veyra ID.');
   const found=await lookupMainnetRecipient('@'+saved.requesterHandle+'.veyra',address,token);
   if(found.kind!=='veyra'||found.person.veyraUserId!==request.requesterUserId||
    found.person.wallet.toLowerCase()!==request.recipientWallet.toLowerCase())
    throw Error('Payment Request payee changed. Open Chat to review again.');
   if(live){setNotice(null);onRecovered(found.person,request);}
  })().catch((e:unknown)=>{
   if(live)setNotice(e instanceof Error?e.message:'Saved request could not be restored.');
  });
  return()=>{live=false;};
 },[address,connector?.uid,token,userId,trusted,onRecovered]);
 return notice?<p role="status" className="mx-auto max-w-2xl px-4 py-2 text-xs"
  style={{color:'var(--warning)'}}>Saved payment needs a fresh check: {notice}
  {' '}Open Chat to review again. No payment was sent.</p>:null;
}

export default function App() {
  const {address}=useAccount();
  const [profileSearch]=useState(sharedVeyraProfile);
  // OAuth success is only a UI navigation hint; it is NEVER authentication.
  // The wallet-bound server profile will be independently restored after F5.
  const [page, setPageState] = useState<VeyraPage>(()=>
    typeof window!=='undefined'&&new URLSearchParams(window.location.search).get('x_linked')==='1'?'settings':profileSearch?'social':'home');
  useEffect(()=>{
    const params=new URLSearchParams(window.location.search);
    if(params.has('x_linked')||params.has('veyra')){
      params.delete('x_linked');params.delete('veyra');
      window.history.replaceState(window.history.state,'',window.location.pathname+(params.size?'?'+params.toString():''));
    }
  },[]);
  function setPage(next:VeyraPage){
    const target=VEYRA_ENV==='mainnet'&&next==='pay'?'settlement':next;
    if(VEYRA_ENV==='mainnet'&&target!=='settlement'){
      if(address)clearRequestNavigation(address);
      setPaymentRequest(null);setVerifiedRecipient(null);setContactRecipient(null);
    }
    setPageState(target);
  }
  const [friendPayment, setFriendPayment] = useState<string | null>(null);
  const [contactRecipient, setContactRecipient] = useState<string | null>(null);
  const [verifiedRecipient,setVerifiedRecipient] = useState<VerifiedMainnetRecipient|null>(null);
 const [paymentRequest,setPaymentRequest]=useState<VeyraPaymentRequest|null>(null);
 const onRecoveredRequest=useCallback((recipient:VerifiedMainnetRecipient,request:VeyraPaymentRequest)=>{
  setPaymentRequest(request);setContactRecipient(null);setVerifiedRecipient(recipient);
  setFriendPayment(null);setPageState('settlement');
 },[]);

  function startFriendPayment(handle: string) {
    // A friendly label is only a suggestion. Pay resolves a fresh 30-second
    // verified recipient snapshot and requires normal wallet review/signing.
    // A pending AI intent must never overwrite an explicitly chosen friend.
    sessionStorage.removeItem('veyra:agent-intent');
    setFriendPayment(handle);
    setPage('pay');
  }

  function renderPage() {
    switch (page) {
      case 'home':
        return VEYRA_ENV === 'mainnet' ? <MainnetHomePage onNavigate={setPage} /> : <HomePage onNavigate={setPage} />;
      case 'agent':
        return VEYRA_ENV==='mainnet'?<MainnetSoonPage feature="Agent"/>:<AgentPage onNavigate={setPage} />;
      case 'exchange':
        return <MainnetSoonPage feature="Exchange"/>;
      case 'pay':
        return VEYRA_ENV === 'mainnet' ? <MainnetPayHub recipientWallet={contactRecipient}
          verifiedRecipient={verifiedRecipient} paymentRequest={paymentRequest} onClearVerified={()=>{setVerifiedRecipient(null);setPaymentRequest(null);
           if(address)clearRequestNavigation(address);}}
          onRecipientUsed={() => setContactRecipient(null)} /> : IS_UI_ONLY_PREVIEW ? <UiOnlyPreviewPage surface="pay" /> : <PayPage friendRecipient={friendPayment} onFriendRecipientUsed={() => setFriendPayment(null)} />;
      case 'convert':
        return VEYRA_ENV === 'mainnet' ? <MainnetExchangePage /> : IS_UI_ONLY_PREVIEW ? <UiOnlyPreviewPage surface="convert" /> : <ConvertPage />;
      case 'bridge':
        return VEYRA_ENV === 'mainnet' ? <MainnetExchangePage initialBridge /> : IS_UI_ONLY_PREVIEW ? <UiOnlyPreviewPage surface="bridge" /> : <BridgePage />;
      case 'activity':
        return VEYRA_ENV === 'mainnet' ? <MainnetActivityPage onPay={() => setPage('settlement')} onNavigate={setPage} /> : <ActivityPage readOnly={IS_UI_ONLY_PREVIEW} />;
      case 'settings':
        return <SettingsPage onOpenSocial={() => setPage('social')} />;
      case 'social':
        return (VEYRA_ENV === 'mainnet' ? <MainnetPeoplePage initialQuery={profileSearch} onPayVerified={(recipient,intent)=>{
            if(intent==='tip')writePayDraft(recipient.owner,{...readPayDraft(recipient.owner),
             recipient:recipient.wallet,amount:'',note:'Tip'});
            if(address)clearRequestNavigation(address);
            setPaymentRequest(null);setContactRecipient(null);setVerifiedRecipient(recipient);setFriendPayment(null);setPage('settlement');
          }} onPayRequest={(recipient,request)=>{
            if(address)saveRequestNavigation({
              version:1,owner:address.toLowerCase(),requestId:request.requestId,
              requesterHandle:recipient.veyraHandle,requesterUserId:request.requesterUserId,
              payerUserId:request.payerUserId,savedAt:Date.now(),
            });
            setPaymentRequest(request);setContactRecipient(null);
            setVerifiedRecipient(recipient);setFriendPayment(null);setPage('settlement');
          }} onPayWallet={recipient=>{
            if(address)clearRequestNavigation(address);
            setPaymentRequest(null);setVerifiedRecipient(null);setContactRecipient(recipient);setFriendPayment(null);setPage('settlement');
          }}/> : <SocialPage onPayFriend={startFriendPayment} />);
      case 'settlement':
        return VEYRA_ENV === 'mainnet' ? <MainnetPayHub recipientWallet={contactRecipient}
          verifiedRecipient={verifiedRecipient} paymentRequest={paymentRequest} onClearVerified={()=>{setVerifiedRecipient(null);setPaymentRequest(null);
           if(address)clearRequestNavigation(address);}}
          onRecipientUsed={() => setContactRecipient(null)} /> : <SettlementPage />;
      default:
        return <HomePage onNavigate={setPage} />;
    }
  }

  return (
    <UnifiedSocialProvider>
      {VEYRA_ENV==='mainnet'&&<><MainnetReceiptSyncWorker/><MainnetSettlementReceiptSyncWorker/></>}
      <AppShell page={page} onNavigate={setPage}>
        {VEYRA_ENV==='mainnet'&&<RestoreSignedPaymentRequest onRecovered={onRecoveredRequest}/>}
        {renderPage()}
      </AppShell>
    </UnifiedSocialProvider>
  );
}
