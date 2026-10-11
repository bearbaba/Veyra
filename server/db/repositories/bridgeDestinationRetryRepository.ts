/**
 * Phase 5 second CCTP destination attempt foundation.
 *
 * Deliberately not wired to a signing route yet. A verified reverted FIRST
 * receive is a necessary precondition for reserving another destination
 * submission, but is NOT proof that the destination Circle nonce is unspent,
 * that a relay wallet has enough gas, or that ActivityReceipt can safely
 * finalize using a distinct receive tx. Those gates must ship together.
 *
 * The first receive hash, checkpoint and ActivityReceipt are never mutated.
 */
import { and, eq } from 'drizzle-orm';
import type { DbClient } from '../client.js';
import {
  bridgeDestinationAttemptResolutions,
  bridgeDestinationRetryAttempts,
  bridgeDestinationRetryEvents,
  bridgeDestinationSubmissionClaims,
  bridgeDestinationAttemptEvents,
  bridgeRecoveryCheckpoints,
} from '../schema/bridgeRecovery.js';
import { newEventId } from '../ids.js';
import { BridgeRecoveryConflictError } from './bridgeRecoveryRepository.js';

const HASH_RE = /^0x[0-9a-fA-F]{64}$/;

export type SecondDestinationAttemptState =
  | { mode: 'CLAIMED' }
  | { mode: 'UNCERTAIN' }
  | { mode: 'ALREADY_SUBMITTED'; txHash: string };

function existingState(
  hash: string | null,
): Exclude<SecondDestinationAttemptState, { mode: 'CLAIMED' }> {
  return hash ? { mode: 'ALREADY_SUBMITTED', txHash: hash } : { mode: 'UNCERTAIN' };
}

export async function getSecondDestinationAttempt(
  db: DbClient,
  ownerUserId: string,
  planId: string,
): Promise<Exclude<SecondDestinationAttemptState, { mode: 'CLAIMED' }> | null> {
  const [attempt] = await db
    .select()
    .from(bridgeDestinationRetryAttempts)
    .where(and(
      eq(bridgeDestinationRetryAttempts.planId, planId),
      eq(bridgeDestinationRetryAttempts.attemptNumber, 2),
      eq(bridgeDestinationRetryAttempts.ownerUserId, ownerUserId),
    ))
    .limit(1);
  return attempt ? existingState(attempt.receiveTxHash) : null;
}

/**
 * Only an owned checkpoint, immutable FIRST tx hash and existing canonical
 * >=12-confirmation revert proof permit a second-attempt reservation.
 * Concurrent sessions serialize on the checkpoint FOR UPDATE row lock.
 * A null tx hash is NEVER reclaimed after interruption.
 */
export async function claimSecondDestinationAttempt(
  db: DbClient,
  ownerUserId: string,
  planId: string,
): Promise<SecondDestinationAttemptState> {
  return db.transaction(async (tx) => {
    const [checkpoint] = await tx
      .select()
      .from(bridgeRecoveryCheckpoints)
      .where(and(
        eq(bridgeRecoveryCheckpoints.planId, planId),
        eq(bridgeRecoveryCheckpoints.ownerUserId, ownerUserId),
      ))
      .for('update');
    if (!checkpoint) {
      throw new BridgeRecoveryConflictError('Owned destination retry plan not found.');
    }

    const [first] = await tx
      .select()
      .from(bridgeDestinationSubmissionClaims)
      .where(and(
        eq(bridgeDestinationSubmissionClaims.planId, planId),
        eq(bridgeDestinationSubmissionClaims.ownerUserId, ownerUserId),
      ));
    const [proof] = await tx
      .select()
      .from(bridgeDestinationAttemptResolutions)
      .where(and(
        eq(bridgeDestinationAttemptResolutions.planId, planId),
        eq(bridgeDestinationAttemptResolutions.attemptNumber, 1),
        eq(bridgeDestinationAttemptResolutions.ownerUserId, ownerUserId),
      ));
    if (
      checkpoint.stage !== 'DESTINATION_BROADCAST' ||
      !checkpoint.attestationMessage ||
      !checkpoint.attestationSignature ||
      !checkpoint.receiveTxHash ||
      !first?.receiveTxHash ||
      !proof ||
      proof.outcome !== 'REVERTED' ||
      proof.confirmations < 12 ||
      checkpoint.destinationChainId !== proof.destinationChainId ||
      checkpoint.receiveTxHash.toLowerCase() !== first.receiveTxHash.toLowerCase() ||
      first.receiveTxHash.toLowerCase() !== proof.receiveTxHash.toLowerCase()
    ) {
      throw new BridgeRecoveryConflictError(
        'Second receive requires a matching owner-scoped, finality-verified reverted FIRST destination attempt.',
      );
    }

    const [existing] = await tx
      .select()
      .from(bridgeDestinationRetryAttempts)
      .where(and(
        eq(bridgeDestinationRetryAttempts.planId, planId),
        eq(bridgeDestinationRetryAttempts.attemptNumber, 2),
      ));
    if (existing) {
      if (existing.ownerUserId !== ownerUserId) {
        throw new BridgeRecoveryConflictError('Second-attempt claim owner mismatch.');
      }
      return existingState(existing.receiveTxHash);
    }

    await tx.insert(bridgeDestinationRetryAttempts).values({
      planId,
      attemptNumber: 2,
      ownerUserId,
    });
    await tx.insert(bridgeDestinationRetryEvents).values({
      eventId: newEventId(),
      planId,
      attemptNumber: 2,
      eventType: 'SUBMISSION_STARTED',
    });
    return { mode: 'CLAIMED' };
  });
}

/**
 * Record attempt #2 without overwriting the first attempt or recovery state.
 * Only a trusted server relay caller may use this after actual wallet broadcast;
 * a browser-provided arbitrary hash is not authoritative evidence.
 */
export async function recordSecondDestinationAttemptHash(
  db: DbClient,
  ownerUserId: string,
  planId: string,
  receiveTxHash: string,
): Promise<void> {
  if (!HASH_RE.test(receiveTxHash)) {
    throw new BridgeRecoveryConflictError('Invalid second receive transaction hash.');
  }
  const canonicalHash = receiveTxHash.toLowerCase();

  await db.transaction(async (tx) => {
    const [checkpoint] = await tx
      .select()
      .from(bridgeRecoveryCheckpoints)
      .where(and(
        eq(bridgeRecoveryCheckpoints.planId, planId),
        eq(bridgeRecoveryCheckpoints.ownerUserId, ownerUserId),
      ))
      .for('update');
    const [first] = await tx
      .select()
      .from(bridgeDestinationSubmissionClaims)
      .where(and(
        eq(bridgeDestinationSubmissionClaims.planId, planId),
        eq(bridgeDestinationSubmissionClaims.ownerUserId, ownerUserId),
      ));
    const [retry] = await tx
      .select()
      .from(bridgeDestinationRetryAttempts)
      .where(and(
        eq(bridgeDestinationRetryAttempts.planId, planId),
        eq(bridgeDestinationRetryAttempts.attemptNumber, 2),
        eq(bridgeDestinationRetryAttempts.ownerUserId, ownerUserId),
      ))
      .for('update');

    if (
      !checkpoint ||
      checkpoint.stage !== 'DESTINATION_BROADCAST' ||
      !first?.receiveTxHash ||
      checkpoint.receiveTxHash?.toLowerCase() !== first.receiveTxHash.toLowerCase() ||
      first.receiveTxHash.toLowerCase() === canonicalHash ||
      !retry
    ) {
      throw new BridgeRecoveryConflictError(
        'Second receive must be distinct and preserve the original first destination tx.',
      );
    }

    if (retry.receiveTxHash === canonicalHash) return;
    if (retry.receiveTxHash !== null) {
      throw new BridgeRecoveryConflictError(
        'Second destination transaction hash is immutable once recorded.',
      );
    }

    await tx.update(bridgeDestinationRetryAttempts).set({
      receiveTxHash: canonicalHash,
      updatedAt: new Date(),
    }).where(and(
      eq(bridgeDestinationRetryAttempts.planId, planId),
      eq(bridgeDestinationRetryAttempts.attemptNumber, 2),
    ));

    await tx.insert(bridgeDestinationRetryEvents).values({
      eventId: newEventId(),
      planId,
      attemptNumber: 2,
      eventType: 'BROADCAST_RECORDED',
      receiveTxHash: canonicalHash,
    });
  });
}

/**
 * Owner-only read model for cross-device recovery and audit. Never derives
 * "retry allowed" from a row being present: the two attempt states are
 * evidence, NOT transaction signing capabilities.
 */
export async function getOwnedDestinationAttemptHistory(
  db: DbClient,
  ownerUserId: string,
  planId: string,
): Promise<{
  planId: string;
  sourceBurnTxHash: string;
  destinationChainId: number;
  first: {
    receiveTxHash: string | null;
    state: 'UNCLAIMED' | 'UNCERTAIN' | 'RECORDED';
    reverted: boolean;
    revertBlockHash: string | null;
    confirmations: number | null;
  };
  second: {
    receiveTxHash: string | null;
    state: 'UNCLAIMED' | 'UNCERTAIN' | 'RECORDED';
  };
  history: Array<{
    attemptNumber: number;
    eventType: string;
    txHash: string | null;
    occurredAt: string;
  }>;
} | null> {
  const [checkpoint] = await db
    .select()
    .from(bridgeRecoveryCheckpoints)
    .where(and(
      eq(bridgeRecoveryCheckpoints.planId, planId),
      eq(bridgeRecoveryCheckpoints.ownerUserId, ownerUserId),
    ))
    .limit(1);
  if (!checkpoint) return null;

  const [[first], [proof], [second], firstEvents, retryEvents] = await Promise.all([
    db.select().from(bridgeDestinationSubmissionClaims).where(and(
      eq(bridgeDestinationSubmissionClaims.planId, planId),
      eq(bridgeDestinationSubmissionClaims.ownerUserId, ownerUserId),
    )).limit(1),
    db.select().from(bridgeDestinationAttemptResolutions).where(and(
      eq(bridgeDestinationAttemptResolutions.planId, planId),
      eq(bridgeDestinationAttemptResolutions.attemptNumber, 1),
      eq(bridgeDestinationAttemptResolutions.ownerUserId, ownerUserId),
    )).limit(1),
    db.select().from(bridgeDestinationRetryAttempts).where(and(
      eq(bridgeDestinationRetryAttempts.planId, planId),
      eq(bridgeDestinationRetryAttempts.attemptNumber, 2),
      eq(bridgeDestinationRetryAttempts.ownerUserId, ownerUserId),
    )).limit(1),
    db.select().from(bridgeDestinationAttemptEvents).where(
      eq(bridgeDestinationAttemptEvents.planId, planId),
    ),
    db.select().from(bridgeDestinationRetryEvents).where(and(
      eq(bridgeDestinationRetryEvents.planId, planId),
      eq(bridgeDestinationRetryEvents.attemptNumber, 2),
    )),
  ]);

  // Events belong to the already ownership-checked parent checkpoint.
  const history = [
    ...firstEvents.map((event) => ({
      attemptNumber: 1,
      eventType: event.eventType,
      txHash: event.receiveTxHash,
      occurredAt: event.occurredAt.toISOString(),
    })),
    ...retryEvents.map((event) => ({
      attemptNumber: event.attemptNumber,
      eventType: event.eventType,
      txHash: event.receiveTxHash,
      occurredAt: event.occurredAt.toISOString(),
    })),
  ].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));

  return {
    planId,
    sourceBurnTxHash: checkpoint.burnTxHash,
    destinationChainId: checkpoint.destinationChainId,
    first: {
      receiveTxHash: first?.receiveTxHash ?? null,
      state: !first ? 'UNCLAIMED' : first.receiveTxHash ? 'RECORDED' : 'UNCERTAIN',
      reverted: proof?.outcome === 'REVERTED',
      revertBlockHash: proof?.destinationBlockHash ?? null,
      confirmations: proof?.confirmations ?? null,
    },
    second: {
      receiveTxHash: second?.receiveTxHash ?? null,
      state: !second ? 'UNCLAIMED' : second.receiveTxHash ? 'RECORDED' : 'UNCERTAIN',
    },
    history,
  };
}
