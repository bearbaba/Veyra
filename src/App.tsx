/**
 * Veyra — The Intelligent Money Layer on Arc
 *
 * Root composition. App shell + page routing.
 * All navigation state lives here so pages can cross-navigate.
 */

import { useState } from 'react';
import { AppShell } from './components/layout/AppShell';
import type { VeyraPage } from './components/layout/AppShell';
import { HomePage }     from './components/pages/HomePage';
import { AgentPage }    from './components/pages/AgentPage';
import { PayPage }      from './components/pages/PayPage';
import { ConvertPage }  from './components/pages/ConvertPage';
import { BridgePage }   from './components/pages/BridgePage';
import { ActivityPage } from './components/pages/ActivityPage';
import { SettingsPage } from './components/pages/SettingsPage';
import { CctpE2EPage }  from './components/dev/CctpE2EPage';

// Dev-only pages are accessible but not listed in production nav
const IS_DEV = import.meta.env.DEV === true;

export default function App() {
  const [page, setPage] = useState<VeyraPage>('home');

  function renderPage() {
    switch (page) {
      case 'home':     return <HomePage     onNavigate={setPage} />;
      case 'agent':    return <AgentPage    onNavigate={setPage} />;
      case 'pay':      return <PayPage />;
      case 'convert':  return <ConvertPage />;
      case 'bridge':   return <BridgePage />;
      case 'activity': return <ActivityPage />;
      case 'settings': return <SettingsPage />;
      // Dev-only validation pages — not in production nav
      case 'dev-cctp-e2e' as VeyraPage:
        return IS_DEV ? <CctpE2EPage /> : <HomePage onNavigate={setPage} />;
      default:         return <HomePage     onNavigate={setPage} />;
    }
  }

  return (
    <AppShell page={page} onNavigate={setPage}>
      {renderPage()}
      {/* Dev navigation shortcut — only in DEV mode */}
      {IS_DEV && page !== ('dev-cctp-e2e' as VeyraPage) && (
        <div
          className="fixed bottom-20 right-4 z-50"
          title="Developer: CCTP V2 E2E Validation"
        >
          <button
            onClick={() => setPage('dev-cctp-e2e' as VeyraPage)}
            className="text-xs px-3 py-1.5 rounded-full font-mono font-semibold shadow-lg"
            style={{ background: 'var(--accent)', color: '#0d1b2f', border: '1px solid var(--border-strong)' }}
          >
            DEV: CCTP E2E
          </button>
        </div>
      )}
      {IS_DEV && page === ('dev-cctp-e2e' as VeyraPage) && (
        <div className="fixed bottom-20 right-4 z-50">
          <button
            onClick={() => setPage('home')}
            className="text-xs px-3 py-1.5 rounded-full font-mono font-semibold shadow-lg"
            style={{ background: 'var(--surface)', color: 'var(--muted)', border: '1px solid var(--border)' }}
          >
            ← Back to app
          </button>
        </div>
      )}
    </AppShell>
  );
}
