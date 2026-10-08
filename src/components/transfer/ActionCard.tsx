/**
 * Veyra Action Card
 *
 * Rendered by the Agent page when the BFF returns a validated IntentResult
 * with candidates. Shows the proposed action in a structured format and
 * routes the user to the Pay page if the action is TRANSFER.
 *
 * The card does NOT execute anything — it navigates the user to the
 * appropriate form where the full pipeline runs.
 */

import { ArrowRight, AlertTriangle, Info } from 'lucide-react';
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
  const isActionable = isTransfer || isConvert || isBridge;

  function handleProceed() {
    sessionStorage.setItem('veyra:agent-intent', JSON.stringify(best));
    if (isTransfer) onNavigate('pay');
    else if (isConvert) onNavigate('convert');
    else if (isBridge) onNavigate('bridge');
  }

  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{ border: '1px solid var(--border-strong)' }}
    >
      {/* Action header */}
      <div
        className="flex items-center justify-between px-4 py-3 border-b"
        style={{ background: 'var(--surface-elevated)', borderColor: 'var(--border)' }}
      >
        <div className="flex items-center gap-2">
          <span
            className="text-xs px-2 py-0.5 rounded-full font-semibold uppercase tracking-wider"
            style={{ background: 'var(--accent-muted)', color: 'var(--accent)' }}
          >
            {best.actionType}
          </span>
          <span className="text-xs" style={{ color: 'var(--muted)' }}>
            {(best.confidence * 100).toFixed(0)}% confidence
          </span>
        </div>
        <span className="text-xs" style={{ color: 'var(--subtle)' }}>Agent proposal</span>
      </div>

      {/* Candidate details */}
      <div className="px-4 py-3 space-y-2" style={{ background: 'var(--surface)' }}>
        {best.amountRaw && (
          <CandidateRow label="Amount" value={best.amountRaw.raw} untrusted />
        )}
        {best.tokenRaw && (
          <CandidateRow label="Token" value={best.tokenRaw.raw} untrusted />
        )}
        {best.recipientRaw && (
          <CandidateRow label="To" value={best.recipientRaw.raw} untrusted />
        )}
        {best.sourceChainRaw && (
          <CandidateRow label="From chain" value={best.sourceChainRaw.raw} untrusted />
        )}
        {best.destinationChainRaw && (
          <CandidateRow label="To chain" value={best.destinationChainRaw.raw} untrusted />
        )}
        {best.providerRaw && (
          <CandidateRow label="Provider" value={best.providerRaw.raw} untrusted />
        )}
      </div>

      {/* Warning: untrusted values */}
      <div
        className="flex items-start gap-2 px-4 py-2.5 border-t"
        style={{ background: 'var(--warning-muted)', borderColor: 'var(--border)' }}
      >
        <Info className="size-3.5 mt-0.5 shrink-0" style={{ color: 'var(--warning)' }} />
        <p className="text-xs" style={{ color: 'var(--muted)' }}>
          Values above are Agent-provided and unverified. They will be resolved against
          onchain state before execution. Review carefully.
        </p>
      </div>

      {/* Unsupported / blocked */}
      {isUnsupported && (
        <div
          className="flex items-start gap-2 px-4 py-2.5 border-t"
          style={{ background: 'var(--danger-muted)', borderColor: 'var(--border)' }}
        >
          <AlertTriangle className="size-3.5 mt-0.5 shrink-0" style={{ color: 'var(--danger)' }} />
          <p className="text-xs" style={{ color: 'var(--danger)' }}>
            This action type is not yet supported or its provider is not verified.
          </p>
        </div>
      )}

      {/* CTA */}
      {!isUnsupported && isActionable && (
        <div className="px-4 py-3 border-t" style={{ borderColor: 'var(--border)' }}>
          <button
            onClick={handleProceed}
            className="w-full flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold transition-all hover:scale-[1.01] active:scale-[0.99]"
            style={{ background: 'var(--accent-muted)', color: 'var(--accent)', border: '1px solid var(--border-strong)' }}
          >
            {isTransfer ? 'Proceed to Pay' : isConvert ? 'Proceed to Convert' : 'Proceed to Bridge'}
            <ArrowRight className="size-4" />
          </button>
        </div>
      )}
    </div>
  );
}

function CandidateRow({ label, value, untrusted }: { label: string; value: string; untrusted?: boolean }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span style={{ color: 'var(--muted)' }}>{label}</span>
      <span
        className="text-xs font-mono px-1.5 py-0.5 rounded"
        style={{
          background: untrusted ? 'var(--warning-muted)' : 'var(--surface)',
          color: untrusted ? 'var(--warning)' : 'var(--ink-2)',
        }}
      >
        {value}
      </span>
    </div>
  );
}

// Need to export IntentCandidate usage for the component
export type { IntentCandidate };
