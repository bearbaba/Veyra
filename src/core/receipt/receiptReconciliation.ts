import type { ReceiptStatus, VeyraReceipt } from './receiptTypes';

const STATUS_RANK: Record<ReceiptStatus, number> = {
  PENDING: 0,
  BRIDGE_PENDING: 1,
  BRIDGE_UNCONFIRMED: 2,
  CANCELLED: 100,
  FAILED: 100,
  VERIFIED: 110,
};

function statusRank(status: ReceiptStatus): number {
  return STATUS_RANK[status];
}

export function reconcileLocalReceiptStatus(
  left: ReceiptStatus,
  right: ReceiptStatus,
): ReceiptStatus {
  if (left === 'VERIFIED' || right === 'VERIFIED') return 'VERIFIED';

  const leftTerminal = left === 'FAILED' || left === 'CANCELLED';
  const rightTerminal = right === 'FAILED' || right === 'CANCELLED';
  if (leftTerminal && !rightTerminal) return left;
  if (rightTerminal && !leftTerminal) return right;
  if (leftTerminal && rightTerminal) return left;

  return statusRank(right) > statusRank(left) ? right : left;
}

/**
 * Revision-aware browser/server merge.
 *
 * The newer revision is the metadata base, but execution status never regresses.
 * Recovery metadata is preserved when one side lacks it.
 */
export function reconcileVeyraReceipts(
  local: VeyraReceipt,
  remote: VeyraReceipt,
): VeyraReceipt {
  if (local.receiptId !== remote.receiptId) {
    throw new Error('[receiptReconciliation] receiptId mismatch');
  }

  const localRevision = local.syncRevision ?? 1;
  const remoteRevision = remote.syncRevision ?? 1;
  const mergedStatus = reconcileLocalReceiptStatus(
    local.status,
    remote.status,
  );

  const remoteHasMoreAdvancedStatus =
    statusRank(remote.status) > statusRank(local.status);
  const base =
    remoteRevision >= localRevision || remoteHasMoreAdvancedStatus
      ? remote
      : local;
  const other = base === remote ? local : remote;

  return {
    ...base,
    status: mergedStatus,
    syncRevision: Math.max(localRevision, remoteRevision),
    syncPending: localRevision > remoteRevision && local.syncPending === true,
    planId: base.planId ?? other.planId,
    executionTxHash: base.executionTxHash ?? other.executionTxHash,
    executionBlock: base.executionBlock ?? other.executionBlock,
    completedAt: base.completedAt ?? other.completedAt,
    actualAmountDelta:
      base.actualAmountDelta ?? other.actualAmountDelta,
    expectedAmountDelta:
      base.expectedAmountDelta ?? other.expectedAmountDelta,
    verifiedBalanceAfter:
      base.verifiedBalanceAfter ?? other.verifiedBalanceAfter,
    riskScore: base.riskScore ?? other.riskScore,
    policyDecision: base.policyDecision ?? other.policyDecision,
    displaySummary: base.displaySummary ?? other.displaySummary,
    bridgeTrace: base.bridgeTrace ?? other.bridgeTrace,
    transferTrace: base.transferTrace ?? other.transferTrace,
    executionContext: base.executionContext ?? other.executionContext,
  };
}
