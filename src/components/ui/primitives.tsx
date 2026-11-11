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

/** Only presentation is condensed. Financial operations keep all five internal states. */
export const TX_DISPLAY_STEPS = ['Review', 'Confirm', 'Track'] as const;
export type TxDisplayStep = typeof TX_DISPLAY_STEPS[number];

export function txDisplayStep(stage: TxStage): TxDisplayStep {
  if (stage === 'Enter details' || stage === 'Review') return 'Review';
  if (stage === 'Confirm in wallet') return 'Confirm';
  return 'Track';
}

/**
 * Quiet progress line: three familiar words, no nested box or step numbers.
 * This is presentation only. UNKNOWN/PENDING remain unverified and locked.
 * An accessible status announcement retains the complete safety explanation.
 */
export function TxStepper({ stage, stalled = false }: { stage: TxStage; stalled?: boolean }) {
  const display = txDisplayStep(stage);
  const current = TX_DISPLAY_STEPS.indexOf(display);
  const complete = stage === 'Verified';
  const screenReaderDetail = complete ? 'Transaction verified onchain' :
    stalled ? 'Outcome unresolved. Do not submit again.' :
    stage === 'Processing' ? 'Processing. Awaiting onchain verification.' :
    stage === 'Confirm in wallet' ? 'Confirm in your wallet.' :
    'Review amount, recipient and fees.';

  return (
    <div aria-label="Transaction progress" className="py-0.5">
      <ol className="flex flex-wrap items-center gap-y-2 text-[11px] sm:text-xs" role="list">
        {TX_DISPLAY_STEPS.map((name, index) => {
          const done = index < current || (index === current && complete);
          const active = index === current && !complete;
          const tone = stalled && active ? 'var(--warning)' :
            complete ? 'var(--success)' : active ? 'var(--accent)' :
            done ? 'var(--muted)' : 'var(--subtle)';
          return (
            <li key={name} aria-current={active ? 'step' : undefined}
              className="inline-flex min-w-0 items-center gap-2">
              <span className="size-1.5 shrink-0 rounded-full" aria-hidden="true"
                style={{ background: tone }} />
              <span className={'veyra-step-label '+(active ? 'font-semibold' : 'font-medium')}
                style={{ color: tone }}>{name}</span>
              {index < TX_DISPLAY_STEPS.length - 1 &&
                <span className="mx-3 h-px w-4 sm:mx-4 sm:w-5" aria-hidden="true"
                  style={{ background: 'var(--border-strong)' }} />}
            </li>
          );
        })}
      </ol>
      <span role="status" className="sr-only">{screenReaderDetail}</span>
    </div>
  );
}
