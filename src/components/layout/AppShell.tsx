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
} from 'lucide-react';
import { CommandBar } from '../command/CommandBar';
import { WebPreviewBanner } from '../system/WebPreviewBanner';
import { NotificationBell } from '../../features/social/NotificationBell';

export type VeyraPage = 'home' | 'agent' | 'pay' | 'convert' | 'bridge' | 'activity' | 'social' | 'settings';

interface NavItem {
  id: VeyraPage;
  label: string;
  icon: React.ReactNode;
}

const PRIMARY_NAV: NavItem[] = [
  { id: 'home', label: 'Home', icon: <Home className="size-5" /> },
  { id: 'pay', label: 'Pay', icon: <SendHorizontal className="size-5" /> },
  { id: 'agent', label: 'Agent', icon: <Bot className="size-5" /> },
  { id: 'activity', label: 'Activity', icon: <LayoutList className="size-5" /> },
  { id: 'social', label: 'Friends', icon: <Users className="size-5" /> },
];

const SETTINGS_NAV: NavItem = { id: 'settings', label: 'Settings', icon: <Settings className="size-5" /> };

interface AppShellProps {
  page: VeyraPage;
  onNavigate: (page: VeyraPage) => void;
  children: React.ReactNode;
}

export function AppShell({ page, onNavigate, children }: AppShellProps) {
  const [cmdOpen, setCmdOpen] = useState(false);

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
    <div className="flex h-dvh w-full overflow-hidden">
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

        <div className="mt-auto space-y-1">
          <NavButton item={SETTINGS_NAV} active={page === 'settings'} onClick={() => onNavigate('settings')} />
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

      <main className="min-w-0 flex-1 flex flex-col overflow-hidden">
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
            <button
              onClick={() => onNavigate('settings')}
              className="rounded-xl p-2"
              style={{ background: page === 'settings' ? 'var(--accent-muted)' : 'var(--surface)', color: page === 'settings' ? 'var(--accent)' : 'var(--muted)', border: '1px solid var(--border)' }}
              aria-label="Settings"
            >
              <Settings className="size-4" />
            </button>
            <button
              onClick={() => setCmdOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium"
              style={{ background: 'var(--surface)', color: 'var(--muted)', border: '1px solid var(--border)' }}
            >
              <Command className="size-3.5" />
              Search
            </button>
          </div>
        </header>

        <div className="hidden md:flex items-center justify-end border-b px-5 py-2" style={{ borderColor: 'var(--border)' }}>
          <NotificationBell openSocial={() => onNavigate('social')} />
        </div>
        <WebPreviewBanner />

        <div className="min-h-0 flex-1 overflow-y-auto">
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

        <nav
          aria-label="Main navigation"
          className="md:hidden flex shrink-0 items-center border-t pb-[env(safe-area-inset-bottom)]"
          style={{ borderColor: 'var(--border)', background: 'rgba(13,27,47,0.92)', backdropFilter: 'blur(20px)' }}
        >
          {PRIMARY_NAV.map((item) => (
            <button
              key={item.id}
              aria-current={page === item.id ? 'page' : undefined}
              onClick={() => onNavigate(item.id)}
              className="flex-1 flex flex-col items-center gap-1 py-2.5 text-xs font-medium transition-colors"
              style={{ color: page === item.id ? 'var(--accent)' : 'var(--subtle)' }}
            >
              <span style={{ color: page === item.id ? 'var(--accent)' : 'var(--subtle)' }}>{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>
      </main>

      <CommandBar open={cmdOpen} onClose={() => setCmdOpen(false)} onNavigate={onNavigate} />
    </div>
  );
}

function NavButton({ item, active, onClick }: { item: NavItem; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
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
