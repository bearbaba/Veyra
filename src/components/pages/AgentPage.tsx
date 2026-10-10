import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Bot,
  CheckCircle2,
  Globe2,
  Loader2,
  LockKeyhole,
  SendHorizontal,
  Sparkles,
  WifiOff,
} from 'lucide-react';
import {
  createFallbackAgentResponse,
  validateAgentChatResponse,
  type AgentCapabilities,
  type AgentChatResponse,
  type AgentHistoryMessage,
} from '@/core/agent/agentV2';
import type { IntentResult } from '@/core/intent/intentSchema';
import { buildCapabilityIntentGraph, type CapabilityIntentGraph } from '@/core/agent/intentGraph';
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
  degraded?: boolean;
  locale?: string;
  capabilityGraph?: CapabilityIntentGraph;
  ts: number;
}

const DEFAULT_CAPABILITIES: AgentCapabilities = {
  conversation: 'FALLBACK',
  planning: 'FALLBACK',
  execution: 'LOCKED',
  provider: 'local-fallback',
};

export function AgentPage({ onNavigate }: AgentPageProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState<string>(() => {
    const pending = sessionStorage.getItem('veyra:pending-query');
    if (pending) sessionStorage.removeItem('veyra:pending-query');
    return pending ?? '';
  });
  const [loading, setLoading] = useState(false);
  const [capabilities, setCapabilities] = useState<AgentCapabilities>(DEFAULT_CAPABILITIES);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    try {
      const stored = sessionStorage.getItem('veyra:agent-history');
      if (stored) {
        const parsed = JSON.parse(stored) as Message[];
        if (Array.isArray(parsed)) setMessages(parsed.slice(-30));
      }
    } catch {
      // Corrupt preview history is non-authoritative; start clean.
    }
  }, []);

  useEffect(() => {
    if (messages.length > 0) sessionStorage.setItem('veyra:agent-history', JSON.stringify(messages.slice(-30)));
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    let cancelled = false;
    void fetch('/api/agent/status')
      .then(async (response) => response.ok ? response.json() as Promise<Record<string, unknown>> : Promise.reject(new Error('offline')))
      .then((raw) => {
        if (cancelled) return;
        setCapabilities({
          conversation: raw.conversation === 'ONLINE' ? 'ONLINE' : 'FALLBACK',
          planning: raw.planning === 'ONLINE' ? 'ONLINE' : 'FALLBACK',
          execution: raw.execution === 'AVAILABLE' ? 'AVAILABLE' : 'LOCKED',
          provider: typeof raw.provider === 'string' ? raw.provider : 'local-fallback',
        });
      })
      .catch(() => { if (!cancelled) setCapabilities(DEFAULT_CAPABILITIES); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (input) inputRef.current?.focus();
  }, [input]);

  const history = useMemo<AgentHistoryMessage[]>(() => messages.slice(-10).map((message) => ({ role: message.role, text: message.text })), [messages]);

  async function sendMessage() {
    const text = input.trim();
    if (!text || loading) return;

    const priorHistory = history;
    const userMessage: Message = { id: crypto.randomUUID(), role: 'user', text, ts: Date.now() };
    setMessages((current) => [...current, userMessage]);
    setInput('');
    setLoading(true);

    let response: AgentChatResponse;
    try {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 25_000);
      const request = await fetch('/api/agent/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, history: priorHistory }),
        signal: controller.signal,
      });
      window.clearTimeout(timeout);
      if (!request.ok) throw new Error(`Agent service returned ${request.status}`);
      const raw: unknown = await request.json();
      response = validateAgentChatResponse(raw, text, capabilities);
    } catch {
      // Browser-side safety net: chat never collapses just because the BFF or
      // configured model is unavailable. Execution remains locked.
      response = createFallbackAgentResponse(text, { provider: 'browser-fallback', executionAvailable: false, history: priorHistory });
    }

    setCapabilities(response.capabilities);
    const capabilityGraph = buildCapabilityIntentGraph(text);
    const agentMessage: Message = {
      id: crypto.randomUUID(),
      role: 'agent',
      text: response.reply,
      ...(response.intent ? { intent: response.intent } : {}),
      ...(capabilityGraph.nodes.length > 0 ? { capabilityGraph } : {}),
      degraded: response.degraded,
      locale: response.locale,
      ts: Date.now(),
    };
    setMessages((current) => [...current, agentMessage]);
    setLoading(false);
  }

  function clearConversation() {
    setMessages([]);
    sessionStorage.removeItem('veyra:agent-history');
    inputRef.current?.focus();
  }

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-44px)] max-w-5xl flex-col px-4 py-5 md:px-7 md:py-7">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b pb-5" style={{ borderColor: 'var(--border)' }}>
        <div>
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em]" style={{ color: 'var(--accent)' }}>
            <Sparkles className="size-4" /> Agent V2
          </div>
          <h1 className="display mt-2 text-3xl font-black" style={{ color: 'var(--ink)', letterSpacing: '-0.04em' }}>Ask Veyra anything.</h1>
          <p className="mt-1 max-w-2xl text-sm leading-6" style={{ color: 'var(--muted)' }}>
            Speak naturally in your own language. Veyra chats first, then turns financial intent into a reviewable action — never an automatic signature.
          </p>
        </div>
        {messages.length > 0 && (
          <button onClick={clearConversation} className="rounded-xl px-3 py-2 text-xs font-semibold" style={{ border: '1px solid var(--border)', color: 'var(--subtle)' }}>
            New conversation
          </button>
        )}
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2">
        <CapabilityPill label="Chat" online={capabilities.conversation === 'ONLINE'} icon={<Globe2 className="size-3.5" />} fallbackLabel="Fallback ready" />
        <CapabilityPill label="Planner" online={capabilities.planning === 'ONLINE'} icon={<Bot className="size-3.5" />} fallbackLabel="Local planner" />
        <CapabilityPill label="Execution" online={capabilities.execution === 'AVAILABLE'} icon={<LockKeyhole className="size-3.5" />} fallbackLabel="Review locked" />
      </div>

      <div className="flex-1 overflow-y-auto py-6">
        {messages.length === 0 ? (
          <AgentWelcome onSelect={(query) => { setInput(query); inputRef.current?.focus(); }} />
        ) : (
          <div className="mx-auto max-w-3xl space-y-5">
            <AnimatePresence initial={false}>
              {messages.map((message) => (
                <motion.div
                  key={message.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.18 }}
                  className={message.role === 'user' ? 'flex justify-end' : 'flex justify-start'}
                >
                  {message.role === 'user' ? (
                    <div className="max-w-[82%] rounded-2xl rounded-tr-md px-4 py-3 text-sm leading-6" style={{ background: 'linear-gradient(135deg,rgba(126,92,255,0.22),rgba(68,178,255,0.12))', border: '1px solid var(--border-strong)', color: 'var(--ink)' }}>
                      {message.text}
                    </div>
                  ) : (
                    <div className="w-full max-w-2xl">
                      <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em]" style={{ color: 'var(--subtle)' }}>
                        <span className="flex size-6 items-center justify-center rounded-lg" style={{ background: 'var(--accent-muted)', color: 'var(--accent)' }}><Bot className="size-3.5" /></span>
                        Veyra
                        {message.locale && <span>· {message.locale}</span>}
                        {message.degraded && <span className="flex items-center gap-1" style={{ color: 'var(--warning)' }}><WifiOff className="size-3" /> fallback</span>}
                      </div>
                      <div className="rounded-2xl rounded-tl-md px-4 py-3 text-sm leading-6" style={{ background: 'var(--surface-strong)', border: '1px solid var(--border)', color: 'var(--ink-2)' }}>
                        {message.text}
                      </div>
                      {message.capabilityGraph && message.capabilityGraph.nodes.length > 1 && (
                        <IntentGraphPreview graph={message.capabilityGraph} />
                      )}
                      {message.intent && message.intent.candidates.length > 0 && (
                        <div className="mt-3"><ActionCard intent={message.intent} onNavigate={onNavigate} /></div>
                      )}
                    </div>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>

            {loading && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-2 text-sm" style={{ color: 'var(--muted)' }}>
                <span className="flex size-8 items-center justify-center rounded-xl" style={{ background: 'var(--accent-muted)' }}><Loader2 className="size-4 animate-spin" style={{ color: 'var(--accent)' }} /></span>
                Thinking and checking intent…
              </motion.div>
            )}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      <div className="sticky bottom-0 mx-auto w-full max-w-3xl pb-2 pt-3" style={{ background: 'linear-gradient(180deg, transparent, var(--bg) 24%)' }}>
        <div className="rounded-3xl p-2 shadow-2xl" style={{ background: 'var(--surface-strong)', border: '1px solid var(--border-strong)' }}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void sendMessage();
              }
            }}
            placeholder="Message Veyra in any language…"
            rows={2}
            maxLength={2000}
            className="w-full resize-none bg-transparent px-3 pt-2 text-sm leading-6 outline-none"
            style={{ color: 'var(--ink)', minHeight: 60, maxHeight: 150 }}
          />
          <div className="flex items-center justify-between gap-3 px-2 pb-1">
            <div className="flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--subtle)' }}>
              <CheckCircle2 className="size-3.5" style={{ color: 'var(--success)' }} /> Same-language replies · Review before signing
            </div>
            <button
              onClick={() => void sendMessage()}
              disabled={!input.trim() || loading}
              className="flex size-10 items-center justify-center rounded-2xl transition-all disabled:cursor-not-allowed disabled:opacity-35"
              style={{ background: 'linear-gradient(135deg,#c8ff65,#91e9b5)', color: '#0b1b25' }}
              aria-label="Send message"
            >
              {loading ? <Loader2 className="size-4 animate-spin" /> : <SendHorizontal className="size-4" />}
            </button>
          </div>
        </div>
        <p className="mt-2 text-center text-[10px]" style={{ color: 'var(--subtle)' }}>
          Agent conversation is not execution. Identity, amounts, routes and policy are verified by deterministic Veyra services.
        </p>
      </div>
    </div>
  );
}


function IntentGraphPreview({ graph }: { graph: CapabilityIntentGraph }) {
  return (
    <div className="mt-3 rounded-2xl p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.16em]" style={{ color: 'var(--accent)' }}>Plan draft</div>
          <div className="mt-1 text-xs" style={{ color: 'var(--muted)' }}>Veyra split your goal into {graph.nodes.length} ordered capabilities. Values remain untrusted until deterministic resolution.</div>
        </div>
        <span className="rounded-lg px-2 py-1 text-[10px] font-semibold" style={{ background: 'var(--accent-muted)', color: 'var(--accent)' }}>0 Veyra signatures</span>
      </div>
      <div className="mt-3 space-y-2">
        {graph.nodes.map((node, index) => (
          <div key={node.nodeId} className="flex items-start gap-3 rounded-xl px-3 py-2.5" style={{ background: 'var(--surface-strong)', border: '1px solid var(--border)' }}>
            <span className="flex size-6 shrink-0 items-center justify-center rounded-lg text-[10px] font-black" style={{ background: 'var(--accent-muted)', color: 'var(--accent)' }}>{index + 1}</span>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-bold" style={{ color: 'var(--ink)' }}>{node.capability}</div>
              <div className="mt-0.5 truncate text-[11px]" style={{ color: 'var(--muted)' }}>{node.sourceText}</div>
            </div>
            {node.destinationNetworkRaw && <span className="text-[10px]" style={{ color: 'var(--subtle)' }}>→ {node.destinationNetworkRaw}</span>}
          </div>
        ))}
      </div>
      <div className="mt-3 text-[10px]" style={{ color: 'var(--subtle)' }}>Route, provider, exact amounts, policy, risk and required protocol signatures are calculated after context resolution.</div>
    </div>
  );
}

function AgentWelcome({ onSelect }: { onSelect: (query: string) => void }) {
  const prompts = [
    { title: 'Pay someone', text: 'Send 20 USDC to @bearcrypto2021', icon: <SendHorizontal className="size-4" /> },
    { title: 'Ask naturally', text: 'What can Veyra do for me?', icon: <Bot className="size-4" /> },
    { title: 'Vietnamese', text: 'Gửi 20 USDC cho @bearcrypto2021', icon: <Globe2 className="size-4" /> },
    { title: 'Multi-step goal', text: 'Keep 300 USDC on Arc, send @bearcrypto2021 50 USDC, bridge 200 USDC to Arbitrum, then earn the rest', icon: <Sparkles className="size-4" /> },
  ];
  return (
    <div className="mx-auto max-w-3xl py-6 md:py-12">
      <div className="mx-auto flex size-14 items-center justify-center rounded-2xl" style={{ background: 'linear-gradient(135deg,rgba(124,58,237,0.35),rgba(200,255,101,0.14))', border: '1px solid var(--border-strong)' }}>
        <Bot className="size-6" style={{ color: 'var(--accent)' }} />
      </div>
      <h2 className="display mt-4 text-center text-2xl font-black" style={{ color: 'var(--ink)', letterSpacing: '-0.03em' }}>How can I help?</h2>
      <p className="mx-auto mt-2 max-w-lg text-center text-sm leading-6" style={{ color: 'var(--muted)' }}>
        English is the product default. If you write in another language, Veyra follows your language automatically.
      </p>
      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        {prompts.map((prompt) => (
          <button key={prompt.text} onClick={() => onSelect(prompt.text)} className="rounded-2xl p-4 text-left transition-all hover:-translate-y-0.5" style={{ background: 'var(--surface-strong)', border: '1px solid var(--border)' }}>
            <span className="flex size-8 items-center justify-center rounded-xl" style={{ background: 'var(--accent-muted)', color: 'var(--accent)' }}>{prompt.icon}</span>
            <div className="mt-3 text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--subtle)' }}>{prompt.title}</div>
            <div className="mt-1 text-sm font-semibold" style={{ color: 'var(--ink-2)' }}>{prompt.text}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

function CapabilityPill({ label, online, icon, fallbackLabel }: { label: string; online: boolean; icon: React.ReactNode; fallbackLabel: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-xl px-3 py-2" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
      <span style={{ color: online ? 'var(--success)' : 'var(--warning)' }}>{icon}</span>
      <div className="min-w-0">
        <div className="truncate text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--muted)' }}>{label}</div>
        <div className="truncate text-[10px]" style={{ color: online ? 'var(--success)' : 'var(--subtle)' }}>{online ? 'Online' : fallbackLabel}</div>
      </div>
    </div>
  );
}
