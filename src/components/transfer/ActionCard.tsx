import { ArrowRight, CheckCircle2, HelpCircle, ShieldCheck } from 'lucide-react';
import type { IntentResult, IntentCandidate } from '@/core/intent/intentSchema';
import type { VeyraPage } from '../layout/AppShell';

interface ActionCardProps {
  intent: IntentResult;
  onNavigate: (page: VeyraPage) => void;
}

export function ActionCard({ intent, onNavigate }: ActionCardProps) {
  const best = intent.candidates[0];
  if (!best) return null;

  const isTransfer = best.actionType === 'TRANSFER';
  const isConvert = best.actionType === 'CONVERT';
  const isBridge = best.actionType === 'BRIDGE';
  const isUnsupported = intent.status === 'UNSUPPORTED';
  const needsClarification = intent.status === 'NEEDS_CLARIFICATION' || intent.status === 'AMBIGUOUS';
  const isActionable = (isTransfer || isConvert || isBridge) && !isUnsupported && !needsClarification;

  function handleProceed() {
    if (!isActionable) return;
    sessionStorage.setItem('veyra:agent-intent', JSON.stringify(best));
    if (isTransfer) onNavigate('pay');
    else if (isConvert) onNavigate('convert');
    else if (isBridge) onNavigate('bridge');
  }

  const title = isTransfer ? 'Payment intent' : isConvert ? 'Conversion intent' : isBridge ? 'Cross-chain intent' : best.actionType;

  return (
    <div className="overflow-hidden rounded-3xl" style={{ background: 'linear-gradient(145deg,rgba(23,43,67,0.98),rgba(16,31,51,0.98))', border: '1px solid var(--border-strong)' }}>
      <div className="flex items-center justify-between gap-3 border-b px-4 py-3.5" style={{ borderColor: 'var(--border)' }}>
        <div className="flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-xl" style={{ background: 'var(--accent-muted)', color: 'var(--accent)' }}>
            {needsClarification ? <HelpCircle className="size-4" /> : <CheckCircle2 className="size-4" />}
          </span>
          <div>
            <div className="text-sm font-bold" style={{ color: 'var(--ink)' }}>{title}</div>
            <div className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--subtle)' }}>Agent proposal · {(best.confidence * 100).toFixed(0)}% confidence</div>
          </div>
        </div>
        <span className="rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-wider" style={{ background: needsClarification ? 'var(--warning-muted)' : 'var(--success-muted)', color: needsClarification ? 'var(--warning)' : 'var(--success)' }}>
          {needsClarification ? 'Needs input' : 'Ready to review'}
        </span>
      </div>

      <div className="grid gap-2 p-4 sm:grid-cols-2">
        {best.amountRaw && <Detail label="Amount" value={best.amountRaw.raw} />}
        {best.tokenRaw && <Detail label={isConvert ? 'From asset' : 'Asset'} value={best.tokenRaw.raw} />}
        {best.targetTokenRaw && <Detail label="To asset" value={best.targetTokenRaw.raw} />}
        {best.recipientRaw && <Detail label="Recipient" value={best.recipientRaw.raw} />}
        {best.sourceChainRaw && <Detail label="From network" value={best.sourceChainRaw.raw} />}
        {best.destinationChainRaw && <Detail label="Destination" value={best.destinationChainRaw.raw} />}
      </div>

      <div className="flex items-start gap-2 border-t px-4 py-3" style={{ borderColor: 'var(--border)', background: 'rgba(255,255,255,0.018)' }}>
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0" style={{ color: 'var(--accent)' }} />
        <p className="text-[11px] leading-5" style={{ color: 'var(--subtle)' }}>
          This is an interpretation, not an executable transaction. Veyra resolves identity and verifies route, policy, amounts and onchain state again before your wallet can sign.
        </p>
      </div>

      {isActionable && (
        <div className="border-t p-3" style={{ borderColor: 'var(--border)' }}>
          <button onClick={handleProceed} className="flex w-full items-center justify-center gap-2 rounded-2xl py-3 text-sm font-bold transition-transform hover:scale-[1.01]" style={{ background: 'linear-gradient(135deg,#c8ff65,#91e9b5)', color: '#0b1b25' }}>
            Review {isTransfer ? 'payment' : isConvert ? 'conversion' : 'route'} <ArrowRight className="size-4" />
          </button>
        </div>
      )}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl px-3.5 py-3" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
      <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--subtle)' }}>{label}</div>
      <div className="mono mt-1 truncate text-xs font-semibold" style={{ color: 'var(--ink-2)' }}>{value}</div>
    </div>
  );
}

export type { IntentCandidate };
