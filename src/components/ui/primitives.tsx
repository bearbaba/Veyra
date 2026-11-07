/**
 * Shared Veyra UI primitives. They carry no financial logic: they only give
 * every page the same card, notice, status and transaction-progress language.
 */
import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info } from 'lucide-react';

export type Tone = 'info' | 'warning' | 'danger' | 'success';
const TONE_COLOR: Record<Tone, string> = {
  info: 'var(--muted)',
  warning: 'var(--warning)',
  danger: 'var(--danger)',
  success: 'var(--success)',
};

export function Card({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return (
    <section aria-label={label} className={`veyra-card p-5 sm:p-6 ${className}`.trim()}
      style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
      {children}
    </section>
  );
}

export function CardHeader({ title, caption, action }: { title: string; caption?: string; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-base font-bold" style={{ color: 'var(--ink)' }}>{title}</h2>
        {caption && <p className="mt-0.5 text-xs" style={{ color: 'var(--muted)' }}>{caption}</p>}
      </div>
      {action}
    </div>
  );
}

/** Inline message. Warnings and errors are announced; informational notices are polite. */
export function Notice({ tone = 'info', children, action }: { tone?: Tone; children: ReactNode; action?: ReactNode }) {
  const Icon = tone === 'success' ? CheckCircle2 : tone === 'info' ? Info : AlertTriangle;
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'}
      className="flex items-start gap-3 rounded-xl border p-3 text-sm"
      style={{ background: 'var(--surface)', borderColor: 'var(--border)', color: TONE_COLOR[tone] }}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">{children}</div>
      {action}
    </div>
  );
}

export function StatusPill({ tone = 'info', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold"
      style={{ color: TONE_COLOR[tone], borderColor: 'var(--border)', background: 'rgba(3,18,45,.55)' }}>
      {children}
    </span>
  );
}

/** The one transaction lifecycle every money flow follows. */
export const TX_STAGES = ['Enter details', 'Review', 'Confirm in wallet', 'Processing', 'Verified'] as const;
export type TxStage = typeof TX_STAGES[number];

export function txStageIndex(stage: TxStage): number {
  return TX_STAGES.indexOf(stage);
}

/**
 * Progress indicator for a transaction panel. `stalled` marks an operation whose
 * outcome is not yet known: it stays on the current step and is announced, so an
 * unresolved transaction is never shown as finished.
 */
export function TxStepper({ stage, stalled = false }: { stage: TxStage; stalled?: boolean }) {
  const current = txStageIndex(stage);
  return (
    <ol aria-label="Transaction progress" className="flex items-center gap-1.5">
      {TX_STAGES.map((name, index) => {
        const done = index < current || (index === current && stage === 'Verified');
        const active = index === current && !done;
        return (
          <li key={name} className="flex min-w-0 flex-1 flex-col gap-1.5" aria-current={active ? 'step' : undefined}>
            <span className="h-1 rounded-full" aria-hidden="true"
              style={{ background: done || active ? (stalled && active ? 'var(--warning)' : 'var(--accent)') : 'var(--border)' }} />
            <span className={`truncate text-[11px] ${active ? 'font-semibold max-[389px]:block' : 'max-[389px]:hidden'}`}
              style={{ color: active ? 'var(--ink)' : 'var(--muted)' }}>
              {name}
            </span>
          </li>
        );
      })}
      {stalled && <li className="sr-only">Outcome not yet confirmed. Do not submit again.</li>}
    </ol>
  );
}
