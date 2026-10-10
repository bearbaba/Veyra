/**
 * Veyra Activity Page
 *
 * Local receipt cache plus resumable bridge operations. PostgreSQL remains the
 * system of record for authenticated durable recovery; chain/provider state is
 * authoritative for execution truth.
 */

import { useEffect, useState } from 'react';
import { useAccount } from 'wagmi';
import { buildTxExplorerUrl } from '@/onchain-facts';
import { useReceiptStore } from '@/hooks/useReceiptStore';
import { useBridgeExecution } from '@/hooks/useBridgeExecution';
import {
  ExternalLink,
  Clock,
  LayoutList,
  AlertTriangle,
  Loader2,
} from 'lucide-react';
import type { VeyraReceipt } from '@/core/receipt/receiptTypes';
import {
  nextBridgeResumeInstruction,
  type BridgeRecoveryCheckpoint,
} from '@/core/execution/bridgeCheckpointStore';

export function ActivityPage() {
  const { isConnected } = useAccount();
  const { receipts, loading, reload } = useReceiptStore();
  const bridgeExecution = useBridgeExecution();
  const [recoveryCandidates, setRecoveryCandidates] = useState<
    BridgeRecoveryCheckpoint[]
  >([]);

  useEffect(() => {
    let active = true;

    void bridgeExecution
      .loadRecoveryCandidates()
      .then((rows) => {
        if (active) setRecoveryCandidates(rows);
      })
      .catch(() => {
        if (active) setRecoveryCandidates([]);
      });

    return () => {
      active = false;
    };
  }, [bridgeExecution.loadRecoveryCandidates]);

  async function resume(checkpoint: BridgeRecoveryCheckpoint) {
    await bridgeExecution.resumeBridge(checkpoint);
    await reload();
    setRecoveryCandidates(await bridgeExecution.loadRecoveryCandidates());
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <div className="mb-6">
        <h1
          className="display text-2xl font-bold"
          style={{ color: 'var(--ink)', letterSpacing: '-0.02em' }}
        >
          Activity
        </h1>
        <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
          Receipts and in-flight actions that still need attention
        </p>
      </div>

      {recoveryCandidates.length > 0 && (
        <div className="mb-6 space-y-3">
          {recoveryCandidates.map((checkpoint) => (
            <RecoveryCard
              key={checkpoint.planId}
              checkpoint={checkpoint}
              connected={isConnected}
              busy={bridgeExecution.state.phase !== 'IDLE'}
              onResume={() => void resume(checkpoint)}
            />
          ))}
        </div>
      )}

      {bridgeExecution.state.phase !== 'IDLE' &&
        bridgeExecution.state.phase !== 'VERIFIED' && (
          <div
            className="mb-6 flex items-start gap-3 rounded-2xl p-4"
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
            }}
          >
            <Loader2
              className="size-4 mt-0.5 shrink-0 animate-spin"
              style={{ color: 'var(--accent)' }}
            />
            <div>
              <p
                className="text-sm font-semibold"
                style={{ color: 'var(--ink)' }}
              >
                Bridge recovery: {bridgeExecution.state.phase}
              </p>
              {bridgeExecution.state.error && (
                <p
                  className="mt-1 text-xs"
                  style={{ color: 'var(--muted)' }}
                >
                  {bridgeExecution.state.error}
                </p>
              )}
            </div>
          </div>
        )}

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-20 rounded-2xl animate-pulse"
              style={{ background: 'var(--surface)' }}
            />
          ))}
        </div>
      ) : receipts.length === 0 ? (
        <div
          className="rounded-2xl p-8 text-center"
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
          }}
        >
          <LayoutList
            className="size-8 mx-auto mb-3"
            style={{ color: 'var(--subtle)' }}
          />
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            No completed activity yet
          </p>
          <p className="text-xs mt-1" style={{ color: 'var(--subtle)' }}>
            Verified and failed financial actions will appear here.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {receipts.map((receipt) => (
            <ReceiptCard key={receipt.receiptId} receipt={receipt} />
          ))}
        </div>
      )}
    </div>
  );
}

function RecoveryCard({
  checkpoint,
  connected,
  busy,
  onResume,
}: {
  checkpoint: BridgeRecoveryCheckpoint;
  connected: boolean;
  busy: boolean;
  onResume: () => void;
}) {
  const instruction = nextBridgeResumeInstruction(checkpoint);

  return (
    <div
      className="rounded-2xl p-4"
      style={{
        background: 'var(--warning-muted)',
        border: '1px solid var(--warning)',
      }}
    >
      <div className="flex items-start gap-3">
        <AlertTriangle
          className="size-4 mt-0.5 shrink-0"
          style={{ color: 'var(--warning)' }}
        />
        <div className="min-w-0 flex-1">
          <p
            className="text-sm font-semibold"
            style={{ color: 'var(--ink)' }}
          >
            Bridge recovery available
          </p>
          <p className="mt-1 text-xs" style={{ color: 'var(--muted)' }}>
            Stage {checkpoint.stage} · next {instruction}. The original source
            burn is reused; Veyra will not submit a second burn.
          </p>
          <p
            className="mt-2 truncate font-mono text-[11px]"
            style={{ color: 'var(--subtle)' }}
          >
            {checkpoint.burnTxHash}
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={onResume}
        disabled={!connected || busy}
        className="mt-3 w-full rounded-xl py-2.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40"
        style={{
          background: 'var(--accent-muted)',
          color: 'var(--accent)',
          border: '1px solid var(--border-strong)',
        }}
      >
        {!connected ? 'Connect wallet to resume' : 'Resume safely'}
      </button>
    </div>
  );
}

function ReceiptCard({ receipt }: { receipt: VeyraReceipt }) {
  const txUrl =
    receipt.executionTxHash && receipt.chainId
      ? buildTxExplorerUrl(receipt.chainId, receipt.executionTxHash)
      : null;

  const statusColor =
    receipt.status === 'VERIFIED'
      ? 'var(--success)'
      : receipt.status === 'FAILED'
        ? 'var(--danger)'
        : receipt.status === 'PENDING'
          ? 'var(--warning)'
          : 'var(--muted)';

  const statusBg =
    receipt.status === 'VERIFIED'
      ? 'var(--success-muted)'
      : receipt.status === 'FAILED'
        ? 'var(--danger-muted)'
        : receipt.status === 'PENDING'
          ? 'var(--warning-muted)'
          : 'var(--surface)';

  return (
    <div
      className="rounded-2xl p-4 space-y-3"
      style={{
        background: 'var(--surface-strong)',
        border: '1px solid var(--border)',
      }}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <span
            className="text-sm font-semibold"
            style={{ color: 'var(--ink)' }}
          >
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

      <div
        className="flex items-center gap-1.5 text-xs"
        style={{ color: 'var(--subtle)' }}
      >
        <span className="mono">{receipt.receiptId.slice(0, 32)}...</span>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
        {receipt.executionTxHash && (
          <DetailRow
            label="Tx hash"
            value={`${receipt.executionTxHash.slice(0, 10)}...`}
            mono
          />
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

      <div
        className="flex items-center gap-1.5 text-xs"
        style={{ color: 'var(--subtle)' }}
      >
        <Clock className="size-3" />
        {new Date(receipt.createdAt).toLocaleString()}
      </div>

      {receipt.displaySummary && (
        <p
          className="text-xs italic pt-1 border-t"
          style={{
            color: 'var(--subtle)',
            borderColor: 'var(--border)',
          }}
        >
          {receipt.displaySummary}
        </p>
      )}
    </div>
  );
}

function DetailRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <span className="text-xs" style={{ color: 'var(--subtle)' }}>
        {label}
      </span>
      <p
        className={`text-xs mt-0.5 font-medium truncate ${mono ? 'mono' : ''}`}
        style={{ color: 'var(--ink-2)' }}
      >
        {value}
      </p>
    </div>
  );
}
