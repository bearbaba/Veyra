/**
 * Append-only destination revert evidence, separate from the immutable first
 * receive transaction hash and its submission claim. No second relay is
 * authorized by writing this proof.
 */
import { and, eq } from 'drizzle-orm';
import type { DbClient } from '../client.js';
import {
  bridgeRecoveryCheckpoints,
  bridgeDestinationSubmissionClaims,
  bridgeDestinationAttemptResolutions,
} from '../schema/bridgeRecovery.js';
import { BridgeRecoveryConflictError } from './bridgeRecoveryRepository.js';
import type { VerifiedDestinationRevert } from '../../services/cctpDestinationRevertVerificationService.js';

const HASH_RE = /^0x[0-9a-fA-F]{64}$/;

/** Called AGAIN under the database row lock after on-chain verification. */
export function assertFirstDestinationRevertFinalizable(
  checkpoint: Pick<
    typeof bridgeRecoveryCheckpoints.$inferSelect,
    'stage' | 'destinationChainId' | 'receiveTxHash'
  >,
  claim: Pick<
    typeof bridgeDestinationSubmissionClaims.$inferSelect,
    'receiveTxHash'
  >,
  proof: VerifiedDestinationRevert,
): void {
  if (
    checkpoint.stage !== 'DESTINATION_BROADCAST' ||
    !checkpoint.receiveTxHash ||
    !claim.receiveTxHash ||
    checkpoint.receiveTxHash.toLowerCase() !== proof.receiveTxHash.toLowerCase() ||
    claim.receiveTxHash.toLowerCase() !== proof.receiveTxHash.toLowerCase() ||
    checkpoint.destinationChainId !== proof.destinationChainId ||
    !Number.isSafeInteger(proof.destinationBlockNumber) ||
    proof.destinationBlockNumber < 0 ||
    !Number.isSafeInteger(proof.confirmations) ||
    proof.confirmations < 12 ||
    !HASH_RE.test(proof.receiveTxHash) ||
    !HASH_RE.test(proof.destinationBlockHash)
  ) {
    throw new BridgeRecoveryConflictError(
      'Revert evidence must match the exact immutable first destination tx, chain and finality.',
    );
  }
}

export async function recordVerifiedFirstDestinationRevert(
  db: DbClient,
  ownerUserId: string,
  planId: string,
  proof: VerifiedDestinationRevert,
): Promise<VerifiedDestinationRevert> {
  return db.transaction(async (tx) => {
    const [checkpoint] = await tx
      .select()
      .from(bridgeRecoveryCheckpoints)
      .where(
        and(
          eq(bridgeRecoveryCheckpoints.planId, planId),
          eq(bridgeRecoveryCheckpoints.ownerUserId, ownerUserId),
        ),
      )
      .for('update');
    const [claim] = await tx
      .select()
      .from(bridgeDestinationSubmissionClaims)
      .where(
        and(
          eq(bridgeDestinationSubmissionClaims.planId, planId),
          eq(bridgeDestinationSubmissionClaims.ownerUserId, ownerUserId),
        ),
      );

    if (!checkpoint || !claim) {
      throw new BridgeRecoveryConflictError(
        'Owned first destination claim/checkpoint not found.',
      );
    }
    assertFirstDestinationRevertFinalizable(checkpoint, claim, proof);

    const [existing] = await tx
      .select()
      .from(bridgeDestinationAttemptResolutions)
      .where(
        and(
          eq(bridgeDestinationAttemptResolutions.planId, planId),
          eq(bridgeDestinationAttemptResolutions.attemptNumber, 1),
        ),
      );

    if (existing) {
      if (
        existing.ownerUserId !== ownerUserId ||
        existing.receiveTxHash.toLowerCase() !== proof.receiveTxHash.toLowerCase() ||
        existing.destinationBlockNumber !== proof.destinationBlockNumber ||
        existing.destinationBlockHash.toLowerCase() !== proof.destinationBlockHash.toLowerCase() ||
        existing.destinationChainId !== proof.destinationChainId
      ) {
        throw new BridgeRecoveryConflictError(
          'Existing append-only destination revert proof conflicts with newly verified evidence.',
        );
      }
      return {
        receiveTxHash: existing.receiveTxHash,
        destinationChainId: existing.destinationChainId,
        destinationBlockNumber: existing.destinationBlockNumber,
        destinationBlockHash: existing.destinationBlockHash,
        confirmations: existing.confirmations,
      };
    }

    await tx.insert(bridgeDestinationAttemptResolutions).values({
      planId,
      attemptNumber: 1,
      ownerUserId,
      receiveTxHash: proof.receiveTxHash.toLowerCase(),
      destinationChainId: proof.destinationChainId,
      destinationBlockNumber: proof.destinationBlockNumber,
      destinationBlockHash: proof.destinationBlockHash.toLowerCase(),
      confirmations: proof.confirmations,
      outcome: 'REVERTED',
    });

    return proof;
  });
}
