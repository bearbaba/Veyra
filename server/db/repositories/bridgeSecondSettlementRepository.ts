/**
 * Authoritative completion of a CCTP ActivityReceipt settled by attempt #2.
 *
 * No second burn and no mutation of the original first receive hash.
 * The server-only mint evidence is already chain-verified and append-only;
 * this transaction re-checks its identity under the owned checkpoint lock.
 * It writes an explicit settlementReceiveTxHash/Block and audit event.
 */
import { and, eq, sql } from 'drizzle-orm';
import type { DbClient } from '../client.js';
import { activityReceipts, executionEvents } from '../schema/payments.js';
import {
  bridgeRecoveryCheckpoints,
  bridgeDestinationSubmissionClaims,
  bridgeDestinationAttemptResolutions,
  bridgeDestinationRetryAttempts,
  bridgeDestinationRetryVerifications,
} from '../schema/bridgeRecovery.js';
import { newEventId } from '../ids.js';
import { BridgeRecoveryConflictError } from './bridgeRecoveryRepository.js';
import { MANIFEST_CONSTANTS } from '../../../src/providers/registry/providerManifest.js';

type ReceiptState = Pick<typeof activityReceipts.$inferSelect,
  | 'status' | 'providerId' | 'action' | 'routeId'
  | 'senderAddress' | 'senderChainId'
  | 'recipientAddress' | 'recipientChainId'
  | 'amountRaw' | 'tokenAddress'
  | 'burnTxHash' | 'burnChainId' | 'burnBlockNumber'
  | 'receiveTxHash' | 'receiveChainId'
  | 'settlementReceiveTxHash' | 'settlementReceiveBlockNumber'
  | 'settlementAttemptNumber'
>;
type CheckpointState = Pick<typeof bridgeRecoveryCheckpoints.$inferSelect,
  | 'planId' | 'stage' | 'walletAddress' | 'recipientAddress'
  | 'sourceChainId' | 'destinationChainId' | 'tokenAddress'
  | 'burnTxHash' | 'amountRaw' | 'receiveTxHash'
>;
type FirstState = Pick<typeof bridgeDestinationSubmissionClaims.$inferSelect, 'receiveTxHash'>;
type RevertState = Pick<typeof bridgeDestinationAttemptResolutions.$inferSelect,
  'receiveTxHash' | 'destinationChainId' | 'outcome' | 'confirmations'
>;
type SecondState = Pick<typeof bridgeDestinationRetryAttempts.$inferSelect, 'receiveTxHash'>;
type MintState = Pick<typeof bridgeDestinationRetryVerifications.$inferSelect,
  | 'receiveTxHash' | 'destinationChainId' | 'destinationBlockNumber'
  | 'destinationBlockHash' | 'mintToken' | 'mintRecipient'
  | 'mintAmountRaw' | 'confirmations'
>;

export function assertSecondCctpSettlementFinalizable(
  receipt: ReceiptState,
  checkpoint: CheckpointState,
  first: FirstState,
  reverted: RevertState,
  second: SecondState,
  mint: MintState,
): void {
  const destinationToken = checkpoint.destinationChainId ===
    MANIFEST_CONSTANTS.ETH_SEPOLIA_CHAIN_ID
    ? MANIFEST_CONSTANTS.ETH_SEPOLIA_USDC
    : checkpoint.destinationChainId === MANIFEST_CONSTANTS.BASE_SEPOLIA_CHAIN_ID
      ? MANIFEST_CONSTANTS.BASE_SEPOLIA_USDC
      : null;

  if (
    receipt.providerId !== 'cctp-v2-bridge' ||
    receipt.action !== 'BRIDGE' ||
    receipt.routeId !== checkpoint.planId ||
    (receipt.status !== 'RECEIVE_PENDING' &&
      receipt.status !== 'RECEIVE_FAILED_RETRYABLE' &&
      receipt.status !== 'COMPLETE') ||
    checkpoint.stage !== 'DESTINATION_BROADCAST' ||
    checkpoint.sourceChainId !== MANIFEST_CONSTANTS.ARC_TESTNET_CHAIN_ID ||
    !destinationToken ||
    receipt.senderAddress.toLowerCase() !== checkpoint.walletAddress.toLowerCase() ||
    receipt.recipientAddress.toLowerCase() !== checkpoint.recipientAddress.toLowerCase() ||
    receipt.senderChainId !== checkpoint.sourceChainId ||
    receipt.recipientChainId !== checkpoint.destinationChainId ||
    receipt.tokenAddress.toLowerCase() !== checkpoint.tokenAddress.toLowerCase() ||
    receipt.amountRaw !== checkpoint.amountRaw ||
    !receipt.burnTxHash ||
    receipt.burnTxHash.toLowerCase() !== checkpoint.burnTxHash.toLowerCase() ||
    receipt.burnChainId !== checkpoint.sourceChainId ||
    receipt.burnBlockNumber === null ||
    !receipt.receiveTxHash ||
    !first.receiveTxHash ||
    !checkpoint.receiveTxHash ||
    receipt.receiveTxHash.toLowerCase() !== first.receiveTxHash.toLowerCase() ||
    checkpoint.receiveTxHash.toLowerCase() !== first.receiveTxHash.toLowerCase() ||
    receipt.receiveChainId !== checkpoint.destinationChainId ||
    reverted.outcome !== 'REVERTED' ||
    reverted.destinationChainId !== checkpoint.destinationChainId ||
    reverted.confirmations < 12 ||
    reverted.receiveTxHash.toLowerCase() !== first.receiveTxHash.toLowerCase() ||
    !second.receiveTxHash ||
    second.receiveTxHash.toLowerCase() === first.receiveTxHash.toLowerCase() ||
    mint.receiveTxHash.toLowerCase() !== second.receiveTxHash.toLowerCase() ||
    mint.destinationChainId !== checkpoint.destinationChainId ||
    mint.mintToken.toLowerCase() !== destinationToken.toLowerCase() ||
    mint.mintRecipient.toLowerCase() !== checkpoint.recipientAddress.toLowerCase() ||
    mint.mintAmountRaw !== checkpoint.amountRaw ||
    mint.confirmations < 12 ||
    !Number.isSafeInteger(mint.destinationBlockNumber) ||
    mint.destinationBlockNumber < 0 ||
    !/^0x[0-9a-fA-F]{64}$/.test(mint.destinationBlockHash)
  ) {
    throw new BridgeRecoveryConflictError(
      'Second settlement must match the reviewed source burn, first reverted receive and independently verified second mint.',
    );
  }

  if (
    receipt.settlementReceiveTxHash !== null &&
    receipt.settlementReceiveTxHash.toLowerCase() !== second.receiveTxHash.toLowerCase()
  ) {
    throw new BridgeRecoveryConflictError(
      'ActivityReceipt already contains a different immutable settlement transaction.',
    );
  }
  if (
    receipt.settlementReceiveBlockNumber !== null &&
    receipt.settlementReceiveBlockNumber !== mint.destinationBlockNumber
  ) {
    throw new BridgeRecoveryConflictError(
      'ActivityReceipt already contains a different settlement block.',
    );
  }
  if (
    receipt.settlementAttemptNumber !== null &&
    receipt.settlementAttemptNumber !== 2
  ) {
    throw new BridgeRecoveryConflictError(
      'ActivityReceipt settlement attempt identity is immutable.',
    );
  }
}

export async function finalizeVerifiedSecondCctpSettlement(
  db: DbClient,
  ownerUserId: string,
  planId: string,
): Promise<typeof activityReceipts.$inferSelect> {
  return db.transaction(async (tx) => {
    const [checkpoint] = await tx.select().from(bridgeRecoveryCheckpoints)
      .where(and(
        eq(bridgeRecoveryCheckpoints.planId, planId),
        eq(bridgeRecoveryCheckpoints.ownerUserId, ownerUserId),
      )).for('update');
    if (!checkpoint) {
      throw new BridgeRecoveryConflictError('Owned settlement checkpoint not found.');
    }

    const receipts = await tx.select().from(activityReceipts).where(and(
      eq(activityReceipts.senderUserId, ownerUserId),
      eq(activityReceipts.routeId, planId),
      eq(activityReceipts.providerId, 'cctp-v2-bridge'),
      eq(activityReceipts.action, 'BRIDGE'),
    )).limit(2).for('update');

    if (receipts.length !== 1) {
      throw new BridgeRecoveryConflictError(
        'Expected exactly one authenticated CCTP ActivityReceipt for this bridge action.',
      );
    }
    const receipt = receipts[0];

    const [[first], [reverted], [second], [mint]] = await Promise.all([
      tx.select().from(bridgeDestinationSubmissionClaims).where(and(
        eq(bridgeDestinationSubmissionClaims.planId, planId),
        eq(bridgeDestinationSubmissionClaims.ownerUserId, ownerUserId),
      )).limit(1),
      tx.select().from(bridgeDestinationAttemptResolutions).where(and(
        eq(bridgeDestinationAttemptResolutions.planId, planId),
        eq(bridgeDestinationAttemptResolutions.attemptNumber, 1),
        eq(bridgeDestinationAttemptResolutions.ownerUserId, ownerUserId),
      )).limit(1),
      tx.select().from(bridgeDestinationRetryAttempts).where(and(
        eq(bridgeDestinationRetryAttempts.planId, planId),
        eq(bridgeDestinationRetryAttempts.attemptNumber, 2),
        eq(bridgeDestinationRetryAttempts.ownerUserId, ownerUserId),
      )).limit(1),
      tx.select().from(bridgeDestinationRetryVerifications).where(and(
        eq(bridgeDestinationRetryVerifications.planId, planId),
        eq(bridgeDestinationRetryVerifications.attemptNumber, 2),
        eq(bridgeDestinationRetryVerifications.ownerUserId, ownerUserId),
      )).limit(1),
    ]);

    if (!first || !reverted || !second || !mint) {
      throw new BridgeRecoveryConflictError(
        'Second CCTP settlement requires both original revert and immutable verified second mint.',
      );
    }

    assertSecondCctpSettlementFinalizable(
      receipt, checkpoint, first, reverted, second, mint,
    );

    if (receipt.status === 'COMPLETE') {
      if (
        receipt.settlementReceiveTxHash?.toLowerCase() !==
          mint.receiveTxHash.toLowerCase() ||
        receipt.settlementReceiveBlockNumber !== mint.destinationBlockNumber ||
        receipt.settlementAttemptNumber !== 2
      ) {
        throw new BridgeRecoveryConflictError('Different terminal receipt already exists.');
      }
      return receipt; // identical finalization is idempotent
    }

    const now = new Date();
    const [updated] = await tx.update(activityReceipts).set({
      status: 'COMPLETE',
      settlementReceiveTxHash: mint.receiveTxHash.toLowerCase(),
      settlementReceiveBlockNumber: mint.destinationBlockNumber,
      settlementAttemptNumber: 2,
      completedAt: now,
      confirmedAt: now,
      failureReason: null,
      resumable: false,
      resumePayload: null,
      updatedAt: now,
      lastWrittenAt: now,
      lastWrittenBy: 'bff',
      revision: sql`${activityReceipts.revision} + 1`,
    }).where(eq(activityReceipts.receiptId, receipt.receiptId)).returning();

    if (!updated) {
      throw new BridgeRecoveryConflictError('Second settlement receipt update failed.');
    }

    await tx.insert(executionEvents).values({
      eventId: newEventId(),
      receiptId: receipt.receiptId,
      eventType: 'STATUS_TRANSITION',
      actor: 'bff',
      payload: {
        fromStatus: receipt.status,
        toStatus: 'COMPLETE',
        verification: 'SERVER_SECOND_CCTP_MINT_CANONICAL_FINALITY',
        firstAttemptRevertedHash: first.receiveTxHash,
        settlementAttemptNumber: 2,
        settlementReceiveTxHash: mint.receiveTxHash,
        settlementReceiveBlockNumber: mint.destinationBlockNumber,
        settlementReceiveBlockHash: mint.destinationBlockHash,
        confirmations: mint.confirmations,
        mintAmountRaw: mint.mintAmountRaw,
        mintToken: mint.mintToken,
        recipient: mint.mintRecipient,
      },
    });
    return updated;
  });
}
