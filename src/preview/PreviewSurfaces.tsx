/**
 * Public-safe, illustrative Veyra product surfaces.
 * No network fetches, wallet integrations, persistent identities, receipts,
 * provider execution calls or private financial data.
 */
import { useState } from 'react';
import {
  Activity, ArrowRight, Bot, CheckCircle2, Compass,
  LockKeyhole, Route, SendHorizontal, ShieldCheck,
  Sparkles, Wallet,
} from 'lucide-react';
import type { VeyraPage } from '../components/layout/AppShell';

const samplePrompts = [
  'How would Veyra send 5 USDC?',
  'Explain Arc to Sepolia bridge safety',
  'What happens if a CCTP receive fails?',
];

const previewFeatures = [
  { title: 'Pay', caption: 'Recipient → policy → review', page: 'pay' as const, icon: SendHorizontal },
  { title: 'Ask Veyra', caption: 'Explain before acting', page: 'agent' as const, icon: Bot },
  { title: 'Bridge', caption: 'Attestation → mint → proof', page: 'bridge' as const, icon: Route },
  { title: 'Activity', caption: 'Immutable attempt history', page: 'activity' as const, icon: Activity },
];

export function PreviewHome({ onNavigate }: { onNavigate: (page: VeyraPage) => void }) {
  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 md:px-7">
      <section
        className="relative overflow-hidden rounded-3xl p-7 md:p-10"
        style={{
          background: 'linear-gradient(135deg, #1d304c, #111e32 70%, #1b294b)',
          border: '1px solid var(--border-strong)',
        }}
      >
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em]" style={{ color: 'var(--accent)' }}>
          <Sparkles className="size-4" /> Veyra on Arc · interactive UI preview
        </div>
        <h1 className="display mt-5 max-w-xl text-4xl font-black leading-tight md:text-5xl" style={{ color: 'var(--ink)' }}>
          Pay anyone. <span style={{ color: 'var(--accent)' }}>Understand every step.</span>
        </h1>
        <p className="mt-4 max-w-xl text-sm leading-7" style={{ color: 'var(--muted)' }}>
          Explore human-first USDC payments, deterministic review and recoverable CCTP bridges.
          This is a no-signature product walkthrough, not a connected financial service.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <button type="button" onClick={() => onNavigate('pay')}
            className="inline-flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-bold"
            style={{ background: 'var(--accent)', color: '#0b1b25' }}>
            Explore Pay <ArrowRight className="size-4" />
          </button>
          <button type="button" onClick={() => onNavigate('agent')}
            className="inline-flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-bold"
            style={{ background: 'var(--surface)', color: 'var(--ink)', border: '1px solid var(--border-strong)' }}>
            Ask Veyra <Bot className="size-4" />
          </button>
        </div>
      </section>

      <section>
        <h2 className="text-xl font-bold" style={{ color: 'var(--ink)' }}>Explore the product</h2>
        <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>Navigation and explanation only · no wallets or APIs are connected.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {previewFeatures.map(({ title, caption, page, icon: Icon }) => (
            <button key={page} type="button" onClick={() => onNavigate(page)}
              className="rounded-2xl p-5 text-left transition-transform hover:-translate-y-0.5"
              style={{ background: 'var(--surface-strong)', border: '1px solid var(--border)' }}>
              <Icon className="size-6" style={{ color: 'var(--accent)' }} />
              <h3 className="mt-4 text-lg font-bold" style={{ color: 'var(--ink)' }}>{title}</h3>
              <p className="mt-1 text-xs" style={{ color: 'var(--muted)' }}>{caption}</p>
            </button>
          ))}
        </div>
      </section>

      <div className="grid gap-3 sm:grid-cols-3">
        <PreviewStatus title="Wallet" detail="Not connected by design" icon={Wallet} />
        <PreviewStatus title="Backend" detail="No API calls in static demo" icon={Compass} />
        <PreviewStatus title="Transactions" detail="Signing and broadcast disabled" icon={LockKeyhole} />
      </div>
    </div>
  );
}

function PreviewStatus({ title, detail, icon: Icon }: {
  title: string; detail: string; icon: typeof Wallet;
}) {
  return (
    <div className="flex items-start gap-3 rounded-2xl p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
      <Icon className="mt-1 size-5 shrink-0" style={{ color: 'var(--accent)' }} />
      <div>
        <p className="text-sm font-bold" style={{ color: 'var(--ink)' }}>{title}</p>
        <p className="mt-1 text-xs leading-5" style={{ color: 'var(--muted)' }}>{detail}</p>
      </div>
    </div>
  );
}

function explanatoryReply(raw: string): string {
  const lower = raw.toLowerCase();
  if (/bridge|cctp|sepolia|mint|attestation/.test(lower)) {
    return 'Illustrative explanation: Veyra reviews the source burn, waits for one matching Circle attestation, and independently verifies the destination USDC mint. A missing receipt or uncertain transaction remains locked; source USDC must never be burned again just because a request timed out.';
  }
  if (/retry|fail|recover|revert|timeout/.test(lower)) {
    return 'Illustrative explanation: a destination receive can be retried only after a canonical, confirmed on-chain revert is proven. Each attempt has its own append-only history; uncertain broadcasts are not repeated automatically.';
  }
  if (/usdc|pay|send|transfer|recipient/.test(lower)) {
    return 'Illustrative explanation: Veyra would resolve a wallet or verified recipient, validate the network and token, enforce policy, show a deterministic review, then request a wallet signature only in an independently approved testnet build.';
  }
  return 'This static demo can explain Pay, Convert, Bridge and Activity, but it does not use a language model or read live chain state. Use the navigation to explore actual product screens. Real execution is deliberately unavailable.';
}

export function PreviewAgent({ onNavigate }: { onNavigate: (page: VeyraPage) => void }) {
  const [input, setInput] = useState('');
  const [question, setQuestion] = useState('');
  return (
    <div className="mx-auto max-w-3xl space-y-5 px-4 py-8 md:px-7">
      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--accent)' }}>
        <Bot className="size-4" /> Ask Veyra · scripted preview
      </div>
      <h1 className="display text-3xl font-extrabold" style={{ color: 'var(--ink)' }}>Understand the action before it happens.</h1>
      <p className="text-sm leading-6" style={{ color: 'var(--muted)' }}>
        Offline examples explain how Veyra works. This demo does not call an LLM, resolve real recipients, or make transaction decisions.
      </p>
      <div className="flex flex-wrap gap-2">
        {samplePrompts.map((sample) => (
          <button key={sample} type="button" onClick={() => { setInput(sample); setQuestion(sample); }}
            className="rounded-full px-3 py-2 text-xs font-semibold"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--ink)' }}>
            {sample}
          </button>
        ))}
      </div>
      <form onSubmit={(e) => { e.preventDefault(); const text = input.trim(); if (text) setQuestion(text.slice(0, 300)); }}>
        <label htmlFor="preview-agent-question" className="mb-2 block text-xs font-semibold" style={{ color: 'var(--muted)' }}>
          Type a question (illustrative replies only)
        </label>
        <div className="flex gap-2">
          <input id="preview-agent-question" value={input} maxLength={300}
            onChange={(e) => setInput(e.target.value)}
            placeholder="How does bridge recovery work?"
            className="min-w-0 flex-1 rounded-xl px-4 py-3 text-sm outline-none"
            style={{ background: 'var(--surface-strong)', color: 'var(--ink)', border: '1px solid var(--border-strong)' }} />
          <button type="submit" className="rounded-xl px-4 py-3 text-sm font-bold"
            style={{ background: 'var(--accent)', color: '#0b1b25' }}>Explain</button>
        </div>
      </form>
      {question && (
        <section aria-live="polite" className="space-y-3 rounded-2xl p-5"
          style={{ background: 'var(--surface-strong)', border: '1px solid var(--border-strong)' }}>
          <p className="text-xs font-semibold" style={{ color: 'var(--subtle)' }}>Your example: {question}</p>
          <p className="text-sm leading-7" style={{ color: 'var(--ink)' }}>{explanatoryReply(question)}</p>
          <p className="text-xs" style={{ color: 'var(--warning)' }}>Static illustration · not financial advice, transaction confirmation or live AI.</p>
        </section>
      )}
      <button type="button" onClick={() => onNavigate('bridge')}
        className="inline-flex items-center gap-2 text-sm font-semibold" style={{ color: 'var(--accent)' }}>
        Explore the CCTP bridge <ArrowRight className="size-4" />
      </button>
    </div>
  );
}

export function PreviewActivity() {
  return (
    <div className="mx-auto max-w-3xl space-y-5 px-4 py-8 md:px-7">
      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--accent)' }}>
        <Activity className="size-4" /> Activity · illustrative example
      </div>
      <h1 className="display text-3xl font-extrabold" style={{ color: 'var(--ink)' }}>Every attempt has a history.</h1>
      <p className="text-sm leading-6" style={{ color: 'var(--muted)' }}>
        No authenticated receipts are loaded in this standalone preview. The following timeline is fictional product copy, not a real transaction.
      </p>
      <div className="rounded-2xl p-5" style={{ background: 'var(--surface-strong)', border: '1px solid var(--border)' }}>
        {[
          ['Source review', 'Wallet confirms the original burn only once'],
          ['Circle attestation', 'Unique message bytes are checked against source evidence'],
          ['Destination receive', 'Matching USDC mint is verified on the destination chain'],
          ['Recovery', 'Uncertain submissions remain locked; attempt history is preserved'],
        ].map(([title, detail], i) => (
          <div key={title} className="flex items-start gap-3 py-3">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold"
              style={{ color: 'var(--accent)', background: 'var(--accent-muted)' }}>{i + 1}</span>
            <div>
              <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>{title}</p>
              <p className="mt-1 text-xs leading-5" style={{ color: 'var(--muted)' }}>{detail}</p>
            </div>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--warning)' }}>
        <LockKeyhole className="size-4" /> No wallet, recovery, signing or server ActivityReceipt in this build.
      </div>
    </div>
  );
}

export function PreviewSettings() {
  return (
    <div className="mx-auto max-w-3xl space-y-5 px-4 py-8 md:px-7">
      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--accent)' }}>
        <ShieldCheck className="size-4" /> Preview security posture
      </div>
      <h1 className="display text-3xl font-extrabold" style={{ color: 'var(--ink)' }}>Testnet product walkthrough</h1>
      <p className="text-sm leading-6" style={{ color: 'var(--muted)' }}>
        This Vercel build is an isolated React entrypoint; it does not load wallet connectors,
        finance execution modules, identity services, or backend API clients.
      </p>
      <div className="space-y-3">
        {[
          ['Static UI', 'Ready for non-financial evaluation'],
          ['Wallet signatures', 'Not included'],
          ['Circle & provider API', 'Not connected'],
          ['Database and receipts', 'Not connected'],
          ['Mainnet execution', 'Not permitted'],
        ].map(([title, status]) => (
          <div key={title} className="flex items-center justify-between gap-3 rounded-xl p-4"
            style={{ border: '1px solid var(--border)', background: 'var(--surface-strong)' }}>
            <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: 'var(--ink)' }}>
              <CheckCircle2 className="size-4" style={{ color: 'var(--accent)' }} /> {title}
            </div>
            <p className="text-right text-xs" style={{ color: 'var(--muted)' }}>{status}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
