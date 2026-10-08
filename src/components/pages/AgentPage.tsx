/**
 * Veyra Agent Page
 *
 * Natural language interface. User types intent → BFF parses → structured
 * Action Card displayed → same TRANSFER pipeline as Pay page.
 *
 * Safety model:
 * - LLM never executes, never supplies trusted financial data
 * - BFF response validated against IntentResult schema before display
 * - All execution goes through Policy → Risk → Simulation → Review
 */

import { useState, useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Bot, SendHorizontal, Loader2, AlertTriangle, Info } from 'lucide-react';
import { validateIntentResponse } from '@/core/intent/intentSchema';
import type { IntentResult } from '@/core/intent/intentSchema';
import { ActionCard } from '../transfer/ActionCard';
import type { VeyraPage } from '../layout/AppShell';

interface AgentPageProps {
  onNavigate: (page: VeyraPage) => void;
}

interface Message {
  id: string;
  role: 'user' | 'agent';
  text: string;
  intent?: IntentResult;
  ts: number;
}

export function AgentPage({ onNavigate }: AgentPageProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  // Initialise with any pending query forwarded from the command bar
  const [input, setInput] = useState<string>(() => {
    const pending = sessionStorage.getItem('veyra:pending-query');
    if (pending) sessionStorage.removeItem('veyra:pending-query');
    return pending ?? '';
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Focus input on mount when a pending query was forwarded
  useEffect(() => {
    if (input) inputRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally only on mount
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function sendMessage() {
    const text = input.trim();
    if (!text || loading) return;

    const userMsg: Message = { id: crypto.randomUUID(), role: 'user', text, ts: Date.now() };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/agent/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      });

      if (!res.ok) {
        throw new Error(`BFF returned ${res.status}`);
      }

      const raw: unknown = await res.json();

      // Validate BFF response — this is untrusted input
      const rawObj: Record<string, unknown> = (raw !== null && typeof raw === 'object' && !Array.isArray(raw))
        ? (raw as Record<string, unknown>)
        : {};
      const intent = validateIntentResponse(rawObj);

      const agentMsg: Message = {
        id: crypto.randomUUID(),
        role: 'agent',
        text: intent.displaySummary,
        intent,
        ts: Date.now(),
      };
      setMessages((prev) => [...prev, agentMsg]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setError(`Agent unavailable: ${msg}`);
      // Still add a message so the user knows
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: 'agent',
          text: 'The agent is currently unavailable. You can use the Pay page directly to send USDC.',
          ts: Date.now(),
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col h-full max-w-2xl mx-auto" style={{ minHeight: 'calc(100dvh - 120px)' }}>
      {/* Header */}
      <div className="px-4 pt-6 pb-4 border-b" style={{ borderColor: 'var(--border)' }}>
        <div className="flex items-center gap-2.5">
          <div className="flex size-8 items-center justify-center rounded-xl"
            style={{ background: 'var(--accent-muted)', border: '1px solid var(--border-strong)' }}>
            <Bot className="size-4.5" style={{ color: 'var(--accent)' }} />
          </div>
          <div>
            <h1 className="display text-lg font-bold" style={{ color: 'var(--ink)' }}>Veyra Agent</h1>
            <p className="text-xs" style={{ color: 'var(--muted)' }}>
              Tell me what you want to do with your money
            </p>
          </div>
        </div>

        {/* Safety notice */}
        <div className="flex items-start gap-2 mt-3 rounded-xl p-3"
          style={{ background: 'var(--accent-muted)', border: '1px solid var(--border)' }}>
          <Info className="size-3.5 mt-0.5 shrink-0" style={{ color: 'var(--accent)' }} />
          <p className="text-xs" style={{ color: 'var(--muted)' }}>
            The Agent plans actions for your review — it never signs transactions or accesses your wallet directly.
          </p>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.length === 0 && (
          <AgentSuggestions onSelect={(q) => { setInput(q); inputRef.current?.focus(); }} />
        )}

        <AnimatePresence initial={false}>
          {messages.map((msg) => (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              {msg.role === 'user' ? (
                <div
                  className="max-w-sm rounded-2xl rounded-tr-sm px-4 py-2.5 text-sm"
                  style={{ background: 'var(--accent-muted)', border: '1px solid var(--border-strong)', color: 'var(--ink)' }}
                >
                  {msg.text}
                </div>
              ) : (
                <div className="max-w-lg w-full space-y-2">
                  {/* Display summary — display only, not trusted for execution */}
                  {msg.text && (
                    <div
                      className="rounded-2xl rounded-tl-sm px-4 py-2.5 text-sm"
                      style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--ink-2)' }}
                    >
                      {msg.text}
                    </div>
                  )}
                  {/* Action card when intent has a valid candidate */}
                  {msg.intent && msg.intent.candidates.length > 0 && (
                    <ActionCard
                      intent={msg.intent}
                      onNavigate={onNavigate}
                    />
                  )}
                  {/* Clarification question */}
                  {msg.intent?.status === 'NEEDS_CLARIFICATION' && msg.intent.clarificationQuestion && (
                    <div
                      className="rounded-xl px-3.5 py-2.5 text-sm"
                      style={{ background: 'var(--warning-muted)', border: '1px solid var(--border)', color: 'var(--warning)' }}
                    >
                      {msg.intent.clarificationQuestion}
                    </div>
                  )}
                </div>
              )}
            </motion.div>
          ))}
        </AnimatePresence>

        {loading && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex items-center gap-2 text-sm"
            style={{ color: 'var(--muted)' }}
          >
            <Loader2 className="size-4 animate-spin" />
            Agent is thinking...
          </motion.div>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-xl p-3 text-sm"
            style={{ background: 'var(--danger-muted)', border: '1px solid var(--border)', color: 'var(--danger)' }}>
            <AlertTriangle className="size-4 mt-0.5 shrink-0" />
            {error}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="px-4 pb-4 pt-2 border-t" style={{ borderColor: 'var(--border)' }}>
        <div
          className="flex items-end gap-2 rounded-2xl p-2"
          style={{ background: 'var(--surface-strong)', border: '1px solid var(--border-strong)' }}
        >
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void sendMessage();
              }
            }}
            placeholder="Send 10 USDC to 0x..."
            rows={1}
            className="flex-1 bg-transparent text-sm outline-none resize-none py-1.5 px-2"
            style={{ color: 'var(--ink)', minHeight: '36px', maxHeight: '120px' }}
          />
          <button
            onClick={() => void sendMessage()}
            disabled={!input.trim() || loading}
            className="flex size-9 items-center justify-center rounded-xl transition-all disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
            style={{ background: 'var(--accent)', color: '#0d1b2f' }}
          >
            {loading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <SendHorizontal className="size-4" />
            )}
          </button>
        </div>
        <p className="text-xs mt-2 text-center" style={{ color: 'var(--subtle)' }}>
          Enter to send · Shift+Enter for new line
        </p>
      </div>
    </div>
  );
}

function AgentSuggestions({ onSelect }: { onSelect: (q: string) => void }) {
  const suggestions = [
    'Send 5 USDC to 0x742d35Cc6634C0532925a3b8D4C9F5B8a1B6e5f2',
    'Convert 100 USDC to EURC',
    'Bridge 50 USDC from Arc to Ethereum Sepolia',
    'What can you help me do?',
  ];
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--subtle)' }}>
        Try asking
      </p>
      {suggestions.map((s) => (
        <button
          key={s}
          onClick={() => onSelect(s)}
          className="w-full text-left text-sm rounded-xl px-4 py-2.5 transition-colors hover:bg-white/5"
          style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--ink-2)' }}
        >
          {s}
        </button>
      ))}
    </div>
  );
}
