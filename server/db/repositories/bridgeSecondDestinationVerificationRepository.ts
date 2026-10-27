/**
 * Immutable successful SECOND destination mint evidence. This repository
 * only records trusted chain proofs after a reverted first attempt; it never
 * updates the original checkpoint receive hash or ActivityReceipt.
 */
import { and, eq } from 'drizzle-orm';
import type { DbClient } from '../client.js';
import {
  bridgeRecoveryCheckpoints,
  bridgeDestinationSubmissionClaims,
  bridgeDestinationAttemptResolutions,
  bridgeDestinationRetryAttempts,
  bridgeDestinationRetryVerifications,
} from '../schema/bridgeRecovery.js';
import type { SecondDestinationMintProof } from '../../services/cctpSecondDestinationVerificationService.js';
import { BridgeRecoveryConflictError } from './bridgeRecoveryRepository.js';

const HASH_RE = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export function assertSecondDestinationMintFinalizable(
  checkpoint: Pick<
    typeof bridgeRecoveryCheckpoints.$inferSelect,
    'stage' | 'receiveTxHash' | 'destinationChainId' | 'recipientAddress' | 'amountRaw'
  >,
  first: Pick<typeof bridgeDestinationSubmissionClaims.$inferSelect, 'receiveTxHash'>,
  firstRevert: Pick<
    typeof bridgeDestinationAttemptResolutions.$inferSelect,
    'receiveTxHash' | 'destinationChainId' | 'outcome' | 'confirmations'
  >,
  second: Pick<typeof bridgeDestinationRetryAttempts.$inferSelect, 'receiveTxHash'>,
  proof: SecondDestinationMintProof,
  expectedToken: string,
): void {
  if (
    checkpoint.stage !== 'DESTINATION_BROADCAST' ||
    !checkpoint.receiveTxHash ||
    !first.receiveTxHash ||
    !second.receiveTxHash ||
    checkpoint.receiveTxHash.toLowerCase() !== first.receiveTxHash.toLowerCase() ||
    firstRevert.receiveTxHash.toLowerCase() !== first.receiveTxHash.toLowerCase() ||
    firstRevert.destinationChainId !== checkpoint.destinationChainId ||
    firstRevert.outcome !== 'REVERTED' ||
    firstRevert.confirmations < 12 ||
    second.receiveTxHash.toLowerCase() === first.receiveTxHash.toLowerCase() ||
    second.receiveTxHash.toLowerCase() !== proof.receiveTxHash.toLowerCase() ||
    proof.destinationChainId !== checkpoint.destinationChainId ||
    proof.mintRecipient.toLowerCase() !== checkpoint.recipientAddress.toLowerCase() ||
    proof.mintAmountRaw !== checkpoint.amountRaw ||
    proof.mintToken.toLowerCase() !== expectedToken.toLowerCase() ||
    !HASH_RE.test(proof.receiveTxHash) ||
    !HASH_RE.test(proof.destinationBlockHash) ||
    !ADDRESS_RE.test(proof.mintRecipient) ||
    !ADDRESS_RE.test(proof.mintToken) ||
    !Number.isSafeInteger(proof.destinationBlockNumber) ||
    proof.destinationBlockNumber < 0 ||
    !Number.isSafeInteger(proof.confirmations) ||
    proof.confirmations < 12
  ) {
    throw new BridgeRecoveryConflictError(
      'Second mint proof must match the immutable first revert, second tx, canonical chain, recipient, token and amount.',
    );
  }
}

export async function recordVerifiedSecondDestinationMint(
  db: DbClient,
  ownerUserId: string,
  planId: string,
  proof: SecondDestinationMintProof,
  expectedToken: string,
): Promise<SecondDestinationMintProof> {
  return db.transaction(async (tx) => {
    // All writers for this plan must serialize on the owned checkpoint row.
    const [checkpoint] = await tx.select().from(bridgeRecoveryCheckpoints).where(and(
      eq(bridgeRecoveryCheckpoints.planId, planId),
      eq(bridgeRecoveryCheckpoints.ownerUserId, ownerUserId),
    )).for('update');

    if (!checkpoint) {
      throw new BridgeRecoveryConflictError('Owned second-mint checkpoint not found.');
    }

    const [[first], [firstRevert], [second], [existing]] = await Promise.all([
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

    if (!first || !firstRevert || !second) {
      throw new BridgeRecoveryConflictError(
        'Second mint cannot be verified without original claim/revert and recorded retry tx.',
      );
    }

    assertSecondDestinationMintFinalizable(
      checkpoint, first, firstRevert, second, proof, expectedToken,
    );

    if (existing) {
      if (
        existing.receiveTxHash.toLowerCase() !== proof.receiveTxHash.toLowerCase() ||
        existing.destinationBlockNumber !== proof.destinationBlockNumber ||
        existing.destinationBlockHash.toLowerCase() !== proof.destinationBlockHash.toLowerCase() ||
        existing.destinationChainId !== proof.destinationChainId ||
        existing.mintToken.toLowerCase() !== proof.mintToken.toLowerCase() ||
        existing.mintRecipient.toLowerCase() !== proof.mintRecipient.toLowerCase() ||
        existing.mintAmountRaw !== proof.mintAmountRaw
      ) {
        throw new BridgeRecoveryConflictError(
          'Existing immutable second mint proof conflicts with independently checked evidence.',
        );
      }
      return {
        receiveTxHash: existing.receiveTxHash,
        destinationChainId: existing.destinationChainId,
        destinationBlockNumber: existing.destinationBlockNumber,
        destinationBlockHash: existing.destinationBlockHash,
        mintToken: existing.mintToken,
        mintRecipient: existing.mintRecipient,
        mintAmountRaw: existing.mintAmountRaw,
        confirmations: existing.confirmations,
      };
    }

    await tx.insert(bridgeDestinationRetryVerifications).values({
      planId,
      attemptNumber: 2,
      ownerUserId,
      receiveTxHash: proof.receiveTxHash.toLowerCase(),
      destinationChainId: proof.destinationChainId,
      destinationBlockNumber: proof.destinationBlockNumber,
      destinationBlockHash: proof.destinationBlockHash.toLowerCase(),
      mintToken: proof.mintToken.toLowerCase(),
      mintRecipient: proof.mintRecipient.toLowerCase(),
      mintAmountRaw: proof.mintAmountRaw,
      confirmations: proof.confirmations,
    });

    return proof;
  });
}
