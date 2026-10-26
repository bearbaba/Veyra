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
import { and, desc, eq, or, sql } from 'drizzle-orm';
import type { DbClient } from '../client.js';
import { socialBlocks, socialConnections, socialFollows, veyraNotifications } from '../schema/index.js';
import { newBlockId, newConnectionId, newFollowId, newNotificationId } from '../ids.js';

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
  if (blockerUserId === blockedUserId) throw new Error('You cannot block your own Veyra ID.');
  // A block revokes the friendship itself. Without this append-only
  // DISCONNECTED event, unblocking would silently restore an old CONNECTED
  // edge and its social visibility without a new friend request.
  await db.transaction(async tx => {
    await tx.insert(socialBlocks).values({
      blockId: newBlockId(),
      blockerUserId,
      blockedUserId,
      status: 'BLOCKED',
    });
    const [userAId, userBId] = await canonicalPair(tx, blockerUserId, blockedUserId);
    const [latest] = await tx.select().from(socialConnections)
      .where(and(eq(socialConnections.userAId, userAId), eq(socialConnections.userBId, userBId)))
      .orderBy(desc(socialConnections.createdAt), desc(socialConnections.connectionId)).limit(1);
    if (latest && ['PENDING_INITIATOR', 'PENDING_TARGET', 'CONNECTED'].includes(latest.status)) {
      await tx.insert(socialConnections).values({
        connectionId: newConnectionId(), userAId, userBId,
        initiatorUserId: latest.initiatorUserId, status: 'DISCONNECTED',
      });
    }
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

/** Match the database collation used by chk_social_connections_canonical_order.
 * JavaScript's binary ordering differs for mixed-case IDs on locale-aware databases.
 * Use the same connection/transaction as the caller so reads and writes agree.
 */
async function canonicalPair(db: Pick<DbClient, 'execute'>, a: string, b: string): Promise<[string, string]> {
  const result = await db.execute<{ a_first: boolean }>(sql`SELECT ${a}::text < ${b}::text AS a_first`);
  const first = result.rows[0]?.a_first;
  if (typeof first !== 'boolean') throw new Error('Could not determine friendship ordering.');
  return first ? [a, b] : [b, a];
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

  if (initiatorUserId === targetUserId) throw new Error('You cannot send yourself a friend request.');
  const [userAId, userBId] = await canonicalPair(db, initiatorUserId, targetUserId);
  const current = await getConnectionStatus(db, initiatorUserId, targetUserId);
  if (current === 'CONNECTED') throw new Error('These Veyra IDs are already friends.');
  if (current === 'PENDING_INITIATOR' || current === 'PENDING_TARGET') {
    throw new Error('A friend request is already pending for this pair.');
  }

  // Determine PENDING_INITIATOR vs PENDING_TARGET based on canonical order.
  const status =
    initiatorUserId === userAId ? 'PENDING_INITIATOR' : 'PENDING_TARGET';

  // One atomic change: do not show a friend request without a matching
  // server-owned inbox event, and never publish a notification for a failed insert.
  const connectionId=newConnectionId();
  await db.transaction(async tx=>{
    await tx.insert(socialConnections).values({
      connectionId,userAId,userBId,initiatorUserId,status,
    });
    await tx.insert(veyraNotifications).values({
      notificationId:newNotificationId(),ownerUserId:targetUserId,
      actorUserId:initiatorUserId,kind:'FRIEND_REQUEST',eventRef:connectionId,
    });
  });
}

async function pendingConnectionForResponse(db: DbClient, responderUserId: string, otherUserId: string) {
  const [userAId, userBId] = await canonicalPair(db, responderUserId, otherUserId);
  const [latest] = await db.select().from(socialConnections)
    .where(and(eq(socialConnections.userAId, userAId), eq(socialConnections.userBId, userBId)))
    .orderBy(desc(socialConnections.createdAt)).limit(1);
  if (!latest || !['PENDING_INITIATOR', 'PENDING_TARGET'].includes(latest.status)) {
    throw new Error('No pending connection request exists for this pair.');
  }
  if (latest.initiatorUserId === responderUserId) {
    throw new Error('The connection initiator cannot accept or reject their own request.');
  }
  if (await isBlockedEither(db, responderUserId, otherUserId)) {
    throw new Error('Cannot respond to connection request: a block relationship exists.');
  }
  return { userAId, userBId, initiatorUserId: latest.initiatorUserId };
}

export async function acceptConnection(
  db: DbClient,
  acceptorUserId: string,
  otherUserId: string,
): Promise<void> {
  const pending = await pendingConnectionForResponse(db, acceptorUserId, otherUserId);
  const connectionId=newConnectionId();
  await db.transaction(async tx=>{
    await tx.insert(socialConnections).values({
      connectionId,...pending,status:'CONNECTED',
    });
    await tx.insert(veyraNotifications).values({
      notificationId:newNotificationId(),
      ownerUserId:pending.initiatorUserId,actorUserId:acceptorUserId,
      kind:'FRIEND_ACCEPTED',eventRef:connectionId,
    });
  });
}

export async function rejectConnection(
  db: DbClient,
  rejectorUserId: string,
  otherUserId: string,
): Promise<void> {
  const pending = await pendingConnectionForResponse(db, rejectorUserId, otherUserId);
  await db.insert(socialConnections).values({
    connectionId: newConnectionId(), ...pending, status: 'REJECTED',
  });
}

/** Returns current connection status for a pair. */
export async function getConnectionStatus(
  db: DbClient,
  userA: string,
  userB: string,
): Promise<typeof socialConnections.$inferSelect['status'] | 'NONE'> {
  const [a, b] = await canonicalPair(db, userA, userB);
  // A block must never be represented as an active friendship even if the
  // connection log has not yet recorded DISCONNECTED.
  if (await isBlockedEither(db, userA, userB)) return 'DISCONNECTED';
  const [latest] = await db
    .select({ status: socialConnections.status })
    .from(socialConnections)
    .where(and(eq(socialConnections.userAId, a), eq(socialConnections.userBId, b)))
    .orderBy(desc(socialConnections.createdAt))
    .limit(1);

  return latest?.status ?? 'NONE';
}
