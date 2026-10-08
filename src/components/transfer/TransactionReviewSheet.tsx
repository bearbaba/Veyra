/**
 * Veyra Transaction Review Sheet
 *
 * Shows the full pipeline evaluation (Policy + Risk) before asking the user
 * to sign. This is the mandatory gate for ALL TRANSFER actions regardless of
 * whether they originate from Pay (manual) or Agent.
 *
 * Layout:
 *   Action summary → Policy result → Risk score → Simulation note → CTA
 */

import { AnimatePresence, motion } from 'framer-motion';
import {
  Shield,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Loader2,
  ExternalLink,
  X,
} from 'lucide-react';
import { formatUnits } from 'viem';
import type { TransferAction } from '@/core/actions/actionSchema';
import { usePipelineEvaluation } from '@/hooks/usePipelineEvaluation';
import { useTransferExecution } from '@/hooks/useTransferExecution';
import { VeyraReceiptView } from '../receipt/VeyraReceiptView';
import type { PreparedRecipient } from '@/lib/api/identityApi';

interface TransactionReviewSheetProps {
  action: TransferAction;
  recipient?: PreparedRecipient | null;
  onClose: () => void;
}

export function TransactionReviewSheet({ action, recipient, onClose }: TransactionReviewSheetProps) {
  const { policy, risk, loading: evalLoading, error: evalError } = usePipelineEvaluation(action);
  const { state: execState, execute, reset } = useTransferExecution();

  const isBlocked = policy?.decision === 'BLOCKED';
  const needsConfirmation = policy?.decision === 'NEEDS_CONFIRMATION';
  const isExecuting = ['SIGNING', 'BROADCAST', 'CONFIRMING', 'VERIFYING'].includes(execState.step);

  function handleClose() {
    if (isExecuting) return; // prevent close during execution
    reset();
    onClose();
  }

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 flex items-end md:items-center justify-center"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={handleClose}
      >
        <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

        <motion.section
          className="relative w-full max-w-md rounded-t-3xl md:rounded-3xl overflow-hidden"
          style={{
            background: 'rgba(12, 22, 38, 0.97)',
            backdropFilter: 'blur(40px) saturate(200%)',
            border: '1px solid var(--border-strong)',
          }}
          initial={{ y: '100%' }}
          animate={{ y: 0 }}
          exit={{ y: '100%' }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Spectral strip — consumer money flow */}
          <div className="h-0.5" style={{
            background: 'linear-gradient(90deg, #4f8ef7 0%, #a78bfa 50%, #34d399 100%)',
          }} />

          {/* Drag handle */}
          <div className="flex justify-center pt-3 pb-1 md:hidden">
            <div className="h-1 w-10 rounded-full" style={{ background: 'var(--border-strong)' }} />
          </div>

          <div className="px-5 pb-6 pt-3 space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between">
              <h2 className="display text-lg font-bold" style={{ color: 'var(--ink)' }}>
                Review Transfer
              </h2>
              {!isExecuting && (
                <button onClick={handleClose} style={{ color: 'var(--muted)' }}>
                  <X className="size-5" />
                </button>
              )}
            </div>

            {/* ── Receipt view (after execution) ── */}
            {execState.receipt && (
              <VeyraReceiptView receipt={execState.receipt} explorerUrl={execState.explorerUrl} />
            )}

            {/* ── Pre-execution: action summary ── */}
            {execState.step === 'IDLE' && (
              <>
                {/* Action summary */}
                <div className="rounded-2xl p-4 space-y-3"
                  style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--muted)' }}>
                      Amount
                    </span>
                    <span className="display text-2xl font-bold tabular-nums" style={{ color: 'var(--ink)' }}>
                      {formatUnits(action.amount, action.tokenDecimals)}{' '}
                      <span className="text-base font-medium" style={{ color: 'var(--muted)' }}>USDC</span>
                    </span>
                  </div>
                  {recipient?.snapshot ? (
                    <>
                      <DetailRow label="Recipient" value={recipient.snapshot.displayName || `@${recipient.snapshot.veyraHandle}`} />
                      <DetailRow label="Veyra" value={`@${recipient.snapshot.veyraHandle}`} />
                    </>
                  ) : null}
                  <DetailRow label="To" value={`${action.to.slice(0, 8)}...${action.to.slice(-6)}`} mono />
                  <DetailRow label="From" value={`${action.from.slice(0, 8)}...${action.from.slice(-6)}`} mono />
                  <DetailRow label="Network" value="Arc Testnet" />
                  <DetailRow label="Source" value={action.provenance.source} />
                </div>

                {/* Pipeline evaluation */}
                {evalLoading ? (
                  <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--muted)' }}>
                    <Loader2 className="size-4 animate-spin" />
                    Running policy and risk checks...
                  </div>
                ) : evalError ? (
                  <div className="flex items-start gap-2 rounded-xl p-3"
                    style={{ background: 'var(--danger-muted)', border: '1px solid var(--border)', color: 'var(--danger)' }}>
                    <AlertTriangle className="size-4 mt-0.5 shrink-0" />
                    <span className="text-sm">{evalError}</span>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {/* Policy */}
                    {policy && (
                      <PipelineRow
                        label="Policy"
                        status={policy.decision}
                        detail={policy.decision === 'BLOCKED'
                          ? (policy.blockedBy?.join(', ') ?? 'Blocked by policy')
                          : policy.decision === 'NEEDS_CONFIRMATION'
                          ? (policy.confirmationRequired?.join(', ') ?? 'Confirmation required')
                          : 'All rules passed'}
                        ok={policy.decision === 'PASS'}
                        warn={policy.decision === 'NEEDS_CONFIRMATION'}
                        blocked={policy.decision === 'BLOCKED'}
                      />
                    )}

                    {/* Risk */}
                    {risk && (
                      <PipelineRow
                        label="Risk"
                        status={`${risk.score}/100`}
                        detail={risk.level}
                        ok={risk.level === 'LOW'}
                        warn={risk.level === 'MEDIUM'}
                        blocked={risk.level === 'HIGH' || risk.level === 'CRITICAL'}
                      />
                    )}

                    {/* Simulation note for ERC-20 transfer */}
                    <div className="flex items-start gap-2 rounded-xl p-3"
                      style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                      <Shield className="size-3.5 mt-0.5 shrink-0" style={{ color: 'var(--accent)' }} />
                      <p className="text-xs" style={{ color: 'var(--muted)' }}>
                        Transfer will be simulated via viem before signing. Final confirmation
                        verifies the actual on-chain token delta.
                      </p>
                    </div>
                  </div>
                )}

                {/* CTA */}
                {!evalLoading && !evalError && (
                  <button
                    onClick={() => void execute(action, recipient?.snapshot ? {
                      snapshotId: recipient.snapshot.snapshotId,
                      expectedWalletAddress: action.to,
                      expectedChainId: action.chainId,
                    } : undefined)}
                    disabled={isBlocked || evalLoading}
                    className="w-full flex items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-semibold transition-all hover:scale-[1.01] active:scale-[0.99] disabled:opacity-40 disabled:cursor-not-allowed disabled:scale-100"
                    style={{ background: isBlocked ? 'var(--danger)' : 'var(--accent)', color: '#0d1b2f' }}
                  >
                    {isBlocked ? (
                      <><XCircle className="size-4" /> Blocked by Policy</>
                    ) : needsConfirmation ? (
                      <><AlertTriangle className="size-4" /> Confirm and Sign</>
                    ) : (
                      <><CheckCircle2 className="size-4" /> Sign Transfer</>
                    )}
                  </button>
                )}
              </>
            )}

            {/* ── Execution in progress ── */}
            {isExecuting && (
              <div className="space-y-4">
                <ExecutionStep
                  label="Awaiting wallet signature"
                  active={execState.step === 'SIGNING'}
                  done={['BROADCAST', 'CONFIRMING', 'VERIFYING', 'DONE'].includes(execState.step)}
                />
                <ExecutionStep
                  label="Broadcasting transaction"
                  active={execState.step === 'BROADCAST'}
                  done={['CONFIRMING', 'VERIFYING', 'DONE'].includes(execState.step)}
                />
                <ExecutionStep
                  label="Waiting for confirmation"
                  active={execState.step === 'CONFIRMING'}
                  done={['VERIFYING', 'DONE'].includes(execState.step)}
                />
                <ExecutionStep
                  label="Verifying final state"
                  active={execState.step === 'VERIFYING'}
                  done={execState.step === 'DONE'}
                />
                {execState.txHash && (
                  <a
                    href={execState.explorerUrl ?? '#'}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1.5 text-xs"
                    style={{ color: 'var(--accent)' }}
                  >
                    <ExternalLink className="size-3" />
                    View on ArcScan
                  </a>
                )}
              </div>
            )}

            {/* ── Failed ── */}
            {execState.step === 'FAILED' && !execState.receipt && (
              <div className="flex items-start gap-2 rounded-xl p-3"
                style={{ background: 'var(--danger-muted)', border: '1px solid var(--border)', color: 'var(--danger)' }}>
                <AlertTriangle className="size-4 mt-0.5 shrink-0" />
                <span className="text-sm">{execState.error}</span>
              </div>
            )}

            {/* ── Done: close ── */}
            {execState.step === 'DONE' && (
              <button
                onClick={handleClose}
                className="w-full rounded-2xl py-3 text-sm font-semibold"
                style={{ background: 'var(--surface-strong)', border: '1px solid var(--border)', color: 'var(--ink)' }}
              >
                Done
              </button>
            )}
          </div>
        </motion.section>
      </motion.div>
    </AnimatePresence>
  );
}

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span style={{ color: 'var(--muted)' }}>{label}</span>
      <span className={mono ? 'mono text-xs' : 'text-xs font-medium'} style={{ color: 'var(--ink-2)' }}>
        {value}
      </span>
    </div>
  );
}

function PipelineRow({
  label, status, detail, ok, warn, blocked,
}: {
  label: string; status: string; detail: string;
  ok: boolean; warn: boolean; blocked: boolean;
}) {
  const color = ok ? 'var(--success)' : warn ? 'var(--warning)' : blocked ? 'var(--danger)' : 'var(--muted)';
  const bg    = ok ? 'var(--success-muted)' : warn ? 'var(--warning-muted)' : blocked ? 'var(--danger-muted)' : 'var(--surface)';
  const Icon  = ok ? CheckCircle2 : blocked ? XCircle : AlertTriangle;

  return (
    <div className="flex items-center gap-3 rounded-xl px-3.5 py-2.5"
      style={{ background: bg, border: '1px solid var(--border)' }}>
      <Icon className="size-4 shrink-0" style={{ color }} />
      <span className="text-xs font-semibold" style={{ color: 'var(--ink-2)' }}>{label}</span>
      <span className="ml-auto text-xs font-mono" style={{ color }}>{status}</span>
      <span className="text-xs" style={{ color: 'var(--subtle)' }}>{detail}</span>
    </div>
  );
}

function ExecutionStep({ label, active, done }: { label: string; active: boolean; done: boolean }) {
  return (
    <div className="flex items-center gap-3 text-sm">
      {done ? (
        <CheckCircle2 className="size-4 shrink-0" style={{ color: 'var(--success)' }} />
      ) : active ? (
        <Loader2 className="size-4 animate-spin shrink-0" style={{ color: 'var(--accent)' }} />
      ) : (
        <div className="size-4 rounded-full shrink-0" style={{ border: '2px solid var(--border)' }} />
      )}
      <span style={{ color: active ? 'var(--ink)' : done ? 'var(--success)' : 'var(--subtle)' }}>
        {label}
      </span>
    </div>
  );
}
