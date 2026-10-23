/**
 * Veyra — The Intelligent Money Layer on Arc
 *
 * Production root composition. DEV tooling is deliberately excluded from this
 * module and is served only through the separate dev.html entrypoint.
 */

import { useState } from 'react';
import { AppShell } from './components/layout/AppShell';
import type { VeyraPage } from './components/layout/AppShell';
import { HomePage } from './components/pages/HomePage';
import { AgentPage } from './components/pages/AgentPage';
import { PayPage } from './components/pages/PayPage';
import { ConvertPage } from './components/pages/ConvertPage';
import { BridgePage } from './components/pages/BridgePage';
import { ActivityPage } from './components/pages/ActivityPage';
import { UiOnlyPreviewPage } from './components/pages/UiOnlyPreviewPage';
import { IS_UI_ONLY_PREVIEW } from './lib/env';
import { SettingsPage } from './components/pages/SettingsPage';
import { SocialPage } from './components/pages/SocialPage';
import { UnifiedSocialProvider } from './features/social/UnifiedSocial';

export default function App() {
  const [page, setPage] = useState<VeyraPage>('home');
  const [friendPayment, setFriendPayment] = useState<string | null>(null);

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
        return <HomePage onNavigate={setPage} />;
      case 'agent':
        return <AgentPage onNavigate={setPage} />;
      case 'pay':
        return IS_UI_ONLY_PREVIEW ? <UiOnlyPreviewPage surface="pay" /> : <PayPage friendRecipient={friendPayment} onFriendRecipientUsed={() => setFriendPayment(null)} />;
      case 'convert':
        return IS_UI_ONLY_PREVIEW ? <UiOnlyPreviewPage surface="convert" /> : <ConvertPage />;
      case 'bridge':
        return IS_UI_ONLY_PREVIEW ? <UiOnlyPreviewPage surface="bridge" /> : <BridgePage />;
      case 'activity':
        return <ActivityPage readOnly={IS_UI_ONLY_PREVIEW} />;
      case 'settings':
        return <SettingsPage onOpenSocial={() => setPage('social')} />;
      case 'social':
        return <SocialPage onPayFriend={startFriendPayment} />;
      default:
        return <HomePage onNavigate={setPage} />;
    }
  }

  return (
    <UnifiedSocialProvider>
      <AppShell page={page} onNavigate={setPage}>
        {renderPage()}
      </AppShell>
    </UnifiedSocialProvider>
  );
}
