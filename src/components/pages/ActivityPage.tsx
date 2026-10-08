/**
 * Veyra Activity Page
 *
 * Full VeyraReceipt history from IndexedDB. Every receipt links to
 * the chain explorer for the real transaction hash.
 */

import { buildTxExplorerUrl } from '@/onchain-facts';
import { useReceiptStore } from '@/hooks/useReceiptStore';
import { LayoutList, ExternalLink, Clock } from 'lucide-react';
import type { VeyraReceipt } from '@/core/receipt/receiptTypes';

export function ActivityPage() {
  const { receipts, loading } = useReceiptStore();

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="display text-2xl font-bold" style={{ color: 'var(--ink)', letterSpacing: '-0.02em' }}>
          Activity
        </h1>
        <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
          Veyra Receipts — every completed action
        </p>
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-20 rounded-2xl animate-pulse"
              style={{ background: 'var(--surface)' }} />
          ))}
        </div>
      ) : receipts.length === 0 ? (
        <div className="rounded-2xl p-8 text-center"
          style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <LayoutList className="size-8 mx-auto mb-3" style={{ color: 'var(--subtle)' }} />
          <p className="text-sm" style={{ color: 'var(--muted)' }}>No activity yet</p>
          <p className="text-xs mt-1" style={{ color: 'var(--subtle)' }}>
            Completed financial actions will appear here.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {receipts.map((r) => <ReceiptCard key={r.receiptId} receipt={r} />)}
        </div>
      )}
    </div>
  );
}

function ReceiptCard({ receipt }: { receipt: VeyraReceipt }) {
  const txUrl = receipt.executionTxHash && receipt.chainId
    ? buildTxExplorerUrl(receipt.chainId, receipt.executionTxHash)
    : null;

  const statusColor =
    receipt.status === 'VERIFIED' ? 'var(--success)' :
    receipt.status === 'FAILED'   ? 'var(--danger)'  :
    receipt.status === 'PENDING'  ? 'var(--warning)' :
    'var(--muted)';

  const statusBg =
    receipt.status === 'VERIFIED' ? 'var(--success-muted)' :
    receipt.status === 'FAILED'   ? 'var(--danger-muted)'  :
    receipt.status === 'PENDING'  ? 'var(--warning-muted)' :
    'var(--surface)';

  return (
    <div
      className="rounded-2xl p-4 space-y-3"
      style={{ background: 'var(--surface-strong)', border: '1px solid var(--border)' }}
    >
      {/* Header row */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
            {receipt.actionType}
          </span>
          <span
            className="text-xs px-2 py-0.5 rounded-full font-medium"
            style={{ background: statusBg, color: statusColor }}
          >
            {receipt.status}
          </span>
        </div>
        {txUrl ? (
          <a
            href={txUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 text-xs"
            style={{ color: 'var(--accent)' }}
          >
            View tx <ExternalLink className="size-3" />
          </a>
        ) : null}
      </div>

      {/* Receipt ID */}
      <div className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--subtle)' }}>
        <span className="mono">{receipt.receiptId.slice(0, 32)}...</span>
      </div>

      {/* Details grid */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
        {receipt.executionTxHash && (
          <DetailRow label="Tx hash" value={`${receipt.executionTxHash.slice(0, 10)}...`} mono />
        )}
        {receipt.actualAmountDelta != null && (
          <DetailRow
            label="Amount"
            value={receipt.actualAmountDelta.toString()}
          />
        )}
        {receipt.riskScore != null && (
          <DetailRow label="Risk score" value={`${receipt.riskScore}/100`} />
        )}
        {receipt.policyDecision && (
          <DetailRow label="Policy" value={receipt.policyDecision} />
        )}
      </div>

      {/* Timestamp */}
      <div className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--subtle)' }}>
        <Clock className="size-3" />
        {new Date(receipt.createdAt).toLocaleString()}
      </div>

      {/* Display summary — LLM generated, display only */}
      {receipt.displaySummary && (
        <p className="text-xs italic pt-1 border-t" style={{ color: 'var(--subtle)', borderColor: 'var(--border)' }}>
          {receipt.displaySummary}
        </p>
      )}
    </div>
  );
}

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <span className="text-xs" style={{ color: 'var(--subtle)' }}>{label}</span>
      <p className={`text-xs mt-0.5 font-medium truncate ${mono ? 'mono' : ''}`} style={{ color: 'var(--ink-2)' }}>
        {value}
      </p>
    </div>
  );
}
