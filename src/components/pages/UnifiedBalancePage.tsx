/**
 * Unified Balance is an independent, read-only primary product surface.
 * Financial actions must be opened deliberately in their own flows.
 */
import { Layers3, ShieldCheck } from 'lucide-react';
import { AgentUnifiedBalances } from '../agent/AgentUnifiedBalances';

export function UnifiedBalancePage() {
  return (
    <main aria-label="Unified Balance page" className="mx-auto w-full max-w-5xl space-y-5 px-4 py-7 md:px-7 md:py-9">
      <header className="space-y-2">
        <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em]"
          style={{ color:'var(--accent)' }}>
          <Layers3 className="size-4" /> Portfolio · Testnet
        </div>
        <h1 className="display text-3xl font-black tracking-tight" style={{ color:'var(--ink)' }}>Unified Balance</h1>
        <p className="max-w-2xl text-sm leading-6" style={{ color:'var(--muted)' }}>
          Your USDC on Arc Testnet, Ethereum Sepolia and Base Sepolia in one place.
          Review balances without preparing a transfer or switching signing networks.
        </p>
      </header>
      <section className="rounded-3xl border p-4 sm:p-6"
        style={{ borderColor:'var(--border-strong)', background:'var(--surface)' }}>
        <AgentUnifiedBalances />
      </section>
      <section className="flex items-start gap-3 rounded-2xl border p-4"
        style={{ borderColor:'var(--border)', background:'var(--surface-muted)' }}>
        <ShieldCheck className="mt-0.5 size-4 shrink-0" style={{ color:'var(--success)' }} />
        <p className="text-xs leading-5" style={{ color:'var(--muted)' }}>
          Read-only portfolio · A combined amount is for display, not pooled spendable funds.
          Send, Swap and Bridge are separate actions, each requiring a fresh review and explicit
          wallet approval where enabled. No transfer is initiated from this page.
        </p>
      </section>
    </main>
  );
}
