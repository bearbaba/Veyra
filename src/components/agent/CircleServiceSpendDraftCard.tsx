import { useEffect, useState } from 'react';
import { getChain } from '@/onchain-facts';
import { AlertTriangle, CheckCircle2, Clock3, LockKeyhole, ShieldCheck } from 'lucide-react';
import {
  isCircleServiceDraftFresh,
  type CircleServiceSpendDraft,
} from '@/core/agent/circleServiceSpendDraft';

export function CircleServiceSpendDraftCard({ draft }: { draft: CircleServiceSpendDraft }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timeout = window.setTimeout(() => setNow(Date.now()), Math.max(0, draft.expiresAt - Date.now()) + 10);
    return () => window.clearTimeout(timeout);
  }, [draft.expiresAt]);
  const fresh = isCircleServiceDraftFresh(draft, now);
  return (
    <section className="mt-3 rounded-2xl p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border-strong)' }} aria-label="Unapproved Circle service draft">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-bold" style={{ color: 'var(--ink)' }}>
          <ShieldCheck className="size-4" style={{ color: 'var(--accent)' }} />
          Circle service plan
        </div>
        <span className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-bold" style={{ background: 'var(--accent-muted)', color: fresh ? 'var(--accent)' : 'var(--warning)' }}>
          {fresh ? <Clock3 className="size-3" /> : <AlertTriangle className="size-3" />}
          {fresh ? 'Review draft · no permission' : 'Expired snapshot'}
        </span>
      </div>
      <p className="mt-2 text-sm font-semibold" style={{ color: 'var(--ink)' }}>{draft.serviceTitle}</p>
      <p className="mt-1 break-all text-[11px]" style={{ color: 'var(--muted)' }}>{draft.provider} · {/^eip155:(\d+)$/.test(draft.network) ? (getChain(Number(draft.network.slice(7)))?.name ?? draft.network) : draft.network}</p>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        {[
          ['Calls', String(draft.calls)],
          ['Per call', draft.unitPriceUsdc + ' USDC'],
          ['Est. total', draft.totalUsdc + ' USDC'],
          ['Draft budget', draft.budgetUsdc + ' USDC'],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl p-2.5" style={{ background: 'var(--surface-strong)', border: '1px solid var(--border)' }}>
            <div className="text-[10px]" style={{ color: 'var(--subtle)' }}>{label}</div>
            <div className="mt-1 break-words font-bold" style={{ color: 'var(--ink)' }}>{value}</div>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-start gap-2 text-[11px] leading-5" style={{ color: 'var(--muted)' }}>
        <LockKeyhole className="mt-0.5 size-4 shrink-0" style={{ color: 'var(--warning)' }} />
        {fresh
          ? 'Not authorized. No agent wallet, spending policy, payment, or paid API call was created. Provider pricing must be rechecked.'
          : 'This draft is expired. Search the catalog again to get updated pricing. It can never authorize a transaction.'}
      </div>
      {fresh && (
        <p className="mt-2 flex items-center gap-1 text-[10px]" style={{ color: 'var(--success)' }}>
          <CheckCircle2 className="size-3" /> A budget preview was checked; execution remains disabled.
        </p>
      )}
    </section>
  );
}
