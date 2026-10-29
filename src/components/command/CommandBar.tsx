/**
 * Veyra Global Command Bar
 *
 * ⌘/Ctrl+K is a lightweight launcher. Free-form text always goes to Agent;
 * navigation shortcuts never execute a financial action.
 */

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Search, Bot, SendHorizontal, ArrowLeftRight, LayoutList, Settings, Home, X, Route, Sparkles } from 'lucide-react';
import type { VeyraPage } from '../layout/AppShell';

interface CommandBarProps {
  open: boolean;
  onClose: () => void;
  onNavigate: (page: VeyraPage) => void;
}

const PRIMARY_ACTIONS = [
  { label: 'Ask Veyra', page: 'agent' as VeyraPage, icon: <Bot className="size-4" />, hint: 'Chat or plan in any language' },
  { label: 'Pay someone', page: 'pay' as VeyraPage, icon: <SendHorizontal className="size-4" />, hint: 'Veyra ID, X handle, or wallet' },
  { label: 'Activity', page: 'activity' as VeyraPage, icon: <LayoutList className="size-4" />, hint: 'Receipts and history' },
  { label: 'Home', page: 'home' as VeyraPage, icon: <Home className="size-4" />, hint: 'Identity and balances' },
];

const SECONDARY_ACTIONS = [
  { label: 'Settings', page: 'settings' as VeyraPage, icon: <Settings className="size-4" />, hint: 'Identity, runtime, and policy' },
  { label: 'Convert (advanced)', page: 'convert' as VeyraPage, icon: <ArrowLeftRight className="size-4" />, hint: 'Direct conversion flow' },
  { label: 'Bridge (advanced)', page: 'bridge' as VeyraPage, icon: <Route className="size-4" />, hint: 'Direct CCTP test flow' },
];

export function CommandBar({ open, onClose, onNavigate }: CommandBarProps) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && open) onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  const search = query.trim().toLowerCase();
  const filter = <T extends { label: string; hint: string }>(items: T[]) => search
    ? items.filter((item) => item.label.toLowerCase().includes(search) || item.hint.toLowerCase().includes(search))
    : items;
  const primary = filter(PRIMARY_ACTIONS);
  const secondary = filter(SECONDARY_ACTIONS);

  function handleSelect(page: VeyraPage) {
    onNavigate(page);
    onClose();
  }

  function handleAskAgent() {
    const value = query.trim();
    if (value) sessionStorage.setItem('veyra:pending-query', value);
    onNavigate('agent');
    onClose();
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[12vh]"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}
          onClick={onClose}
        >
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
          <motion.div
            className="relative w-full max-w-xl overflow-hidden rounded-3xl"
            style={{ background: 'rgba(14,24,40,0.96)', backdropFilter: 'blur(40px) saturate(200%)', border: '1px solid var(--border-strong)', boxShadow: '0 24px 64px rgba(0,0,0,0.6)' }}
            initial={{ opacity: 0, y: -12, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -12, scale: 0.97 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }} onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center gap-3 border-b px-4 py-4" style={{ borderColor: 'var(--border)' }}>
              <Sparkles className="size-4 shrink-0" style={{ color: 'var(--accent)' }} />
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter' && query.trim()) handleAskAgent(); }}
                placeholder="Ask Veyra in any language, or navigate…"
                className="flex-1 bg-transparent text-sm outline-none"
                style={{ color: 'var(--ink)' }}
              />
              {query && <button onClick={() => setQuery('')} style={{ color: 'var(--subtle)' }}><X className="size-3.5" /></button>}
              <kbd className="rounded-md px-1.5 py-0.5 font-mono text-[10px]" style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--subtle)' }}>ESC</kbd>
            </div>

            {query.trim() && (
              <button onClick={handleAskAgent} className="flex w-full items-center gap-3 border-b px-4 py-3 text-left hover:bg-white/5" style={{ borderColor: 'var(--border)' }}>
                <span className="flex size-8 items-center justify-center rounded-xl" style={{ background: 'var(--accent-muted)', color: 'var(--accent)' }}><Bot className="size-4" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold" style={{ color: 'var(--ink)' }}>Ask Veyra</span>
                  <span className="block truncate text-xs" style={{ color: 'var(--subtle)' }}>“{query.trim()}”</span>
                </span>
                <span className="text-xs" style={{ color: 'var(--accent)' }}>Enter</span>
              </button>
            )}

            <div className="max-h-[55vh] overflow-y-auto py-2">
              <ActionSection title="Core" items={primary} onSelect={handleSelect} />
              {secondary.length > 0 && <ActionSection title="More" items={secondary} onSelect={handleSelect} />}
              {primary.length === 0 && secondary.length === 0 && !query.trim() && (
                <div className="flex items-center gap-2 px-4 py-5 text-sm" style={{ color: 'var(--subtle)' }}><Search className="size-4" /> Start typing to ask Veyra.</div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function ActionSection({ title, items, onSelect }: { title: string; items: typeof PRIMARY_ACTIONS; onSelect: (page: VeyraPage) => void }) {
  if (items.length === 0) return null;
  return (
    <div className="py-1">
      <div className="px-4 py-2 text-[10px] font-bold uppercase tracking-[0.18em]" style={{ color: 'var(--subtle)' }}>{title}</div>
      {items.map((action) => (
        <button key={action.page} onClick={() => onSelect(action.page)} className="flex w-full items-center gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-white/5">
          <span style={{ color: 'var(--muted)' }}>{action.icon}</span>
          <span style={{ color: 'var(--ink)' }}>{action.label}</span>
          <span className="ml-auto text-xs" style={{ color: 'var(--subtle)' }}>{action.hint}</span>
        </button>
      ))}
    </div>
  );
}
