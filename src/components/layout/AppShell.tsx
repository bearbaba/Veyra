/**
 * Veyra App Shell
 *
 * Human-first navigation: Home / Pay / Agent / Activity stay primary.
 * Advanced flows (Convert / Bridge) remain reachable through Agent/Command,
 * while Settings is deliberately secondary.
 */

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Home,
  Bot,
  SendHorizontal,
  LayoutList,
  Users,
  Settings,
  Command,
  Shield,
  ArrowLeftRight,
  Route,
  MoreHorizontal,
} from 'lucide-react';
import { CommandBar } from '../command/CommandBar';
import { WebPreviewBanner } from '../system/WebPreviewBanner';
import { NotificationBell } from '../../features/social/NotificationBell';
import { WalletAccountControls } from './WalletAccountControls';

export type VeyraPage = 'home' | 'agent' | 'pay' | 'convert' | 'bridge' | 'activity' | 'social' | 'settings' | 'settlement';

interface NavItem {
  id: VeyraPage;
  label: string;
  icon: React.ReactNode;
}

const PRIMARY_NAV: NavItem[] = [
  { id: 'home', label: 'Home', icon: <Home className="size-5" /> },
  { id: 'pay', label: 'Pay', icon: <SendHorizontal className="size-5" /> },
  { id: 'convert', label: 'Swap', icon: <ArrowLeftRight className="size-5" /> },
  { id: 'bridge', label: 'Bridge', icon: <Route className="size-5" /> },
  { id: 'agent', label: 'Agent', icon: <Bot className="size-5" /> },
  { id: 'activity', label: 'Activity', icon: <LayoutList className="size-5" /> },
];
const SECONDARY_NAV: NavItem[] = [
  { id: 'social', label: 'Friends', icon: <Users className="size-5" /> },
  { id: 'settlement', label: 'Settlement', icon: <Shield className="size-5" /> },
  { id: 'settings', label: 'Settings', icon: <Settings className="size-5" /> },
];
const MOBILE_NAV = PRIMARY_NAV.filter(item => ['home', 'pay', 'agent', 'activity'].includes(item.id));
const MOBILE_MORE_NAV = [...PRIMARY_NAV.filter(item => item.id === 'convert' || item.id === 'bridge'), ...SECONDARY_NAV];

interface AppShellProps {
  page: VeyraPage;
  onNavigate: (page: VeyraPage) => void;
  children: React.ReactNode;
}

export function AppShell({ page, onNavigate, children }: AppShellProps) {
  const [cmdOpen, setCmdOpen] = useState(false);
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const navigate = (next: VeyraPage) => { setMobileMoreOpen(false); onNavigate(next); };
  const moreActive = MOBILE_MORE_NAV.some(item => item.id === page);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setCmdOpen((open) => !open);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div className="flex min-h-dvh w-full">
      <aside
        className="hidden md:flex flex-col w-56 shrink-0 border-r px-3 py-5 gap-1"
        style={{ borderColor: 'var(--border)', background: 'rgba(13,27,47,0.85)', backdropFilter: 'blur(24px)' }}
      >
        <div className="flex items-center gap-2.5 px-3 mb-6">
          <VeyraLogoMark />
          <span className="display text-lg font-bold" style={{ color: 'var(--ink)' }}>Veyra</span>
        </div>

        {PRIMARY_NAV.map((item) => (
          <NavButton key={item.id} item={item} active={page === item.id} onClick={() => onNavigate(item.id)} />
        ))}

        <div className="mt-4 border-t pt-3 space-y-1" style={{borderColor:'var(--border)'}}>
          {SECONDARY_NAV.map(item => (
            <NavButton key={item.id} item={item} active={page === item.id} onClick={() => navigate(item.id)} />
          ))}
        </div>
        <div className="mt-auto space-y-1">
          <button
            onClick={() => setCmdOpen(true)}
            className="flex w-full items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors hover:bg-white/5"
            style={{ color: 'var(--subtle)' }}
          >
            <Command className="size-4" />
            <span>Command</span>
            <kbd
              className="ml-auto text-xs px-1.5 py-0.5 rounded-md font-mono"
              style={{ background: 'var(--surface)', color: 'var(--subtle)', border: '1px solid var(--border)' }}
            >
              ⌘K
            </kbd>
          </button>
        </div>
      </aside>

      <main className="flex-1 flex flex-col min-h-dvh overflow-hidden">
        <header
          className="md:hidden flex items-center justify-between px-4 py-3 border-b"
          style={{ borderColor: 'var(--border)', background: 'rgba(13,27,47,0.90)', backdropFilter: 'blur(20px)' }}
        >
          <div className="flex items-center gap-2">
            <VeyraLogoMark />
            <span className="display font-bold" style={{ color: 'var(--ink)' }}>Veyra</span>
          </div>
          <div className="flex items-center gap-2">
            <NotificationBell openSocial={() => onNavigate('social')} />
            <WalletAccountControls compact />
            <button
              onClick={() => onNavigate('settings')}
              className="rounded-xl p-2"
              style={{ background: page === 'settings' ? 'var(--accent-muted)' : 'var(--surface)', color: page === 'settings' ? 'var(--accent)' : 'var(--muted)', border: '1px solid var(--border)' }}
              aria-label="Settings"
            >
              <Settings className="size-4" />
            </button>
           </div>
        </header>

        <div className="hidden md:flex items-center justify-end gap-3 border-b px-5 py-2" style={{ borderColor: 'var(--border)' }}>
          <WalletAccountControls />
          <NotificationBell openSocial={() => onNavigate('social')} />
        </div>
        <WebPreviewBanner />

        <div className="flex-1 overflow-y-auto">
          <AnimatePresence mode="wait">
            <motion.div
              key={page}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              className="h-full"
            >
              {children}
            </motion.div>
          </AnimatePresence>
        </div>

        {mobileMoreOpen && (
          <div role="region" aria-label="More Veyra features" className="md:hidden grid grid-cols-2 gap-2 border-t p-3"
            style={{borderColor:'var(--border)',background:'var(--surface-strong)'}}>
            {MOBILE_MORE_NAV.map(item => (
              <button type="button" key={item.id} onClick={() => navigate(item.id)}
                className="flex min-w-0 items-center gap-2 rounded-xl border px-3 py-3 text-sm font-semibold"
                style={{borderColor:'var(--border)',color:page===item.id?'var(--accent)':'var(--ink)'}}>
                {item.icon}<span>{item.label}</span>
              </button>
            ))}
          </div>
        )}
        <nav aria-label="Primary navigation"
          className="md:hidden flex items-center border-t"
          style={{ borderColor: 'var(--border)', background: 'rgba(13,27,47,0.92)', backdropFilter: 'blur(20px)' }}
        >
          {MOBILE_NAV.map((item) => (
            <button type="button"
              key={item.id}
              onClick={() => navigate(item.id)}
              className="flex min-w-0 flex-1 flex-col items-center gap-1 py-2.5 text-[11px] font-medium transition-colors"
              aria-current={page === item.id ? 'page' : undefined}
              style={{ color: page === item.id ? 'var(--accent)' : 'var(--subtle)' }}
            >
              <span style={{ color: page === item.id ? 'var(--accent)' : 'var(--subtle)' }}>{item.icon}</span>
              {item.label}
            </button>
          ))}
          <button type="button" onClick={() => setMobileMoreOpen(open => !open)} aria-expanded={mobileMoreOpen}
            aria-label="More Veyra features" className="flex min-w-0 flex-1 flex-col items-center gap-1 py-2.5 text-[11px] font-medium"
            style={{color:moreActive||mobileMoreOpen?'var(--accent)':'var(--subtle)'}}>
            <MoreHorizontal className="size-5"/>More
          </button>
        </nav>
      </main>

      <CommandBar open={cmdOpen} onClose={() => setCmdOpen(false)} onNavigate={navigate} />
    </div>
  );
}

function NavButton({ item, active, onClick }: { item: NavItem; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="relative flex w-full items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-all"
      style={{ color: active ? 'var(--accent)' : 'var(--muted)', background: active ? 'var(--accent-muted)' : 'transparent' }}
    >
      {active && (
        <motion.span layoutId="nav-indicator" className="absolute left-0 inset-y-2 w-0.5 rounded-r-full" style={{ background: 'var(--accent)' }} />
      )}
      <span style={{ color: active ? 'var(--accent)' : 'var(--muted)' }}>{item.icon}</span>
      {item.label}
    </button>
  );
}

function VeyraLogoMark() {
  return (
    <div className="flex size-7 items-center justify-center rounded-lg" style={{ background: 'var(--accent-muted)', border: '1px solid var(--border-strong)' }}>
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
        <circle cx="7" cy="7" r="5.5" stroke="var(--accent)" strokeWidth="1.5" />
        <circle cx="7" cy="7" r="2" fill="var(--accent)" />
      </svg>
    </div>
  );
}
