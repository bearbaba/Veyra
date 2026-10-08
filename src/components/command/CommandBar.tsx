/**
 * Veyra Global Command Bar
 *
 * Triggered by ⌘K. Accepts natural language input and routes to Agent
 * or navigates directly to a page.
 * Safe: does NOT execute any financial action directly from here.
 * All intent extraction goes through the BFF → Agent pipeline.
 */

import { useState, useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Search, Bot, SendHorizontal, ArrowLeftRight, LayoutList, Settings, Home, X } from 'lucide-react';
import type { VeyraPage } from '../layout/AppShell';

interface CommandBarProps {
  open: boolean;
  onClose: () => void;
  onNavigate: (page: VeyraPage) => void;
}

const QUICK_ACTIONS = [
  { label: 'Send USDC',       page: 'pay' as VeyraPage,      icon: <SendHorizontal className="size-4" />, hint: 'Pay anyone on Arc' },
  { label: 'Ask the Agent',   page: 'agent' as VeyraPage,    icon: <Bot className="size-4" />,           hint: 'Natural language planning' },
  { label: 'Convert',         page: 'convert' as VeyraPage,  icon: <ArrowLeftRight className="size-4" />, hint: 'Coming soon' },
  { label: 'Activity',        page: 'activity' as VeyraPage, icon: <LayoutList className="size-4" />,    hint: 'Transaction history' },
  { label: 'Portfolio',       page: 'home' as VeyraPage,     icon: <Home className="size-4" />,          hint: 'Overview' },
  { label: 'Settings',        page: 'settings' as VeyraPage, icon: <Settings className="size-4" />,      hint: 'Policies & preferences' },
];

export function CommandBar({ open, onClose, onNavigate }: CommandBarProps) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Open/close keyboard shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        if (open) onClose();
        // else — parent controls open state
      }
      if (e.key === 'Escape' && open) onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  // Focus on open — reset query when the bar opens
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [open]);

  // Reset query when bar closes
  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  const filtered = query.trim()
    ? QUICK_ACTIONS.filter((a) =>
        a.label.toLowerCase().includes(query.toLowerCase()) ||
        a.hint.toLowerCase().includes(query.toLowerCase()),
      )
    : QUICK_ACTIONS;

  function handleSelect(page: VeyraPage) {
    onNavigate(page);
    onClose();
  }

  function handleAskAgent() {
    onNavigate('agent');
    onClose();
    // The agent page will pick up a pending query via sessionStorage
    if (query.trim()) {
      sessionStorage.setItem('veyra:pending-query', query.trim());
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] px-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onClick={onClose}
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

          {/* Panel */}
          <motion.div
            className="relative w-full max-w-lg rounded-2xl overflow-hidden"
            style={{
              background: 'rgba(14, 24, 40, 0.95)',
              backdropFilter: 'blur(40px) saturate(200%)',
              border: '1px solid var(--border-strong)',
              boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
            }}
            initial={{ opacity: 0, y: -12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -12, scale: 0.97 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Search input */}
            <div className="flex items-center gap-3 px-4 py-3.5 border-b" style={{ borderColor: 'var(--border)' }}>
              <Search className="size-4 shrink-0" style={{ color: 'var(--muted)' }} />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && query.trim()) handleAskAgent();
                }}
                placeholder="Ask anything or navigate..."
                className="flex-1 bg-transparent text-sm outline-none"
                style={{ color: 'var(--ink)' }}
              />
              {query && (
                <button onClick={() => setQuery('')} style={{ color: 'var(--subtle)' }}>
                  <X className="size-3.5" />
                </button>
              )}
              <kbd className="text-xs px-1.5 py-0.5 rounded-md font-mono shrink-0"
                style={{ background: 'var(--surface)', color: 'var(--subtle)', border: '1px solid var(--border)' }}>
                ESC
              </kbd>
            </div>

            {/* Ask Agent CTA when there's a query */}
            {query.trim() && (
              <button
                onClick={handleAskAgent}
                className="w-full flex items-center gap-3 px-4 py-3 text-sm font-medium transition-colors border-b hover:bg-white/5"
                style={{ color: 'var(--accent)', borderColor: 'var(--border)' }}
              >
                <Bot className="size-4 shrink-0" />
                <span>Ask Agent: <span className="font-normal opacity-80">"{query.trim().slice(0, 60)}"</span></span>
              </button>
            )}

            {/* Quick actions */}
            <div className="py-2">
              {filtered.length === 0 ? (
                <p className="px-4 py-3 text-sm" style={{ color: 'var(--subtle)' }}>No results</p>
              ) : (
                filtered.map((action) => (
                  <button
                    key={action.page}
                    onClick={() => handleSelect(action.page)}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-white/5"
                  >
                    <span style={{ color: 'var(--muted)' }}>{action.icon}</span>
                    <span style={{ color: 'var(--ink)' }}>{action.label}</span>
                    <span className="ml-auto text-xs" style={{ color: 'var(--subtle)' }}>{action.hint}</span>
                  </button>
                ))
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
