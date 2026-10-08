/**
 * SocialRepository — follows, connections, blocks.
 *
 * Block invariant (amendment 6):
 * checkBlocked(blocker, blocked) must be called at the top of:
 *   - follow()
 *   - sendConnectionRequest()
 *   - resolveRecipient() (in VeyraIdentityResolver)
 *   - any payment recipient query
 *
 * A BLOCKED status from the latest row for a pair is definitive.
 * Block always overrides follow and connection state.
 */
import { and, desc, eq, or } from 'drizzle-orm';
import type { DbClient } from '../client.js';
import { socialBlocks, socialConnections, socialFollows } from '../schema/index.js';
import { newBlockId, newConnectionId, newFollowId } from '../ids.js';

// ── Block check (amendment 6) ───────────────────────────────────────────────

/**
 * Returns true if blockerUserId has an active BLOCKED state against blockedUserId.
 * Must be called before any follow, connection, or payment resolution operation.
 */
export async function isBlocked(
  db: DbClient,
  blockerUserId: string,
  blockedUserId: string,
): Promise<boolean> {
  const [latest] = await db
    .select({ status: socialBlocks.status })
    .from(socialBlocks)
    .where(
      and(
        eq(socialBlocks.blockerUserId, blockerUserId),
        eq(socialBlocks.blockedUserId, blockedUserId),
      ),
    )
    .orderBy(desc(socialBlocks.createdAt))
    .limit(1);

  return latest?.status === 'BLOCKED';
}

/**
 * Returns true if EITHER user has blocked the other.
 * Use for bidirectional block check before payment initiation.
 */
export async function isBlockedEither(
  db: DbClient,
  userA: string,
  userB: string,
): Promise<boolean> {
  const [aBlocksB, bBlocksA] = await Promise.all([
    isBlocked(db, userA, userB),
    isBlocked(db, userB, userA),
  ]);
  return aBlocksB || bBlocksA;
}

// ── Blocks ──────────────────────────────────────────────────────────────────

export async function blockUser(
  db: DbClient,
  blockerUserId: string,
  blockedUserId: string,
): Promise<void> {
  await db.insert(socialBlocks).values({
    blockId:       newBlockId(),
    blockerUserId,
    blockedUserId,
    status:        'BLOCKED',
  });
}

export async function unblockUser(
  db: DbClient,
  blockerUserId: string,
  blockedUserId: string,
): Promise<void> {
  await db.insert(socialBlocks).values({
    blockId:       newBlockId(),
    blockerUserId,
    blockedUserId,
    status:        'UNBLOCKED',
  });
}

// ── Follows ─────────────────────────────────────────────────────────────────

/**
 * Creates a follow edge. Enforces block check (amendment 6).
 * A follow grants ZERO financial permissions.
 */
export async function follow(
  db: DbClient,
  followerUserId: string,
  followeeUserId: string,
): Promise<void> {
  // Amendment 6: block overrides follow everywhere.
  const blocked = await isBlockedEither(db, followerUserId, followeeUserId);
  if (blocked) throw new Error('Cannot follow: a block relationship exists between these users.');

  await db.insert(socialFollows).values({
    followId:       newFollowId(),
    followerUserId,
    followeeUserId,
    status:         'FOLLOWING',
  });
}

export async function unfollow(
  db: DbClient,
  followerUserId: string,
  followeeUserId: string,
): Promise<void> {
  await db.insert(socialFollows).values({
    followId:       newFollowId(),
    followerUserId,
    followeeUserId,
    status:         'UNFOLLOWED',
  });
}

/** Returns the current follow status for a (follower, followee) pair. */
export async function getFollowStatus(
  db: DbClient,
  followerUserId: string,
  followeeUserId: string,
): Promise<'FOLLOWING' | 'UNFOLLOWED' | 'NONE'> {
  const [latest] = await db
    .select({ status: socialFollows.status })
    .from(socialFollows)
    .where(
      and(
        eq(socialFollows.followerUserId, followerUserId),
        eq(socialFollows.followeeUserId, followeeUserId),
      ),
    )
    .orderBy(desc(socialFollows.createdAt))
    .limit(1);

  return latest?.status ?? 'NONE';
}

// ── Connections (friendship) ─────────────────────────────────────────────────

/** Returns canonical [userA, userB] pair with userA < userB (lexicographic). */
function canonicalPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

/**
 * Sends a friend/connection request. Enforces block check (amendment 6).
 */
export async function sendConnectionRequest(
  db: DbClient,
  initiatorUserId: string,
  targetUserId: string,
): Promise<void> {
  // Amendment 6: block check first.
  const blocked = await isBlockedEither(db, initiatorUserId, targetUserId);
  if (blocked) throw new Error('Cannot send connection request: a block relationship exists.');

  const [userAId, userBId] = canonicalPair(initiatorUserId, targetUserId);

  // Determine PENDING_INITIATOR vs PENDING_TARGET based on canonical order.
  const status =
    initiatorUserId === userAId ? 'PENDING_INITIATOR' : 'PENDING_TARGET';

  await db.insert(socialConnections).values({
    connectionId:    newConnectionId(),
    userAId,
    userBId,
    initiatorUserId,
    status,
  });
}

export async function acceptConnection(
  db: DbClient,
  acceptorUserId: string,
  otherUserId: string,
): Promise<void> {
  const [userAId, userBId] = canonicalPair(acceptorUserId, otherUserId);
  await db.insert(socialConnections).values({
    connectionId:    newConnectionId(),
    userAId,
    userBId,
    initiatorUserId: otherUserId,  // original initiator
    status:          'CONNECTED',
  });
}

export async function rejectConnection(
  db: DbClient,
  rejectorUserId: string,
  otherUserId: string,
): Promise<void> {
  const [userAId, userBId] = canonicalPair(rejectorUserId, otherUserId);
  await db.insert(socialConnections).values({
    connectionId:    newConnectionId(),
    userAId,
    userBId,
    initiatorUserId: otherUserId,
    status:          'REJECTED',
  });
}

/** Returns current connection status for a pair. */
export async function getConnectionStatus(
  db: DbClient,
  userA: string,
  userB: string,
): Promise<typeof socialConnections.$inferSelect['status'] | 'NONE'> {
  const [a, b] = canonicalPair(userA, userB);
  const [latest] = await db
    .select({ status: socialConnections.status })
    .from(socialConnections)
    .where(and(eq(socialConnections.userAId, a), eq(socialConnections.userBId, b)))
    .orderBy(desc(socialConnections.createdAt))
    .limit(1);

  return latest?.status ?? 'NONE';
}
