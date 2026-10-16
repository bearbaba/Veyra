/**
 * Destination CCTP relay submission boundary.
 *
 * Claiming is a PostgreSQL transaction committed BEFORE the first wallet
 * broadcast. Concurrent requests cannot both claim the same planId.
 * A claim with no recorded hash is submission-uncertain and MUST remain
 * locked; never auto-expire or infer no tx from an absent RPC response.
 *
 * Ledger events are append-only at the PostgreSQL layer.
 */
import { and, eq } from 'drizzle-orm';
import type { DbClient } from '../client.js';
import {
  bridgeRecoveryCheckpoints,
  bridgeDestinationSubmissionClaims,
  bridgeDestinationAttemptEvents,
} from '../schema/bridgeRecovery.js';
import { newEventId } from '../ids.js';
import { BridgeRecoveryConflictError } from './bridgeRecoveryRepository.js';

const HASH_RE = /^0x[0-9a-fA-F]{64}$/;

export type DestinationSubmissionClaimState =
  | { mode: 'CLAIMED' }
  | { mode: 'UNCERTAIN' }
  | { mode: 'ALREADY_SUBMITTED'; txHash: string };

function stateFromHash(
  hash: string | null,
): Exclude<DestinationSubmissionClaimState, { mode: 'CLAIMED' }> {
  return hash ? { mode: 'ALREADY_SUBMITTED', txHash: hash } : { mode: 'UNCERTAIN' };
}

export async function getDestinationSubmissionClaim(
  db: DbClient,
  ownerUserId: string,
  planId: string,
): Promise<Exclude<DestinationSubmissionClaimState, { mode: 'CLAIMED' }> | null> {
  const [row] = await db
    .select()
    .from(bridgeDestinationSubmissionClaims)
    .where(
      and(
        eq(bridgeDestinationSubmissionClaims.planId, planId),
        eq(bridgeDestinationSubmissionClaims.ownerUserId, ownerUserId),
      ),
    )
    .limit(1);

  return row ? stateFromHash(row.receiveTxHash) : null;
}

/**
 * The DB row lock also protects against concurrent checkpoint advancement.
 * No RPC or wallet call may occur within this transaction.
 */
export async function claimDestinationSubmission(
  db: DbClient,
  ownerUserId: string,
  planId: string,
): Promise<DestinationSubmissionClaimState> {
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

    if (!checkpoint) {
      throw new BridgeRecoveryConflictError(
        'Destination relay plan is not owned by authenticated user.',
      );
    }

    const [existing] = await tx
      .select()
      .from(bridgeDestinationSubmissionClaims)
      .where(eq(bridgeDestinationSubmissionClaims.planId, planId));

    if (existing) {
      if (existing.ownerUserId !== ownerUserId) {
        throw new BridgeRecoveryConflictError('Destination claim owner mismatch.');
      }
      return stateFromHash(existing.receiveTxHash);
    }

    if (
      checkpoint.stage !== 'ATTESTATION_READY' ||
      checkpoint.receiveTxHash !== null ||
      !checkpoint.attestationMessage ||
      !checkpoint.attestationSignature
    ) {
      throw new BridgeRecoveryConflictError(
        'Destination relay requires an attestation-ready plan with no previous destination submission.',
      );
    }

    await tx.insert(bridgeDestinationSubmissionClaims).values({
      planId,
      ownerUserId,
      attemptNumber: 1,
    });

    await tx.insert(bridgeDestinationAttemptEvents).values({
      eventId: newEventId(),
      planId,
      eventType: 'SUBMISSION_STARTED',
    });

    return { mode: 'CLAIMED' };
  });
}

/**
 * Persist tx hash and checkpoint advance in ONE atomic transaction.
 * The first tx hash never changes, including across process restarts.
 */
export async function recordDestinationSubmission(
  db: DbClient,
  ownerUserId: string,
  planId: string,
  receiveTxHash: string,
): Promise<void> {
  if (!HASH_RE.test(receiveTxHash)) {
    throw new BridgeRecoveryConflictError('Invalid destination transaction hash.');
  }

  await db.transaction(async (tx) => {
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
      )
      .for('update');

    if (!checkpoint || !claim) {
      throw new BridgeRecoveryConflictError(
        'Destination submission claim and owned bridge checkpoint are required.',
      );
    }

    if (
      claim.receiveTxHash !== null &&
      claim.receiveTxHash.toLowerCase() === receiveTxHash.toLowerCase() &&
      checkpoint.receiveTxHash?.toLowerCase() === receiveTxHash.toLowerCase() &&
      checkpoint.stage === 'DESTINATION_BROADCAST'
    ) {
      return; // idempotent response for exactly the same persisted tx
    }

    // A self-relaying browser may have mirrored the destination checkpoint
    // before the RPC indexed its transaction. Accept ONLY the exact same
    // hash in that case. Different hashes and stage regressions remain blocked.
    const checkpointMatches =
      (checkpoint.stage === 'ATTESTATION_READY' &&
        checkpoint.receiveTxHash === null) ||
      (checkpoint.stage === 'DESTINATION_BROADCAST' &&
        checkpoint.receiveTxHash?.toLowerCase() === receiveTxHash.toLowerCase());

    if (
      claim.receiveTxHash !== null ||
      !checkpointMatches
    ) {
      throw new BridgeRecoveryConflictError(
        'Destination transaction is already recorded or checkpoint changed.',
      );
    }

    const now = new Date();
    await tx.update(bridgeDestinationSubmissionClaims).set({
      receiveTxHash: receiveTxHash.toLowerCase(),
      updatedAt: now,
    }).where(eq(bridgeDestinationSubmissionClaims.planId, planId));

    await tx.update(bridgeRecoveryCheckpoints).set({
      stage: 'DESTINATION_BROADCAST',
      receiveTxHash: receiveTxHash.toLowerCase(),
      updatedAt: now,
    }).where(eq(bridgeRecoveryCheckpoints.planId, planId));

    await tx.insert(bridgeDestinationAttemptEvents).values({
      eventId: newEventId(),
      planId,
      eventType: 'BROADCAST_RECORDED',
      receiveTxHash: receiveTxHash.toLowerCase(),
    });
  });
}
