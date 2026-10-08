/**
 * IdentityRepository — veyra_users and handle_history operations.
 *
 * Invariants enforced here:
 * - veyraUserId is the only FK/join key (never handle, never xAccountId).
 * - handle changes are revocations with handle_history entries, not in-place updates.
 * - Wallet/identity removals are revocations, not deletes (amendment 7).
 * - identity_revision increments happen in the Postgres trigger layer; this layer
 *   only writes identity_revisions audit rows.
 */
import { and, desc, eq, gt, isNull, lt, sql } from 'drizzle-orm';
import type { DbClient } from '../client.js';
import { handleHistory, veyraUsers } from '../schema/index.js';
import { identityRevisions } from '../schema/payments.js';
import { newHandleHistId, newRevisionId, newUserId } from '../ids.js';
import { normalizeHandle } from '../handleNormalizer.js';

export interface CreateUserParams {
  displayName?: string;
  avatarUrl?:   string;
  bio?:         string;
}

/** Creates a new Veyra user and claims their initial handle. */
export async function createUser(
  db: DbClient,
  handle: string,
  params: CreateUserParams = {},
): Promise<{ veyraUserId: string; veyraHandle: string }> {
  const normalizedHandle = normalizeHandle(handle);

  return db.transaction(async (tx) => {
    // 1. Check handle reservation window (30-day change rate + 90-day hold).
    await assertHandleAvailable(tx, normalizedHandle);

    const veyraUserId = newUserId();
    const now = new Date();

    // 2. Insert the user row.
    await tx.insert(veyraUsers).values({
      veyraUserId,
      veyraHandle:       normalizedHandle,
      displayName:       params.displayName ?? '',
      avatarUrl:         params.avatarUrl,
      bio:               params.bio ?? '',
      identityRevision:  1,   // Postgres trigger will increment; seed at 1
    });

    // 3. Write initial handle_history row (handle is "claimed" at creation).
    // releasedAt and reservedUntil will be set when/if the handle is changed.
    // We insert a sentinel row with future dates to mark it as "active claim".
    // The actual reservation row is written on handle change, not on creation.
    // (No handle_history row needed at creation — only on release.)

    // 4. Write the initial identity_revision audit row.
    await writeRevisionAudit(tx, {
      veyraUserId,
      revisionNumber: 1,
      trigger:        'WALLET_ADDED',   // Closest trigger at account creation
      detail:         { event: 'account_created', handle: normalizedHandle },
    });

    return { veyraUserId, veyraHandle: normalizedHandle };
  });
}

/** Changes a user's handle. Enforces 30-day rate limit and 90-day reservation. */
export async function changeHandle(
  db: DbClient,
  veyraUserId: string,
  newHandle: string,
): Promise<void> {
  const normalized = normalizeHandle(newHandle);

  await db.transaction(async (tx) => {
    // 1. Load current user.
    const [user] = await tx
      .select({ currentHandle: veyraUsers.veyraHandle, revision: veyraUsers.identityRevision })
      .from(veyraUsers)
      .where(eq(veyraUsers.veyraUserId, veyraUserId));

    if (!user) throw new Error(`User not found: ${veyraUserId}`);
    if (user.currentHandle === normalized) return; // No-op

    // 2. Enforce 30-day rate limit: check last release within 30 days.
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [recentChange] = await tx
      .select({ releasedAt: handleHistory.releasedAt })
      .from(handleHistory)
      .where(
        and(
          eq(handleHistory.veyraUserId, veyraUserId),
          gt(handleHistory.releasedAt, thirtyDaysAgo),
        ),
      )
      .orderBy(desc(handleHistory.releasedAt))
      .limit(1);

    if (recentChange) {
      const nextAllowed = new Date(recentChange.releasedAt.getTime() + 30 * 24 * 60 * 60 * 1000);
      throw new Error(
        `Handle changed too recently. Next change allowed after ${nextAllowed.toISOString()}.`,
      );
    }

    // 3. Check new handle reservation window.
    await assertHandleAvailable(tx, normalized);

    const now = new Date();
    const reservedUntil = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);

    // 4. Write handle_history row for the OLD handle.
    await tx.insert(handleHistory).values({
      handleHistoryId: newHandleHistId(),
      veyraUserId,
      handle:          user.currentHandle,
      claimedAt:       new Date(0),  // claim start unknown for migration; use epoch
      releasedAt:      now,
      reservedUntil,
    });

    // 5. Update the user row (also triggers Postgres identity_revision increment).
    await tx.update(veyraUsers)
      .set({ veyraHandle: normalized, updatedAt: now })
      .where(eq(veyraUsers.veyraUserId, veyraUserId));

    // 6. Write audit row.
    const newRevision = (user.revision ?? 1) + 1;
    await writeRevisionAudit(tx, {
      veyraUserId,
      revisionNumber: newRevision,
      trigger:        'HANDLE_CHANGED',
      detail:         { from: user.currentHandle, to: normalized },
    });
  });
}

/** Soft-deletes a user (sets status = DELETED, deleted_at = now). Never hard-deletes. */
export async function softDeleteUser(db: DbClient, veyraUserId: string): Promise<void> {
  await db.update(veyraUsers)
    .set({ status: 'DELETED', deletedAt: new Date() })
    .where(eq(veyraUsers.veyraUserId, veyraUserId));
}

/** Returns the current live identity_revision for a user (for snapshot verification). */
export async function getIdentityRevision(
  db: DbClient,
  veyraUserId: string,
): Promise<number | null> {
  const [row] = await db
    .select({ identityRevision: veyraUsers.identityRevision })
    .from(veyraUsers)
    .where(and(eq(veyraUsers.veyraUserId, veyraUserId), isNull(veyraUsers.deletedAt)));

  return row?.identityRevision ?? null;
}

// ── Internal helpers ────────────────────────────────────────────────────────

/** Throws if the handle is currently reserved by another user's handle_history window. */
async function assertHandleAvailable(
  tx: Parameters<Parameters<DbClient['transaction']>[0]>[0],
  normalized: string,
): Promise<void> {
  const now = new Date();
  const [reserved] = await tx
    .select({ reservedUntil: handleHistory.reservedUntil, hdlUserId: handleHistory.veyraUserId })
    .from(handleHistory)
    .where(
      and(
        eq(handleHistory.handle, normalized),
        gt(handleHistory.reservedUntil, now),
      ),
    )
    .limit(1);

  if (reserved) {
    throw new Error(
      `Handle @${normalized} is reserved until ${reserved.reservedUntil.toISOString()}.`,
    );
  }
}

interface RevisionAuditParams {
  veyraUserId:    string;
  revisionNumber: number;
  trigger:        typeof identityRevisions.$inferInsert['trigger'];
  detail:         Record<string, unknown>;
}

async function writeRevisionAudit(
  tx: Parameters<Parameters<DbClient['transaction']>[0]>[0],
  params: RevisionAuditParams,
): Promise<void> {
  await tx.insert(identityRevisions).values({
    revisionId:     newRevisionId(),
    veyraUserId:    params.veyraUserId,
    revisionNumber: params.revisionNumber,
    trigger:        params.trigger,
    detail:         params.detail,
  });
}
