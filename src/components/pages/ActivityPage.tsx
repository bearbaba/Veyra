/**
 * Veyra Activity Page
 *
 * Local receipt cache plus resumable bridge operations. PostgreSQL remains the
 * system of record for authenticated durable recovery; chain/provider state is
 * authoritative for execution truth.
 */

import { useEffect, useState } from 'react';
import { useAccount } from 'wagmi';
import { ConnectKitButton } from 'connectkit';
import { useUnifiedSocial } from '../../features/social/UnifiedSocial';
import { formatUnits } from 'viem';
import { buildTxExplorerUrl } from '@/onchain-facts';
import { useReceiptStore } from '@/hooks/useReceiptStore';
import { formatRemoteActivityAmount } from '@/core/receipt/formatRemoteActivityAmount';
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
  bridgeCheckpointBelongsToWallet,
  nextBridgeResumeInstruction,
  type BridgeRecoveryCheckpoint,
} from '@/core/execution/bridgeCheckpointStore';
import {
  loadActivityReceiptsRemote,
  type ActivityReceiptRemoteRecord,
} from '@/lib/api/activityReceiptApi';
import { cctpV2BridgeProvider } from '@/providers/cctp/cctpBridgeProvider';
import {
  inspectDestinationNonceRemote,
  recordSelfRelayDestinationRemote,
  loadDestinationAttemptHistoryRemote,
  reconcileSecondReceiveRemote,
  finalizeVerifiedSecondSettlementRemote,
  type DestinationAttemptHistoryRemote,
  type DestinationNonceObservation,
} from '@/lib/api/bridgeRecoveryApi';

export function ActivityPage({ readOnly = false }: { readOnly?: boolean }) {
  const { address, chainId, connector, isConnected } = useAccount();
  const social = useUnifiedSocial();
  // No bearer token or wallet-private data is persisted in the view key.
  // The session user ID changes on sign-out, login or wallet replacement.
  const activeScope = address
    ? [address.toLowerCase(), chainId ?? 0, connector?.uid ?? '', social.session?.profile.veyraUserId ?? ''].join(':')
    : '';
  const { receipts, loading, error: receiptError, reload } = useReceiptStore();
  const bridgeExecution = useBridgeExecution();
  const [remoteView, setRemoteView] = useState<{
    scope: string;
    session: typeof social.session;
    candidates: BridgeRecoveryCheckpoint[];
    receipts: ActivityReceiptRemoteRecord[];
    error: string | null;
  }>({ scope: '', session: null, candidates: [], receipts: [], error: null });
  // Hide a previous wallet's remote data during render, even before effects run.
  const viewIsCurrent = !readOnly && Boolean(activeScope) &&
    Boolean(social.session) && remoteView.session === social.session &&
    remoteView.scope === activeScope;
  const recoveryCandidates = viewIsCurrent ? remoteView.candidates : [];
  const remoteReceipts = viewIsCurrent && social.session ? remoteView.receipts : [];
  const remoteError = viewIsCurrent && social.session ? remoteView.error : null;

  useEffect(() => {
    if (readOnly) return;
    if (!activeScope || !social.session) return;
    let active = true;
    const scope = activeScope;
    const signedSession = social.session;
    void Promise.all([
      bridgeExecution.loadRecoveryCandidates().catch(() => [] as BridgeRecoveryCheckpoint[]),
      loadActivityReceiptsRemote().then(
        (rows) => ({ rows, failed: false }),
        () => ({ rows: [] as ActivityReceiptRemoteRecord[], failed: true }),
      ),
    ]).then(([candidates, remote]) => {
      if (!active) return;
      // Bridge checkpoints are always wallet-bound. This is a second defense
      // after the hook's own local/remote filtering.
      const own = candidates.filter((checkpoint) =>
        bridgeCheckpointBelongsToWallet(checkpoint, address));
      setRemoteView({
        scope, session: signedSession, candidates: own, receipts: remote.rows,
        error: remote.failed
          ? 'Synced Activity is temporarily unavailable. This does not mean your transaction history is empty.'
          : null,
      });
    });
    return () => { active = false; };
  }, [activeScope, address, social.session, bridgeExecution.loadRecoveryCandidates, readOnly]);

  async function refreshRemoteView() {
    const scope = activeScope;
    if (readOnly || !address || !scope || !social.session) return;
    const signedSession = social.session;
    const [candidates, rows] = await Promise.all([
      bridgeExecution.loadRecoveryCandidates(),
      loadActivityReceiptsRemote().catch(() => [] as ActivityReceiptRemoteRecord[]),
    ]);
    // A late response never acquires authority over the next signed wallet.
    setRemoteView({
      scope, session: signedSession,
      candidates: candidates.filter((checkpoint) =>
        bridgeCheckpointBelongsToWallet(checkpoint, address)),
      receipts: rows, error: null,
    });
  }

  async function resume(checkpoint: BridgeRecoveryCheckpoint) {
    if (readOnly || !address || !social.session ||
        !bridgeCheckpointBelongsToWallet(checkpoint, address)) return;
    await bridgeExecution.resumeProviderCheckpoint(cctpV2BridgeProvider, checkpoint);
    await reload();
    await refreshRemoteView();
  }

  if (!isConnected) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-8">
        <h1 className="display text-2xl font-bold" style={{color:'var(--ink)'}}>Activity</h1>
        <div className="mt-6 rounded-2xl border p-7 text-center"
          style={{background:'var(--surface)',borderColor:'var(--border)'}}>
          <p className="mb-4 text-sm" style={{color:'var(--muted)'}}>
            Connect your wallet to view activity.
          </p>
          <ConnectKitButton/>
        </div>
      </div>
    );
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
          {readOnly
            ? 'Read-only preview · local receipts may be displayed; authenticated history requires the backend'
            : 'Receipts and in-flight actions that still need attention'}
        </p>
      </div>

      {readOnly && (
        <div className="mb-5 rounded-xl px-4 py-3 text-xs" style={{ background: 'var(--surface)', color: 'var(--muted)', border: '1px solid var(--border)' }}>
          Static preview cannot resume bridges or authorize another receive. Signing and recovery stay locked.
        </div>
      )}

      {remoteError && !readOnly && (
        <div role="alert" className="mb-4 rounded-xl p-3 text-xs"
          style={{ border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--warning)' }}>
          {remoteError}
        </div>
      )}
      {remoteReceipts.length > 0 && (
        <div className="mb-6 space-y-3">
          <div>
            <p
              className="text-xs font-bold uppercase tracking-[0.16em]"
              style={{ color: 'var(--muted)' }}
            >
              Durable activity
            </p>
            <p className="mt-1 text-xs" style={{ color: 'var(--subtle)' }}>
              Synced from Veyra's authenticated system of record.
            </p>
          </div>
          {remoteReceipts.map((receipt) => (
            <RemoteActivityCard
              key={receipt.receiptId}
              receipt={receipt}
            />
          ))}
        </div>
      )}

      {!readOnly && recoveryCandidates.length > 0 && (
        <div className="mb-6 space-y-3">
          {recoveryCandidates.map((checkpoint) => (
            <RecoveryCard
              key={checkpoint.planId}
              checkpoint={checkpoint}
              connected={isConnected && Boolean(social.session)}
              busy={bridgeExecution.state.phase !== 'IDLE'}
              onResume={() => void resume(checkpoint)}
              onReconciled={async () => {
                await refreshRemoteView();
                await reload();
              }}
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

      {receiptError && (
        <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl p-3 text-sm"
          style={{ color: 'var(--warning)', border: '1px solid var(--border)', background: 'var(--surface)' }}>
          <span>{receiptError}</span>
          <button type="button" onClick={() => void reload()}
            className="rounded-lg border px-3 py-1 text-xs font-semibold"
            style={{ borderColor: 'var(--border)' }}>Retry loading</button>
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
      ) : receiptError && receipts.length === 0 ? null : receipts.length === 0 ? (
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
            No local transactions for this wallet
          </p>
          <p className="text-xs mt-1" style={{ color: 'var(--subtle)' }}>
            This wallet's verified, pending and failed payments will appear here.
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

function RemoteActivityCard({
  receipt,
}: {
  receipt: ActivityReceiptRemoteRecord;
}) {
  const terminal =
    receipt.status === 'COMPLETE' ||
    receipt.status === 'FAILED' ||
    receipt.status === 'INVALIDATED' ||
    receipt.status === 'DUPLICATE_DETECTED' ||
    receipt.status === 'CANCELLED';

  const statusColor =
    receipt.status === 'COMPLETE'
      ? 'var(--success)'
      : receipt.status === 'FAILED' ||
          receipt.status === 'INVALIDATED' ||
          receipt.status === 'DUPLICATE_DETECTED'
        ? 'var(--danger)'
        : receipt.status === 'CANCELLED'
          ? 'var(--muted)'
          : 'var(--warning)';

  return (
    <div
      className="rounded-2xl p-4"
      style={{
        background: 'var(--surface-strong)',
        border: '1px solid var(--border)',
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span
              className="text-sm font-semibold"
              style={{ color: 'var(--ink)' }}
            >
              {receipt.action}
            </span>
            <span
              className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
              style={{
                color: statusColor,
                background: 'var(--surface)',
              }}
            >
              {receipt.status}
            </span>
          </div>
          <p className="mt-1 text-xs" style={{ color: 'var(--muted)' }}>
            {receipt.providerId} · revision {receipt.revision}
          </p>
        </div>
        {!terminal && receipt.resumable && (
          <span
            className="rounded-lg px-2 py-1 text-[10px] font-bold uppercase tracking-wider"
            style={{
              color: 'var(--warning)',
              background: 'var(--warning-muted)',
            }}
          >
            resumable
          </span>
        )}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <DetailRow
          label="Amount"
          value={formatRemoteActivityAmount(receipt)}
        />
        <DetailRow
          label="Route"
          value={`${receipt.senderChainId} → ${receipt.recipientChainId}`}
        />
        {receipt.burnTxHash && (
          <DetailRow
            label="Source tx"
            value={`${receipt.burnTxHash.slice(0, 10)}...`}
            mono
          />
        )}
        {receipt.receiveTxHash && (
          <DetailRow
            label={receipt.settlementReceiveTxHash ? 'First dest tx' : 'Destination tx'}
            value={`${receipt.receiveTxHash.slice(0, 10)}...`}
            mono
          />
        )}
        {receipt.settlementReceiveTxHash && (
          <DetailRow
            label={`Settled tx (#${receipt.settlementAttemptNumber ?? '?'})`}
            value={`${receipt.settlementReceiveTxHash.slice(0, 10)}...`}
            mono
          />
        )}
        {receipt.settlementReceiveBlockNumber !== null &&
          receipt.settlementReceiveBlockNumber !== undefined && (
          <DetailRow
            label="Settlement block"
            value={String(receipt.settlementReceiveBlockNumber)}
            mono
          />
        )}
      </div>

      {receipt.status === 'SIGNED' && !receipt.burnTxHash && (
        <p
          className="mt-3 text-xs"
          style={{ color: 'var(--warning)' }}
        >
          Submission outcome is uncertain. Veyra keeps this action locked and
          will not replay it automatically.
        </p>
      )}

      <div
        className="mt-3 flex items-center gap-1.5 text-[11px]"
        style={{ color: 'var(--subtle)' }}
      >
        <Clock className="size-3" />
        Updated {new Date(receipt.updatedAt).toLocaleString()}
      </div>
    </div>
  );
}

function RecoveryCard({
  checkpoint,
  connected,
  busy,
  onResume,
  onReconciled,
}: {
  checkpoint: BridgeRecoveryCheckpoint;
  connected: boolean;
  busy: boolean;
  onResume: () => void;
  onReconciled: () => Promise<void>;
}) {
  const [attemptHistory, setAttemptHistory] = useState<DestinationAttemptHistoryRemote | null>(null);
  const [attemptHistoryError, setAttemptHistoryError] = useState<string | null>(null);
  const [secondTxHash, setSecondTxHash] = useState('');
  const [secondBusy, setSecondBusy] = useState(false);
  const [secondMessage, setSecondMessage] = useState<string | null>(null);
  const [secondError, setSecondError] = useState<string | null>(null);
  const [settlementBusy, setSettlementBusy] = useState(false);

  useEffect(() => {
    if (checkpoint.stage !== 'DESTINATION_BROADCAST' || !connected) return;
    let active = true;
    void loadDestinationAttemptHistoryRemote(checkpoint.planId).then((history) => {
      if (active) {
        setAttemptHistory(history);
        setAttemptHistoryError(null);
      }
    }).catch((error: unknown) => {
      if (active) setAttemptHistoryError(
        error instanceof Error ? error.message : 'Destination attempt history unavailable.',
      );
    });
    return () => { active = false; };
  }, [checkpoint.planId, checkpoint.stage, connected]);

  async function reconcileKnownSecondReceive() {
    const hash = secondTxHash.trim();
    if (
      !connected || busy || secondBusy ||
      checkpoint.stage !== 'DESTINATION_BROADCAST' ||
      attemptHistory?.second.state !== 'UNCERTAIN' ||
      !/^0x[0-9a-fA-F]{64}$/.test(hash)
    ) {
      return;
    }
    setSecondBusy(true);
    setSecondMessage(null);
    setSecondError(null);
    try {
      await reconcileSecondReceiveRemote(checkpoint.planId, hash);
      const history = await loadDestinationAttemptHistoryRemote(checkpoint.planId);
      setAttemptHistory(history);
      setSecondTxHash('');
      setSecondMessage('Previously broadcast second receive hash was independently indexed and recorded. This does not prove a mint.');
      await onReconciled();
    } catch (error) {
      setSecondError(
        error instanceof Error ? error.message : 'Cannot verify the existing second receive. Retry remains locked.',
      );
    } finally {
      setSecondBusy(false);
    }
  }

  async function finalizeSecondSettlement() {
    // This button never signs or retries. Only independent BFF chain evidence
    // can upgrade the immutable ActivityReceipt to COMPLETE.
    if (!connected || busy || secondBusy || settlementBusy ||
        checkpoint.stage !== 'DESTINATION_BROADCAST' ||
        !attemptHistory?.first.reverted ||
        attemptHistory.second.state !== 'RECORDED' ||
        !/^0x[0-9a-fA-F]{64}$/.test(attemptHistory.second.receiveTxHash ?? '')) {
      return;
    }
    setSettlementBusy(true);
    setSecondError(null);
    setSecondMessage(null);
    try {
      const settled = await finalizeVerifiedSecondSettlementRemote(checkpoint.planId);
      setSecondMessage(
        'Second destination USDC mint verified on-chain. Receipt ' +
        settled.receiptId + ' is complete. No new funds were sent.',
      );
      await onReconciled();
    } catch (error) {
      setSecondError(error instanceof Error ? error.message :
        'Second destination mint has not been proven. No transaction was submitted.');
    } finally {
      setSettlementBusy(false);
    }
  }

  const [knownTxHash, setKnownTxHash] = useState('');
  const [reconcileBusy, setReconcileBusy] = useState(false);
  const [reconcileMessage, setReconcileMessage] = useState<string | null>(null);
  const [reconcileError, setReconcileError] = useState<string | null>(null);

  async function reconcilePreviouslySignedHash() {
    const txHash = knownTxHash.trim();
    if (
      checkpoint.stage !== 'ATTESTATION_READY' ||
      busy || reconcileBusy ||
      !/^0x[0-9a-fA-F]{64}$/.test(txHash)
    ) {
      return;
    }
    setReconcileBusy(true);
    setReconcileMessage(null);
    setReconcileError(null);
    try {
      // This endpoint cannot sign: it only records a prior claimed
      // submission after the BFF independently fetches the destination
      // transaction, validates actual RPC chain + hash, sender, CCTP target
      // and exact original message and attestation calldata.
      await recordSelfRelayDestinationRemote(checkpoint.planId, txHash);
      setReconcileMessage('Previously signed receive hash independently verified and recorded. No new transaction was sent.');
      setKnownTxHash('');
      await onReconciled();
    } catch (error) {
      setReconcileError(
        error instanceof Error ? error.message : 'The original transaction cannot be verified. No new signature is allowed.',
      );
    } finally {
      setReconcileBusy(false);
    }
  }

  const [nonceStatus, setNonceStatus] = useState<
    DestinationNonceObservation | null
  >(null);
  const [nonceBusy, setNonceBusy] = useState(false);
  const [nonceError, setNonceError] = useState<string | null>(null);

  async function checkNonce() {
    if (!connected || busy || nonceBusy || checkpoint.stage !== 'DESTINATION_BROADCAST') {
      return;
    }
    setNonceStatus(null);
    setNonceError(null);
    setNonceBusy(true);
    try {
      setNonceStatus(await inspectDestinationNonceRemote(checkpoint.planId));
    } catch (error) {
      setNonceError(error instanceof Error ? error.message : 'CCTP nonce verification unavailable');
    } finally {
      setNonceBusy(false);
    }
  }

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
      {checkpoint.stage === 'ATTESTATION_READY' && (
        <section className="mt-3 space-y-2 rounded-xl p-3"
          style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <p className="text-xs font-semibold" style={{ color: 'var(--ink)' }}>
            Reconcile a previously signed destination receive
          </p>
          <p className="text-xs leading-5" style={{ color: 'var(--muted)' }}>
            If your wallet already broadcast the original CCTP receive but Veyra lost its response,
            paste that transaction hash. This will ONLY check and record an existing
            on-chain submission. It never signs, resends or burns USDC.
            No prior durable claim or mismatched transaction means verification is refused.
          </p>
          <form className="space-y-2" onSubmit={(event) => {
            event.preventDefault();
            void reconcilePreviouslySignedHash();
          }}>
            <label htmlFor={`known-receive-${checkpoint.planId}`}
              className="block text-xs font-semibold" style={{ color: 'var(--muted)' }}>
              Original destination transaction hash (0x + 64 hex characters)
            </label>
            <input
              id={`known-receive-${checkpoint.planId}`}
              value={knownTxHash}
              onChange={(event) => setKnownTxHash(event.target.value)}
              placeholder="0x…"
              maxLength={66}
              autoComplete="off"
              spellCheck={false}
              className="w-full rounded-lg px-3 py-2 font-mono text-xs outline-none"
              style={{ background: 'var(--surface-strong)', color: 'var(--ink)', border: '1px solid var(--border-strong)' }}
              disabled={busy || reconcileBusy}
            />
            <button
              type="submit"
              disabled={busy || reconcileBusy || !/^0x[0-9a-fA-F]{64}$/.test(knownTxHash.trim())}
              className="rounded-lg px-3 py-2 text-xs font-semibold disabled:opacity-40"
              style={{ background: 'var(--accent-muted)', color: 'var(--accent)', border: '1px solid var(--border-strong)' }}
            >
              {reconcileBusy ? 'Verifying saved transaction…' : 'Verify existing hash (no signing)'}
            </button>
          </form>
          {reconcileMessage && (
            <p role="status" className="text-xs" style={{ color: 'var(--success)' }}>{reconcileMessage}</p>
          )}
          {reconcileError && (
            <p role="alert" className="text-xs" style={{ color: 'var(--danger)' }}>
              {reconcileError} · The submission remains locked.
            </p>
          )}
        </section>
      )}

      {checkpoint.stage === 'DESTINATION_BROADCAST' && (
        <section className="mt-3 space-y-3 rounded-xl p-3"
          style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <p className="text-xs font-semibold" style={{ color: 'var(--ink)' }}>
            Immutable CCTP destination attempt history
          </p>
          {attemptHistory && (
            <div className="space-y-2 text-xs" style={{ color: 'var(--muted)' }}>
              <p>First receive: {attemptHistory.first.state}
                {attemptHistory.first.reverted ? ' · canonical revert recorded' : ''}
              </p>
              <p>Second receive: {attemptHistory.second.state}
                {attemptHistory.second.verifiedMint ? ' · verified USDC mint' : ''}
              </p>
              {attemptHistory.second.receiveTxHash && (
                <p className="break-all font-mono">Second hash: {attemptHistory.second.receiveTxHash}</p>
              )}
              {attemptHistory.second.mintBlockHash && (
                <p className="break-all font-mono">
                  Verified mint block: {attemptHistory.second.mintBlockHash}
                </p>
              )}
              {attemptHistory.history.map((event) => (
                <p key={`${event.attemptNumber}:${event.eventType}:${event.occurredAt}`}>
                  Attempt #{event.attemptNumber} · {event.eventType}
                </p>
              ))}
            </div>
          )}
          {attemptHistoryError && (
            <p role="alert" className="text-xs leading-5" style={{ color: 'var(--warning)' }}>
              {attemptHistoryError} · Existing submissions remain locked.
            </p>
          )}
          {attemptHistory?.second.state === 'UNCERTAIN' && (
            <form className="space-y-2" onSubmit={(event) => {
              event.preventDefault();
              void reconcileKnownSecondReceive();
            }}>
              <p className="text-xs leading-5" style={{ color: 'var(--muted)' }}>
                Attempt #2 was previously reserved but has no recorded hash.
                Paste ONLY an already broadcast transaction hash to verify on
                the destination RPC; this form cannot create a transaction.
              </p>
              <label className="block text-xs font-semibold"
                htmlFor={`retry-hash-${checkpoint.planId}`}
                style={{ color: 'var(--ink)' }}>
                Previously broadcast second receive hash
              </label>
              <input id={`retry-hash-${checkpoint.planId}`}
                value={secondTxHash} onChange={(e) => setSecondTxHash(e.target.value)}
                maxLength={66} placeholder="0x…" autoComplete="off" spellCheck={false}
                disabled={!connected || busy || secondBusy}
                className="w-full rounded-lg px-3 py-2 font-mono text-xs outline-none"
                style={{ background: 'var(--surface-strong)', color: 'var(--ink)', border: '1px solid var(--border-strong)' }} />
              <button type="submit"
                disabled={!connected || busy || secondBusy || !/^0x[0-9a-fA-F]{64}$/.test(secondTxHash.trim())}
                className="rounded-lg px-3 py-2 text-xs font-semibold disabled:opacity-40"
                style={{ background: 'var(--accent-muted)', color: 'var(--accent)', border: '1px solid var(--border-strong)' }}>
                {secondBusy ? 'Verifying existing transaction…' : 'Reconcile second hash (no signing)'}
              </button>
            </form>
          )}
          {attemptHistory?.first.reverted &&
            attemptHistory.second.state === 'RECORDED' &&
            /^0x[0-9a-fA-F]{64}$/.test(attemptHistory.second.receiveTxHash ?? '') && (
            <button type="button"
              onClick={() => void finalizeSecondSettlement()}
              disabled={!connected || busy || secondBusy || settlementBusy}
              className="rounded-lg px-3 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-40"
              style={{ background: 'var(--accent-muted)', color: 'var(--accent)', border: '1px solid var(--border-strong)' }}>
              {settlementBusy ? 'Checking canonical USDC mint…' : 'Verify second mint and complete receipt (no signing)'}
            </button>
          )}
          {secondMessage && <p role="status" className="text-xs" style={{ color: 'var(--success)' }}>{secondMessage}</p>}
          {secondError && <p role="alert" className="text-xs" style={{ color: 'var(--danger)' }}>{secondError} · No new transaction was sent.</p>}
          <p className="text-xs font-semibold" style={{ color: 'var(--warning)' }}>
            History is not authorization to sign or retry a transaction.
          </p>
        </section>
      )}

      {checkpoint.stage === 'DESTINATION_BROADCAST' && (
        <section className="mt-3 space-y-2 rounded-xl p-3"
          style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <p className="text-xs font-semibold" style={{ color: 'var(--ink)' }}>
            CCTP destination nonce (read-only)
          </p>
          <p className="text-xs leading-5" style={{ color: 'var(--muted)' }}>
            Check on-chain usage after a confirmed first receive revert. This never authorizes another burn, receive, or wallet signature.
          </p>
          <button
            type="button"
            onClick={() => void checkNonce()}
            disabled={!connected || busy || nonceBusy}
            className="rounded-lg px-3 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-40"
            style={{ background: 'var(--accent-muted)', color: 'var(--accent)', border: '1px solid var(--border-strong)' }}
          >
            {nonceBusy ? 'Checking canonical nonce…' : 'Inspect nonce without signing'}
          </button>
          {nonceStatus && (
            <div aria-live="polite" className="space-y-1 text-xs" style={{ color: 'var(--muted)' }}>
              <p>
                {nonceStatus.usage === 'ALREADY_CONSUMED'
                  ? 'Nonce already consumed on destination chain.'
                  : 'Nonce unused at the observed block only — status may change.'}
              </p>
              <p className="font-mono">Block {nonceStatus.observedBlockNumber} · {nonceStatus.observedBlockHash.slice(0, 14)}…</p>
              <p className="font-semibold" style={{ color: 'var(--warning)' }}>
                Retry signing is NOT authorized.
              </p>
            </div>
          )}
          {nonceError && (
            <p role="alert" className="text-xs leading-5" style={{ color: 'var(--danger)' }}>
              {nonceError} · No new transaction is allowed.
            </p>
          )}
        </section>
      )}

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
        {receipt.actionType==='TRANSFER' && (
          <DetailRow label="Recipient" value={receipt.recipientVeyraHandleAtReview
            ? `@${receipt.recipientVeyraHandleAtReview}.veyra · ID at review`
            : receipt.recipientAddress
              ? `${receipt.recipientAddress.slice(0,8)}…${receipt.recipientAddress.slice(-6)} · wallet`
              : 'Not recorded'} />
        )}
        {receipt.executionTxHash && (
          <DetailRow
            label="Tx hash"
            value={`${receipt.executionTxHash.slice(0, 10)}...`}
            mono
          />
        )}
        {(receipt.actualAmountDelta != null || receipt.expectedAmountDelta != null) && (
          <DetailRow
            label={receipt.status === 'VERIFIED' ? 'Amount' : 'Reviewed amount'}
            value={formatReceiptAmount(receipt)}
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

function formatReceiptAmount(receipt: VeyraReceipt): string {
  const amount = receipt.actualAmountDelta ?? receipt.expectedAmountDelta;
  if (amount == null) return 'Unavailable';
  if (receipt.actionType === 'TRANSFER' && receipt.tokenSymbol === 'USDC' && receipt.tokenDecimals === 6) {
    return `${formatUnits(amount, 6)} USDC`;
  }
  // Never pretend unknown token base units are decimal USDC.
  return `${amount.toString()} base units`;
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
