/**
 * Veyra Receipt UI
 *
 * Renders a VeyraReceipt after a completed action.
 * Numeric and authoritative values come from deterministic execution data.
 * The displaySummary (LLM-generated) is clearly labelled as display-only.
 */

import { CheckCircle2, XCircle, Clock, ExternalLink, Shield } from 'lucide-react';
import { formatUnits } from 'viem';
import type { VeyraReceipt } from '@/core/receipt/receiptTypes';

interface VeyraReceiptViewProps {
  receipt: VeyraReceipt;
  explorerUrl: string | null;
}

export function VeyraReceiptView({ receipt, explorerUrl }: VeyraReceiptViewProps) {
  const isVerified = receipt.status === 'VERIFIED';
  const isFailed   = receipt.status === 'FAILED';

  const statusColor = isVerified ? 'var(--success)' : isFailed ? 'var(--danger)' : 'var(--warning)';
  const statusBg    = isVerified ? 'var(--success-muted)' : isFailed ? 'var(--danger-muted)' : 'var(--warning-muted)';
  const StatusIcon  = isVerified ? CheckCircle2 : isFailed ? XCircle : Clock;

  return (
    <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
      {/* Status header */}
      <div
        className="flex items-center gap-3 px-4 py-3"
        style={{ background: statusBg }}
      >
        <StatusIcon className="size-5 shrink-0" style={{ color: statusColor }} />
        <div className="flex-1">
          <p className="text-sm font-semibold" style={{ color: statusColor }}>
            {isVerified ? 'Transfer Verified' : isFailed ? 'Transfer Failed' : 'Pending'}
          </p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
            {receipt.actionType} · {new Date(receipt.completedAt ?? receipt.createdAt).toLocaleString()}
          </p>
        </div>
        {explorerUrl && (
          <a
            href={explorerUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 text-xs shrink-0"
            style={{ color: statusColor }}
          >
            <ExternalLink className="size-3" />
            ArcScan
          </a>
        )}
      </div>

      {/* Receipt body */}
      <div className="px-4 py-4 space-y-3" style={{ background: 'var(--surface)' }}>
        {/* Receipt ID */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--subtle)' }}>
            Receipt ID
          </p>
          <p className="mono text-xs break-all" style={{ color: 'var(--ink-2)' }}>
            {receipt.receiptId}
          </p>
        </div>

        {/* Amount */}
        {receipt.actualAmountDelta != null && (
          <div className="flex items-center justify-between">
            <span className="text-xs" style={{ color: 'var(--muted)' }}>Amount sent</span>
            <span className="display text-xl font-bold tabular-nums" style={{ color: 'var(--ink)' }}>
              {formatUnits(receipt.actualAmountDelta, 6)}{' '}
              <span className="text-sm font-medium" style={{ color: 'var(--muted)' }}>USDC</span>
            </span>
          </div>
        )}

        {/* Tx hash */}
        {receipt.executionTxHash && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--subtle)' }}>
              Transaction
            </p>
            <p className="mono text-xs break-all" style={{ color: 'var(--ink-2)' }}>
              {receipt.executionTxHash}
            </p>
          </div>
        )}

        {/* Block */}
        {receipt.executionBlock != null && (
          <div className="flex items-center justify-between text-xs">
            <span style={{ color: 'var(--muted)' }}>Block</span>
            <span className="mono" style={{ color: 'var(--ink-2)' }}>{receipt.executionBlock.toLocaleString()}</span>
          </div>
        )}

        {/* Policy + Risk */}
        <div className="flex gap-2 pt-1">
          {receipt.policyDecision && (
            <span className="text-xs px-2 py-0.5 rounded-full"
              style={{ background: 'var(--success-muted)', color: 'var(--success)' }}>
              Policy: {receipt.policyDecision}
            </span>
          )}
          {receipt.riskScore != null && (
            <span className="text-xs px-2 py-0.5 rounded-full"
              style={{ background: 'var(--surface-muted)', color: 'var(--muted)' }}>
              Risk: {receipt.riskScore}/100
            </span>
          )}
        </div>

        {/* Verification note */}
        {isVerified && (
          <div className="flex items-start gap-2 rounded-xl p-3"
            style={{ background: 'var(--success-muted)', border: '1px solid var(--border)' }}>
            <Shield className="size-3.5 mt-0.5 shrink-0" style={{ color: 'var(--success)' }} />
            <p className="text-xs" style={{ color: 'var(--muted)' }}>
              Final chain state verified. Actual token delta confirmed onchain.
            </p>
          </div>
        )}

        {/* Display summary — LLM-generated, display only */}
        {receipt.displaySummary && (
          <div className="pt-2 border-t" style={{ borderColor: 'var(--border)' }}>
            <p className="text-xs mb-1" style={{ color: 'var(--subtle)' }}>Summary (display only)</p>
            <p className="text-xs italic" style={{ color: 'var(--muted)' }}>
              {receipt.displaySummary}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
