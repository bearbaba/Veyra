import { useEffect, useMemo, useRef, useState } from 'react';
import { useAccount } from 'wagmi';
import { useUnifiedSocial, type SocialFriend } from '../../features/social/UnifiedSocial';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Bot,
  CheckCircle2,
  Loader2,
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
import { loadActivityReceiptsRemote, type ActivityReceiptRemoteRecord } from '../../lib/api/activityReceiptApi';
import { agentBridgeReceiptState, readAgentBridgeReceiptLinks, type AgentBridgeReceiptLink } from '../../core/agent/agentBridgeReceiptLink';
import { AgentQuickStart } from '../agent/AgentQuickStart';
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
  const { address, connector } = useAccount();
  const social = useUnifiedSocial();
  // The backend-signed Social session uses wallet address + connector, not
  // signing-chain transport state. Changing chain must not discard Agent/Friends.
  const walletKey = address
    ? [address.toLowerCase(), connector?.uid ?? ''].join(':')
    : 'not-connected';
  // A guest view is transient. Persisted conversation belongs exclusively to
  // the wallet-bound, signed Veyra identity used when the chat was created.
  const signedSession = social.session?.walletKey === walletKey ? social.session : null;
  const historyScope = signedSession
    ? [walletKey, signedSession.profile.veyraUserId].join(':')
    : null;
  const connectedFriends = signedSession ? social.friends.filter((f) => f.state === 'CONNECTED') : [];
  return <ScopedAgentPage key={historyScope ?? walletKey + ':unsigned'} onNavigate={onNavigate}
    historyScope={historyScope} friends={connectedFriends} signedIn={Boolean(signedSession)}
    currentWallet={address?.toLowerCase() ?? null} />;
}

function ScopedAgentPage({ onNavigate, historyScope, friends, signedIn, currentWallet }: AgentPageProps & {
  historyScope: string | null; friends: SocialFriend[]; signedIn: boolean; currentWallet: string | null;
}) {
  const historyKey = historyScope ? 'veyra:agent-history:' + historyScope : null;
  const [messages, setMessages] = useState<Message[]>(() => {
    if (!historyKey) return [];
    try {
      const stored = sessionStorage.getItem(historyKey);
      if (!stored) return [];
      const parsed: unknown = JSON.parse(stored);
      return Array.isArray(parsed) ? (parsed as Message[]).slice(-30) : [];
    } catch { return []; }
  });
  const [input, setInput] = useState<string>(() => {
    const pending = sessionStorage.getItem('veyra:pending-query');
    if (pending) sessionStorage.removeItem('veyra:pending-query');
    return pending ?? '';
  });
  const [loading, setLoading] = useState(false);
  const [showQuickActions, setShowQuickActions] = useState(false);
  const [capabilities, setCapabilities] = useState<AgentCapabilities>(DEFAULT_CAPABILITIES);
  const [bridgeLinks, setBridgeLinks] = useState<AgentBridgeReceiptLink[]>(() =>
    readAgentBridgeReceiptLinks(historyScope));
  const [verifiedBridgeReceipts, setVerifiedBridgeReceipts] = useState<ActivityReceiptRemoteRecord[]>([]);
  const [receiptLookupFailed, setReceiptLookupFailed] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    // Do not import legacy global chat shared by every wallet in this browser.
    try { sessionStorage.removeItem('veyra:agent-history'); } catch { /* storage denied */ }
  }, []);

  useEffect(() => {
    if (historyKey && messages.length > 0) {
      try { sessionStorage.setItem(historyKey, JSON.stringify(messages.slice(-30))); }
      catch { /* Keep conversation in memory when storage is unavailable. */ }
    }
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [historyKey, messages]);

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

  useEffect(() => {
    if (!historyScope || !signedIn || !currentWallet) return;
    let active = true;
    const refresh = () => {
      if (!active) return;
      setBridgeLinks(readAgentBridgeReceiptLinks(historyScope));
      // Session-scoped signed BFF response, not local history or LLM guesses,
      // controls success. Refresh when returning from Bridge/Activity.
      void loadActivityReceiptsRemote(100).then((receipts) => {
        if (!active) return;
        setVerifiedBridgeReceipts(receipts.filter((receipt) =>
          receipt.senderAddress.toLowerCase() === currentWallet &&
          receipt.providerId === 'cctp-v2-bridge'));
        setReceiptLookupFailed(false);
      }).catch(() => {
        if (active) { setReceiptLookupFailed(true); setVerifiedBridgeReceipts([]); }
      });
    };
    refresh();
    window.addEventListener('focus', refresh);
    const onVisibility = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      active = false;
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [historyScope, signedIn, currentWallet]);

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
      const request = await fetch('/api/agent/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, history: priorHistory }),
        signal: AbortSignal.timeout(25_000),
      });
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
    setBridgeLinks([]);
    try {
      if (historyKey) sessionStorage.removeItem(historyKey);
      if (historyScope) sessionStorage.removeItem('veyra:agent:bridge-receipts:' + historyScope);
    } catch { /* storage denied */ }
    inputRef.current?.focus();
  }

  function prepareQuickRequest(text: string) {
    // User explicitly submits this draft through Agent; no auto-send or wallet request.
    setInput(text);
    setShowQuickActions(false);
    inputRef.current?.focus();
  }

  const latestConfirmedBridge = [...bridgeLinks].reverse().map((link) =>
    verifiedBridgeReceipts.find((receipt) => receipt.receiptId === link.receiptId))
    .find((receipt) => receipt && agentBridgeReceiptState(receipt) === 'SUCCESS');
  const lastBridgeReceipt = [...verifiedBridgeReceipts].sort((a,b)=>
    (Date.parse(b.updatedAt)||0) - (Date.parse(a.updatedAt)||0))[0];
  const latestBridgeStatus = lastBridgeReceipt ? agentBridgeReceiptState(lastBridgeReceipt) : null;

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-44px)] max-w-5xl flex-col px-4 py-5 md:px-7 md:py-7">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b pb-5" style={{ borderColor: 'var(--border)' }}>
        <div>
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em]" style={{ color: 'var(--accent)' }}>
            <Sparkles className="size-4" /> Agent V2
          </div>
          <h1 className="display mt-2 text-3xl font-black" style={{ color: 'var(--ink)', letterSpacing: '-0.04em' }}>Your money, made simple.</h1>
          <p className="mt-1 max-w-2xl text-sm leading-6" style={{ color: 'var(--muted)' }}>
            Send, swap, bridge, explore unified routes — or just ask Veyra. Review everything before signing.
          </p>
        </div>
        {messages.length > 0 && (
          <button onClick={clearConversation} className="rounded-xl px-3 py-2 text-xs font-semibold" style={{ border: '1px solid var(--border)', color: 'var(--subtle)' }}>
            New conversation
          </button>
        )}
      </div>


      {latestConfirmedBridge && (
        <div role="status" className="mx-auto mt-5 flex w-full max-w-3xl flex-wrap items-center justify-between gap-3 rounded-2xl border p-4"
          style={{borderColor:'var(--border-strong)',background:'var(--surface)',color:'var(--success)'}}>
          <div>
            <p className="font-bold text-sm">Bridge complete · destination verified</p>
            <p className="mt-1 text-xs" style={{color:'var(--muted)'}}>
              Your previous Agent request has a verified destination receipt. Veyra is ready for your next request.
            </p>
          </div>
          <button type="button" onClick={()=>onNavigate('activity')}
            className="rounded-xl border px-3 py-2 text-xs font-semibold"
            style={{borderColor:'var(--border-strong)',color:'var(--ink)'}}>View receipt</button>
        </div>
      )}
      {!latestConfirmedBridge && lastBridgeReceipt && (
        <div role="status" className="mx-auto mt-4 flex w-full max-w-3xl flex-wrap items-center justify-between gap-3 rounded-xl border p-3"
          style={{borderColor:'var(--border)',background:'var(--surface)',color:'var(--ink)'}}>
          <div>
            <p className="text-sm font-semibold">
              Latest Bridge activity · {latestBridgeStatus === 'SUCCESS' ? 'Destination verified'
                : latestBridgeStatus === 'PENDING' ? 'Destination status pending'
                : latestBridgeStatus === 'FAILED' ? 'Needs attention' : 'Checking'}
            </p>
            <p className="mt-1 text-xs" style={{color:'var(--muted)'}}>
              This is your authenticated Activity history, not a claim that an older Agent draft was executed.
              {latestBridgeStatus === 'SUCCESS' ? ' You can start a new request below.' : ' Check your existing transaction before sending again.'}
            </p>
          </div>
          <button type="button" onClick={()=>onNavigate('activity')}
            className="rounded-xl border px-3 py-2 text-xs font-semibold"
            style={{borderColor:'var(--border-strong)'}}>View Activity</button>
        </div>
      )}
      <div className="flex-1 overflow-y-auto py-6">
        {messages.length === 0 ? (
          <AgentQuickStart friends={friends} signedIn={signedIn}
            onPrepare={prepareQuickRequest} onNavigate={onNavigate} />
        ) : (
          <div className="mx-auto max-w-3xl space-y-5">
            <div className="flex justify-center">
              <button type="button" onClick={() => setShowQuickActions((current) => !current)}
                aria-expanded={showQuickActions}
                className="rounded-full border px-4 py-2 text-xs font-semibold"
                style={{ color: 'var(--accent)', borderColor: 'var(--border-strong)', background: 'var(--surface)' }}>
                {showQuickActions ? 'Close quick actions' : 'Explore Send · Swap · Bridge · Unified'}
              </button>
            </div>
            {showQuickActions && <AgentQuickStart friends={friends} signedIn={signedIn}
              onPrepare={prepareQuickRequest} onNavigate={onNavigate} compact />}
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
                        {message.degraded && <span className="flex items-center gap-1" style={{ color: 'var(--warning)' }}><WifiOff className="size-3" /> Assistant offline · Draft only</span>}
                      </div>
                      <div className="rounded-2xl rounded-tl-md px-4 py-3 text-sm leading-6" style={{ background: 'var(--surface-strong)', border: '1px solid var(--border)', color: 'var(--ink-2)' }}>
                        {message.text}
                      </div>
                      {message.capabilityGraph && message.capabilityGraph.nodes.length > 1 && (
                        <details className="mt-2 text-xs" style={{color:'var(--muted)'}}>
                          <summary className="cursor-pointer py-2">How Veyra understands this request</summary>
                          <IntentGraphPreview graph={message.capabilityGraph} />
                        </details>
                      )}
                      {message.intent && message.intent.candidates.length > 0 && (
                        <div className="mt-3"><ActionCard intent={message.intent} onNavigate={onNavigate}
                          bridgeHandoffScope={historyScope}
                          messageId={message.id}
                          linkedBridge={(() => {
                            const link = bridgeLinks.find((item) => item.messageId === message.id);
                            if (!link) return undefined;
                            return {
                              receiptId: link.receiptId,
                              receipt: verifiedBridgeReceipts.find((item) => item.receiptId === link.receiptId),
                              lookupFailed:receiptLookupFailed,
                            };
                          })()}
                          onClarifyDestination={(destination) => {
                            const draft = message.intent?.candidates[0];
                            if (!draft) return;
                            const amount = draft.amountRaw?.raw ?? '';
                            const token = draft.tokenRaw?.raw ?? 'USDC';
                            const recipient = draft.recipientRaw?.raw ?? '';
                            const source = draft.sourceChainRaw?.raw ?? 'Arc Testnet';
                            // Populate (not execute) an explicit reviewable route.
                            setInput(`Send ${amount} ${token} from ${source} to ${recipient} on ${destination}`);
                            inputRef.current?.focus();
                          }} /></div>
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
          Veyra never signs for you. Check the recipient, network and fee before confirming.
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
