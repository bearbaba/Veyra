/**
 * Owner-scoped social inbox. This is read-only: no profiles, addresses,
 * balances, wallet signatures or implied payment permissions are returned.
 *
 * Social changes are append-only. We MUST select the latest event per
 * canonical pair before filtering by status, or rejected/disconnected
 * friendships could reappear in the UI.
 */
import { sql } from 'drizzle-orm';
import type { DbClient } from '../db/client.js';

export type FriendInboxState = 'CONNECTED' | 'INCOMING_PENDING' | 'OUTGOING_PENDING';

export interface FriendInboxItem {
  veyraUserId: string;
  veyraHandle: string | null;
  state: FriendInboxState;
  updatedAt: string;
}

export class FriendInboxInputError extends Error {
  constructor() {
    super('Invalid friend inbox pagination');
    this.name = 'FriendInboxInputError';
  }
}

export function parseFriendInboxPagination(limitInput: unknown, offsetInput: unknown) {
  const parse = (input: unknown, fallback: number): number => {
    if (input === undefined) return fallback;
    if (typeof input !== 'string' || !/^(0|[1-9][0-9]*)$/.test(input)) {
      throw new FriendInboxInputError();
    }
    const n = Number(input);
    if (!Number.isSafeInteger(n)) throw new FriendInboxInputError();
    return n;
  };
  const limit = parse(limitInput, 20);
  const offset = parse(offsetInput, 0);
  if (limit < 1 || limit > 50 || offset > 1000) throw new FriendInboxInputError();
  return { limit, offset };
}

export async function listFriendInbox(
  db: DbClient,
  ownerUserId: string,
  { limit, offset }: { limit: number; offset: number },
): Promise<{ items: FriendInboxItem[]; hasMore: boolean; nextOffset: number | null }> {
  // Select latest connection for each pair BEFORE status filtering; also
  // select each direction's latest block/unblock event. Block overrides all
  // friendship states, including a recently issued payment review token.
  const result = await db.execute(sql`
    WITH current_connections AS (
      SELECT DISTINCT ON (user_a_id, user_b_id)
        connection_id, user_a_id, user_b_id, initiator_user_id,
        status, created_at
      FROM social_connections
      WHERE user_a_id = ${ownerUserId} OR user_b_id = ${ownerUserId}
      ORDER BY user_a_id, user_b_id, created_at DESC, connection_id DESC
    ),
    current_blocks AS (
      SELECT DISTINCT ON (blocker_user_id, blocked_user_id)
        blocker_user_id, blocked_user_id, status
      FROM social_blocks
      WHERE blocker_user_id = ${ownerUserId} OR blocked_user_id = ${ownerUserId}
      ORDER BY blocker_user_id, blocked_user_id, created_at DESC, block_id DESC
    )
    SELECT
      CASE WHEN c.user_a_id = ${ownerUserId} THEN c.user_b_id ELSE c.user_a_id END AS "veyraUserId",
      CASE WHEN p.status = 'ACTIVE' AND p.deleted_at IS NULL THEN p.veyr_handle ELSE NULL END AS "veyraHandle",
      CASE
        WHEN c.status = 'CONNECTED' THEN 'CONNECTED'
        WHEN c.initiator_user_id = ${ownerUserId} THEN 'OUTGOING_PENDING'
        ELSE 'INCOMING_PENDING'
      END AS "state",
      c.created_at AS "updatedAt"
    FROM current_connections c
    LEFT JOIN veyra_users p ON p.veyr_user_id = CASE WHEN c.user_a_id = ${ownerUserId} THEN c.user_b_id ELSE c.user_a_id END
    WHERE c.status IN ('CONNECTED', 'PENDING_INITIATOR', 'PENDING_TARGET')
      AND NOT EXISTS (
        SELECT 1 FROM current_blocks b
        WHERE b.status = 'BLOCKED'
          AND (
            (b.blocker_user_id = ${ownerUserId} AND b.blocked_user_id =
              CASE WHEN c.user_a_id = ${ownerUserId} THEN c.user_b_id ELSE c.user_a_id END)
            OR
            (b.blocked_user_id = ${ownerUserId} AND b.blocker_user_id =
              CASE WHEN c.user_a_id = ${ownerUserId} THEN c.user_b_id ELSE c.user_a_id END)
          )
      )
    ORDER BY c.created_at DESC, c.connection_id DESC
    LIMIT ${limit + 1} OFFSET ${offset}
  `);

  const rows = result.rows as Array<{
    veyraUserId: string;
    veyraHandle: string | null;
    state: FriendInboxState;
    updatedAt: Date | string;
  }>;
  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit).map(row => ({
    veyraUserId: row.veyraUserId,
    veyraHandle: row.veyraHandle,
    state: row.state,
    updatedAt: new Date(row.updatedAt).toISOString(),
  }));
  return { items, hasMore, nextOffset: hasMore ? offset + limit : null };
}
