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
import { SettingsPage } from './components/pages/SettingsPage';

export default function App() {
  const [page, setPage] = useState<VeyraPage>('home');

  function renderPage() {
    switch (page) {
      case 'home':
        return <HomePage onNavigate={setPage} />;
      case 'agent':
        return <AgentPage onNavigate={setPage} />;
      case 'pay':
        return <PayPage />;
      case 'convert':
        return <ConvertPage />;
      case 'bridge':
        return <BridgePage />;
      case 'activity':
        return <ActivityPage />;
      case 'settings':
        return <SettingsPage />;
      default:
        return <HomePage onNavigate={setPage} />;
    }
  }

  return (
    <AppShell page={page} onNavigate={setPage}>
      {renderPage()}
    </AppShell>
  );
}
