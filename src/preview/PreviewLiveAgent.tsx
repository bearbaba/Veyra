/**
 * Genuine server-backed AI agent. No offline canned responses.
 * Vercel Function GET/POST /api/agent/chat is separate from the live BFF.
 * No secrets are compiled into this browser: beta access token lives in
 * component memory and disappears on refresh.
 */
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ArrowRight, Bot, ExternalLink, KeyRound, LockKeyhole, RefreshCw, ShieldCheck, Sparkles, Wifi, WifiOff } from 'lucide-react';
import type { PreviewPage } from './PreviewApp';

type ChatMessage = { role: 'user' | 'assistant'; text: string };
type Status = { live: boolean; provider: string | null };
const EXAMPLES = [
  'How do I send USDC on Arc Testnet?',
  'How is Circle CCTP V2 different from a regular USDC transfer?',
  'What if my wallet never returns a transaction hash?',
];

export function PreviewLiveAgent({ onNavigate }: { onNavigate: (page: PreviewPage) => void }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [accessCode, setAccessCode] = useState('');
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const checkStatus = useCallback(async () => {
    setStatus(null);
    setStatusError(null);
    try {
      const response = await fetch('/api/agent/chat', {
        method: 'GET',
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      });
      if (!response.ok) throw new Error('AI endpoint is not deployed.');
      const data = await response.json() as {
        ok?: unknown; live?: unknown; provider?: unknown;
      };
      if (data.ok !== true || typeof data.live !== 'boolean') {
        throw new Error('AI endpoint returned invalid status.');
      }
      setStatus({
        live: data.live,
        provider: typeof data.provider === 'string' ? data.provider : null,
      });
    } catch {
      setStatusError('The AI service is not deployed or cannot be reached. No simulated replies are available.');
    }
  }, []);

  useEffect(() => { void checkStatus(); }, [checkStatus]);

  async function sendMessage(event?: FormEvent<HTMLFormElement>, example?: string) {
    event?.preventDefault();
    const question = (example ?? input).trim();
    if (busy || !status?.live || accessCode.trim().length < 24 ||
        !question || question.length > 1200) return;

    setBusy(true);
    setError(null);
    const prior = messages.slice(-6);
    try {
      const response = await fetch('/api/agent/chat', {
        method: 'POST',
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessCode.trim()}`,
        },
        body: JSON.stringify({ message: question, history: prior }),
      });
      const payload = await response.json().catch(() => ({})) as {
        ok?: boolean; live?: boolean; reply?: unknown; error?: string;
      };
      if (!response.ok || payload.ok !== true || payload.live !== true ||
          typeof payload.reply !== 'string' || !payload.reply.trim()) {
        throw new Error(response.status === 401
          ? 'Incorrect beta access code. Check VEYRA_AGENT_BETA_TOKEN in Vercel.'
          : response.status === 503
            ? 'The live AI service is unavailable. Check OPENAI_API_KEY and Vercel environment variables.'
            : 'The AI service did not return a valid reply. No simulated fallback is used.');
      }
      setMessages([...prior, { role: 'user', text: question },
        { role: 'assistant', text: payload.reply }]);
      setInput('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not connect to the live AI service.');
    } finally {
      setBusy(false);
    }
  }

  const ready = status?.live === true;
  return (
    <div className="vp-page" style={{ maxWidth: 890 }}>
      <div className="vp-page-heading">
        <div>
          <p className="vp-eyebrow">VEYRA INTELLIGENCE · LIVE SERVER AI</p>
          <h1 className="vp-page-title">Ask Veyra <Sparkles size={23} style={{ display: 'inline', color: '#c5fb71' }} /></h1>
          <p className="vp-page-description">Ask questions in any language. Veyra responds in your language through a real, protected AI service — never with canned answers.</p>
        </div>
        <span className="vp-chain-pill">
          {ready ? <Wifi size={14} color="#b6f08c" /> : <WifiOff size={14} />}
          {ready ? 'AI online' : status ? 'AI not configured' : 'Checking AI status'}
        </span>
      </div>

      <div className="vp-card vp-card-pad">
        <div className="vp-balance-head" style={{ marginBottom: 20 }}>
          <span className="vp-quick-icon"><Bot size={21} /></span>
          <div style={{ flex: 1 }}>
            <strong className="vp-card-title">Veyra Assistant</strong>
            <p className="vp-caption">{ready ? 'OpenAI · live responses from a Vercel Function' : 'Requires a server-side API key and a private beta access code'}</p>
          </div>
          <button className="vp-icon-button" type="button" onClick={() => void checkStatus()}
            aria-label="Refresh AI status"><RefreshCw size={16} /></button>
        </div>

        {!ready && (
          <div className="vp-form-note" role="status" style={{ marginBottom: 18 }}>
            <WifiOff size={19} style={{ flex: 'none' }} />
            <div>
              <strong>{statusError ?? 'The live AI service is not enabled on Vercel.'}</strong>
              <p style={{ marginTop: 8 }}>
                In Vercel → Project → Settings → Environment Variables, configure
                <code> OPENAI_API_KEY</code>, <code>VEYRA_AGENT_BETA_TOKEN</code> (at least 24 characters)
                and <code>VEYRA_AGENT_ENABLED=1</code> for Preview, then redeploy.
                Never enter an OpenAI API key on the website or expose it through VITE_* variables.
              </p>
              <a href="https://vercel.com/docs/environment-variables" target="_blank" rel="noreferrer"
                className="vp-text-button" style={{ display: 'inline-flex', gap: 5, marginTop: 8 }}>
                Vercel environment variable guide <ExternalLink size={13}/>
              </a>
            </div>
          </div>
        )}

        {ready && (
          <div style={{ marginBottom: 19 }}>
            <label className="vp-form-label" htmlFor="vp-agent-beta-code">
              <KeyRound size={14} style={{ display: 'inline', marginRight: 6 }}/>
              Private beta access code (VEYRA_AGENT_BETA_TOKEN)
            </label>
            <input id="vp-agent-beta-code" className="vp-form-input"
              type="password" autoComplete="off" spellCheck={false} value={accessCode}
              onChange={(event) => setAccessCode(event.target.value)}
              placeholder="Enter the beta access code configured in Vercel" maxLength={160}/>
            <p className="vp-caption" style={{ marginTop: 7 }}>
              The access code stays in memory for this page only. Never enter a wallet private key or seed phrase.
            </p>
          </div>
        )}

        <div className="vp-agent-conversation" aria-live="polite" style={{ minHeight: 275 }}>
          {messages.length === 0 ? (
            <div className="vp-empty-state" style={{ paddingTop: 38 }}>
              {ready ? <Sparkles size={32} color="#c5fb71" /> : <LockKeyhole size={32} color="#a7acc7" />}
              <h3>{ready ? 'Ask a question in any language.' : 'Live AI is not connected'}</h3>
              <p>{ready
                ? 'Veyra replies in your language, but cannot see private balances, sign transactions, or move USDC for you.'
                : 'No scripted fallback. Enable the live AI service on Vercel before chatting.'}</p>
            </div>
          ) : (
            <div className="vp-stack">
              {messages.map((item, i) => (
                <div key={i}
                  className={item.role === 'assistant' ? 'vp-agent-bubble vp-agent-response' : 'vp-agent-bubble'}
                  style={item.role === 'user' ? { marginLeft: '14%', whiteSpace: 'pre-wrap' } : { whiteSpace: 'pre-wrap' }}>
                  {item.text}
                </div>
              ))}
            </div>
          )}
          {busy && <p className="vp-caption" style={{ marginTop: 15 }}>Waiting for the AI response…</p>}
        </div>

        <div className="vp-agent-questions" style={{ marginBottom: 15 }}>
          {EXAMPLES.map((question) => (
            <button key={question} type="button" disabled={!ready || accessCode.trim().length < 24 || busy}
              onClick={() => void sendMessage(undefined, question)}>{question}</button>
          ))}
        </div>
        {error && <p className="vp-form-error" role="alert" style={{ marginBottom: 12 }}>{error}</p>}
        <form onSubmit={(event) => void sendMessage(event)} style={{ display: 'flex', gap: 10 }}>
          <input className="vp-form-input" aria-label="Ask Veyra" maxLength={1200} autoComplete="off"
            placeholder={ready ? 'Ask about Arc, USDC, or wallet safety in any language…' : 'Live AI is unavailable'}
            disabled={!ready || busy} value={input} onChange={(event) => setInput(event.target.value)}/>
          <button className="vp-primary" type="submit"
            disabled={!ready || busy || accessCode.trim().length < 24 || !input.trim()}>
            <ArrowRight size={17}/>
          </button>
        </form>
      </div>

      <div className="vp-form-note" style={{ marginTop: 18 }}>
        <ShieldCheck size={18} style={{ flex: 'none' }}/>
        <p>
          AI chat is informational only. To send testnet USDC, use <strong>Send & Pay</strong>,
          review the transfer, and authorize it in your own wallet. Convert and Bridge remain disabled pending backend deployment and live end-to-end acceptance.
        </p>
      </div>
      <button type="button" className="vp-text-button" style={{ marginTop: 18 }}
        onClick={() => onNavigate('pay')}>Open Arc Testnet Pay <ArrowRight size={15} style={{ display: 'inline' }}/></button>
    </div>
  );
}
