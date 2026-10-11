/**
 * Zero-signature exploration surface used by the static Vercel build.
 * This component never imports providers, wallet clients, execution hooks,
 * backend APIs, quote services or transaction signing capabilities.
 */
import { useState } from 'react';
import { ArrowLeftRight, ArrowRight, LockKeyhole, Route, SendHorizontal, ShieldCheck } from 'lucide-react';

export type UiOnlyPreviewSurface = 'pay' | 'convert' | 'bridge';

const DETAILS: Record<UiOnlyPreviewSurface, {
  title: string;
  subtitle: string;
  steps: readonly string[];
}> = {
  pay: {
    title: 'Pay a person, not a chain.',
    subtitle: 'Explore how Veyra resolves recipients, reviews USDC payments and protects the signing step.',
    steps: ['Recipient identity', 'Route & token check', 'Safety review', 'Wallet signature', 'Verified receipt'],
  },
  convert: {
    title: 'Convert with a reviewed quote.',
    subtitle: 'Preview how a Circle StableFX route would be compared and checked before a signature.',
    steps: ['Choose assets', 'Fetch fresh quote', 'Review fees & policy', 'Approve conversion', 'Verify receipt'],
  },
  bridge: {
    title: 'Bridge USDC with evidence.',
    subtitle: 'Explore Arc Testnet to Sepolia/Base Sepolia CCTP with crash-safe, no-reburn recovery.',
    steps: ['Select destination', 'Review source burn', 'Circle attestation', 'Destination mint', 'Recovery & receipt'],
  },
};

export function UiOnlyPreviewPage({ surface }: { surface: UiOnlyPreviewSurface }) {
  const [destination, setDestination] = useState<'Ethereum Sepolia' | 'Base Sepolia'>('Ethereum Sepolia');
  const details = DETAILS[surface];
  const Symbol = surface === 'pay' ? SendHorizontal : surface === 'bridge' ? Route : ArrowLeftRight;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-8 md:px-7">
      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em]" style={{ color: 'var(--accent)' }}>
        <ShieldCheck className="size-4" /> Interactive product preview
      </div>

      <section className="rounded-3xl p-6 md:p-8" style={{ background: 'var(--surface-strong)', border: '1px solid var(--border-strong)' }}>
        <div className="flex items-center gap-3">
          <div className="rounded-2xl p-3" style={{ color: 'var(--accent)', background: 'var(--accent-muted)' }}>
            <Symbol className="size-6" />
          </div>
          <span className="rounded-full px-3 py-1 text-xs font-semibold" style={{ color: 'var(--warning)', background: 'var(--warning-muted)' }}>
            Execution locked
          </span>
        </div>
        <h1 className="display mt-5 text-3xl font-extrabold md:text-4xl" style={{ color: 'var(--ink)' }}>{details.title}</h1>
        <p className="mt-3 max-w-xl text-sm leading-6" style={{ color: 'var(--muted)' }}>{details.subtitle}</p>

        {surface === 'bridge' && (
          <div className="mt-6 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--subtle)' }}>Explore destination routes</p>
            <div className="flex flex-wrap gap-2">
              {(['Ethereum Sepolia', 'Base Sepolia'] as const).map((chain) => (
                <button
                  key={chain}
                  type="button"
                  onClick={() => setDestination(chain)}
                  aria-pressed={destination === chain}
                  className="rounded-xl px-4 py-2 text-sm font-semibold transition-colors"
                  style={{
                    color: destination === chain ? 'var(--accent)' : 'var(--muted)',
                    background: destination === chain ? 'var(--accent-muted)' : 'var(--surface)',
                    border: '1px solid var(--border-strong)',
                  }}
                >
                  {chain}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 pt-2 text-sm" style={{ color: 'var(--muted)' }}>
              Arc Testnet <ArrowRight className="size-4" /> {destination}
            </div>
          </div>
        )}

        <ol className="mt-7 grid gap-3 md:grid-cols-5">
          {details.steps.map((step, index) => (
            <li key={step} className="rounded-xl p-3" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <span className="font-mono text-xs" style={{ color: 'var(--accent)' }}>{String(index + 1).padStart(2, '0')}</span>
              <p className="mt-2 text-xs font-semibold leading-5" style={{ color: 'var(--ink)' }}>{step}</p>
            </li>
          ))}
        </ol>
      </section>

      <div className="flex items-start gap-3 rounded-2xl p-5" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <LockKeyhole className="mt-0.5 size-5 shrink-0" style={{ color: 'var(--warning)' }} />
        <div>
          <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>No funds, signatures or transactions in this build</p>
          <p className="mt-1 text-sm leading-6" style={{ color: 'var(--muted)' }}>
            This Vercel static preview demonstrates the product structure only. Real recipient resolution,
            quotes, execution, receipts and CCTP recovery require an authenticated BFF, PostgreSQL,
            independent chain verification and an approved testnet release. This screen cannot submit
            a blockchain action, even if you connect a wallet elsewhere in Veyra.
          </p>
        </div>
      </div>
    </div>
  );
}
