/**
 * Veyra App Shell
 *
 * Top-level layout: sidebar nav (desktop) + bottom nav (mobile) + command bar trigger.
 * Renders the active page in the main content area.
 */

import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Home,
  Bot,
  SendHorizontal,
  ArrowLeftRight,
  LayoutList,
  Settings,
  Command,
} from 'lucide-react';
import { CommandBar } from '../command/CommandBar';

export type VeyraPage = 'home' | 'agent' | 'pay' | 'convert' | 'bridge' | 'activity' | 'settings';

interface NavItem {
  id: VeyraPage;
  label: string;
  icon: React.ReactNode;
}

const NAV: NavItem[] = [
  { id: 'home',     label: 'Home',     icon: <Home     className="size-5" /> },
  { id: 'agent',    label: 'Agent',    icon: <Bot      className="size-5" /> },
  { id: 'pay',      label: 'Pay',      icon: <SendHorizontal className="size-5" /> },
  { id: 'convert',  label: 'Convert',  icon: <ArrowLeftRight className="size-5" /> },
  { id: 'activity', label: 'Activity', icon: <LayoutList className="size-5" /> },
  { id: 'settings', label: 'Settings', icon: <Settings  className="size-5" /> },
];

interface AppShellProps {
  page: VeyraPage;
  onNavigate: (page: VeyraPage) => void;
  children: React.ReactNode;
}

export function AppShell({ page, onNavigate, children }: AppShellProps) {
  const [cmdOpen, setCmdOpen] = useState(false);

  return (
    <div className="flex min-h-dvh w-full">
      {/* ── Desktop sidebar ── */}
      <aside
        className="hidden md:flex flex-col w-56 shrink-0 border-r px-3 py-5 gap-1"
        style={{ borderColor: 'var(--border)', background: 'rgba(13,27,47,0.85)', backdropFilter: 'blur(24px)' }}
      >
        {/* Logo */}
        <div className="flex items-center gap-2.5 px-3 mb-6">
          <VeyraLogoMark />
          <span className="display text-lg font-bold" style={{ color: 'var(--ink)' }}>Veyra</span>
        </div>

        {/* Nav items */}
        {NAV.map((item) => (
          <NavButton
            key={item.id}
            item={item}
            active={page === item.id}
            onClick={() => onNavigate(item.id)}
          />
        ))}

        <div className="mt-auto" />

        {/* Command bar trigger */}
        <button
          onClick={() => setCmdOpen(true)}
          className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors hover:bg-white/5"
          style={{ color: 'var(--subtle)' }}
        >
          <Command className="size-4" />
          <span>Command</span>
          <kbd className="ml-auto text-xs px-1.5 py-0.5 rounded-md font-mono"
            style={{ background: 'var(--surface)', color: 'var(--subtle)', border: '1px solid var(--border)' }}>
            ⌘K
          </kbd>
        </button>
      </aside>

      {/* ── Main content ── */}
      <main className="flex-1 flex flex-col min-h-dvh overflow-hidden">
        {/* Mobile header */}
        <header className="md:hidden flex items-center justify-between px-4 py-3 border-b"
          style={{ borderColor: 'var(--border)', background: 'rgba(13,27,47,0.90)', backdropFilter: 'blur(20px)' }}>
          <div className="flex items-center gap-2">
            <VeyraLogoMark />
            <span className="display font-bold" style={{ color: 'var(--ink)' }}>Veyra</span>
          </div>
          <button
            onClick={() => setCmdOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium"
            style={{ background: 'var(--surface)', color: 'var(--muted)', border: '1px solid var(--border)' }}
          >
            <Command className="size-3.5" />
            Ask anything
          </button>
        </header>

        {/* Page content */}
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

        {/* Mobile bottom nav */}
        <nav className="md:hidden flex items-center border-t"
          style={{ borderColor: 'var(--border)', background: 'rgba(13,27,47,0.92)', backdropFilter: 'blur(20px)' }}>
          {NAV.map((item) => (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              className="flex-1 flex flex-col items-center gap-1 py-2.5 text-xs font-medium transition-colors"
              style={{ color: page === item.id ? 'var(--accent)' : 'var(--subtle)' }}
            >
              <span style={{ color: page === item.id ? 'var(--accent)' : 'var(--subtle)' }}>
                {item.icon}
              </span>
              {item.label}
            </button>
          ))}
        </nav>
      </main>

      {/* Command bar */}
      <CommandBar open={cmdOpen} onClose={() => setCmdOpen(false)} onNavigate={onNavigate} />
    </div>
  );
}

function NavButton({ item, active, onClick }: { item: NavItem; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="relative flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-all"
      style={{
        color: active ? 'var(--accent)' : 'var(--muted)',
        background: active ? 'var(--accent-muted)' : 'transparent',
      }}
    >
      {active && (
        <motion.span
          layoutId="nav-indicator"
          className="absolute left-0 inset-y-2 w-0.5 rounded-r-full"
          style={{ background: 'var(--accent)' }}
        />
      )}
      <span style={{ color: active ? 'var(--accent)' : 'var(--muted)' }}>{item.icon}</span>
      {item.label}
    </button>
  );
}

function VeyraLogoMark() {
  return (
    <div
      className="flex size-7 items-center justify-center rounded-lg"
      style={{ background: 'var(--accent-muted)', border: '1px solid var(--border-strong)' }}
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <circle cx="7" cy="7" r="5.5" stroke="var(--accent)" strokeWidth="1.5" />
        <circle cx="7" cy="7" r="2" fill="var(--accent)" />
      </svg>
    </div>
  );
}
