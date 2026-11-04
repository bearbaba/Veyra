/**
 * Veyra — The Intelligent Money Layer on Arc
 *
 * Production root composition. DEV tooling is deliberately excluded from this
 * module and is served only through the separate dev.html entrypoint.
 */

import { useEffect,useState } from 'react';
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
export default function App() {
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
  const setPage=(next:VeyraPage)=>setPageState(VEYRA_ENV==='mainnet'&&next==='pay'?'settlement':next);
  const [friendPayment, setFriendPayment] = useState<string | null>(null);
  const [contactRecipient, setContactRecipient] = useState<string | null>(null);
  const [verifiedRecipient,setVerifiedRecipient] = useState<VerifiedMainnetRecipient|null>(null);

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
        return VEYRA_ENV === 'mainnet' ? <MainnetPayHub initialMethod="contract" friendHandle={friendPayment} recipientWallet={contactRecipient}
          verifiedRecipient={verifiedRecipient} onClearVerified={()=>setVerifiedRecipient(null)}
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
        return (VEYRA_ENV === 'mainnet' ? <MainnetPeoplePage initialQuery={profileSearch} onPayVerified={recipient=>{
            setContactRecipient(null);setVerifiedRecipient(recipient);setFriendPayment(null);setPage('settlement');
          }} onPayWallet={recipient=>{
            setVerifiedRecipient(null);setContactRecipient(recipient);setFriendPayment(null);setPage('settlement');
          }}/> : <SocialPage onPayFriend={startFriendPayment} />);
      case 'settlement':
        return VEYRA_ENV === 'mainnet' ? <MainnetPayHub initialMethod="contract" friendHandle={friendPayment} recipientWallet={contactRecipient}
          verifiedRecipient={verifiedRecipient} onClearVerified={()=>setVerifiedRecipient(null)}
          onRecipientUsed={() => setContactRecipient(null)} /> : <SettlementPage />;
      default:
        return <HomePage onNavigate={setPage} />;
    }
  }

  return (
    <UnifiedSocialProvider>
      {VEYRA_ENV==='mainnet'&&<><MainnetReceiptSyncWorker/><MainnetSettlementReceiptSyncWorker/></>}
      <AppShell page={page} onNavigate={setPage}>
        {renderPage()}
      </AppShell>
    </UnifiedSocialProvider>
  );
}
