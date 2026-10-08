/**
 * IndexedDB ↔ Server reconciliation — authority-classified merge.
 *
 * PostgreSQL is the authoritative source of truth.
 * IndexedDB is a local cache and recovery layer ONLY.
 *
 * Authority classification
 * ────────────────────────
 * Every cached record belongs to exactly one authority class:
 *
 *   SERVER_AUTHORITATIVE
 *     Identity, linked X identity, wallet bindings/revocations, receive
 *     preferences, follows, connections, blocks, confirmed receipts, and
 *     any execution state acknowledged by the BFF.
 *     → A client copy NEVER overwrites server state solely because the
 *       local revision number is higher.
 *     → On conflict: server wins, fail closed.
 *
 *   CACHE_REFRESH
 *     A server response is refreshing a locally-cached record where the
 *     server revision is >= the local revision.
 *     → Server wins entirely.
 *
 *   PENDING_LOCAL_MUTATION
 *     An unsynchronised local draft, pending execution recovery payload, or
 *     a locally-created clientIntentId that has not yet been acknowledged
 *     by the BFF.
 *     → Staged as a pending mutation, not applied directly to server rows.
 *     → Survives reload via the cache; uploaded through validated server
 *       commands on reconnect.
 *
 *   CONFLICT_REQUIRES_REVALIDATION
 *     Produced when a server-authoritative field (revoked wallet, blocked
 *     user, X binding) has changed while the client held a stale copy.
 *     → The cache is updated with the server's version.
 *     → The calling layer must invalidate any pending snapshot or review
 *       that depends on the changed record.
 *     → Fail closed: the stale local version is discarded.
 *
 * Receipt-specific behaviour
 * ──────────────────────────
 * activity_receipts straddle PENDING_LOCAL_MUTATION (before BFF acknowledgement)
 * and SERVER_AUTHORITATIVE (after). The `bffAcknowledged` flag on a
 * CachedReceipt tracks this boundary.
 *
 *   bffAcknowledged = false  → PENDING_LOCAL_MUTATION
 *     The record is a local draft or in-progress execution not yet persisted
 *     on the server. The clientIntentId is stable and travels with it.
 *     resumePayload is the canonical recovery payload for this side.
 *
 *   bffAcknowledged = true   → SERVER_AUTHORITATIVE
 *     The server owns this record. Client copies that diverge from the server
 *     must be reconciled by taking the server version.
 *
 * Conflict rules for bffAcknowledged = true at equal revision:
 *   - status:          higher enum value wins (advancement-only)
 *   - bridge fields:   server wins if non-null; client kept only if server null
 *   - resumePayload:   server wins if present; client kept only if server absent
 *   - events:          union by eventId (append-only, no conflict)
 *   - identity fields: server ALWAYS wins (fail closed)
 */

import type { CachedReceipt } from './indexedDbCache.js';

// ── Authority classification ─────────────────────────────────────────────────

export type ReconciliationAuthority =
  | 'SERVER_AUTHORITATIVE'
  | 'CACHE_REFRESH'
  | 'PENDING_LOCAL_MUTATION'
  | 'CONFLICT_REQUIRES_REVALIDATION';

export interface ReconciliationResult {
  authority:  ReconciliationAuthority;
  /** The record to persist back to IndexedDB. */
  merged:     CachedReceipt;
  /**
   * True when an identity/security field changed on the server side —
   * e.g. wallet revoked, X binding changed, block issued.
   * The calling layer MUST invalidate any pending review or snapshot.
   */
  requiresRevalidation: boolean;
  /** Human-readable reason for CONFLICT_REQUIRES_REVALIDATION. */
  revalidationReason?:  string;
}

// ── Status enum ordering ─────────────────────────────────────────────────────
// Higher index = more advanced / terminal state.
// Must stay in sync with the receipt_status Postgres enum.

const STATUS_ORDER: readonly string[] = [
  'INTENT_CAPTURED',
  'QUOTE_RESERVED',
  'PREFLIGHT_PASSED',
  'SIGNED',
  'BROADCAST',
  'CONFIRMING',
  'CONFIRMED',
  'FAILED',
  'RECEIVE_PENDING',
  'RECEIVE_FAILED_RETRYABLE',
  'COMPLETE',
  'DUPLICATE_DETECTED',
  'INVALIDATED',
] as const;

// Terminal states — once reached on the server, the client must never roll back.
const TERMINAL_SERVER_STATES = new Set([
  'COMPLETE',
  'FAILED',
  'DUPLICATE_DETECTED',
  'INVALIDATED',
]);

function statusRank(status: string): number {
  const idx = STATUS_ORDER.indexOf(status);
  return idx === -1 ? -1 : idx;
}

// ── Server receipt summary (what the BFF returns) ───────────────────────────

export interface ServerReceiptSummary {
  receiptId:          string;
  status:             string;
  revision:           number;
  bffAcknowledged?:   boolean;   // true once the server has persisted the record
  burnTxHash?:        string | null;
  messageHash?:       string | null;
  messageBytes?:      string | null;
  attestationNonce?:  string | null;
  receiveTxHash?:     string | null;
  resumePayload?:     Record<string, unknown> | null;
  updatedAt:          number;
}

// ── Identity/security conflict descriptor ───────────────────────────────────

export interface IdentityConflict {
  field:       string;
  serverValue: unknown;
  clientValue: unknown;
}

// Checks whether any server-authoritative identity/security fields diverge
// from what the client cached. If so, the client MUST discard its copy and
// the calling layer must revalidate.
function detectIdentityConflict(
  client: CachedReceipt,
  server: ServerReceiptSummary,
): IdentityConflict | null {
  // For receipts: the immutable fields that the server sets at creation time.
  // If the server has a terminal status the client does not, that is a conflict.
  if (
    TERMINAL_SERVER_STATES.has(server.status) &&
    !TERMINAL_SERVER_STATES.has(client.status)
  ) {
    return { field: 'status', serverValue: server.status, clientValue: client.status };
  }
  return null;
}

// ── Main merge function ──────────────────────────────────────────────────────

/**
 * Merges a server receipt summary into the locally cached receipt.
 *
 * Returns a ReconciliationResult with:
 *   - the authority classification
 *   - the merged CachedReceipt to persist back to IndexedDB
 *   - whether revalidation of pending reviews is required
 */
export function mergeReceipt(
  client: CachedReceipt,
  server: ServerReceiptSummary,
): ReconciliationResult {
  const sRev      = server.revision;
  const cRev      = client.revision;
  const serverAck = server.bffAcknowledged ?? client.bffAcknowledged ?? false;

  // ── Case 1: pending local mutation (not yet acknowledged by BFF) ─────────
  // The local record is a draft. It may be uploaded as a pending mutation
  // but must never overwrite a server row directly.
  if (!serverAck && !client.bffAcknowledged) {
    // If the server somehow already has an acknowledged record for the same
    // receiptId, that means the BFF acknowledged it between our local write
    // and this sync — treat as CACHE_REFRESH and let server win.
    if (server.bffAcknowledged) {
      const merged = buildServerWins(client, server);
      return {
        authority:           'CACHE_REFRESH',
        merged:              { ...merged, bffAcknowledged: true },
        requiresRevalidation: false,
      };
    }

    // Still unacknowledged on both sides — keep local, preserve clientIntentId.
    return {
      authority:            'PENDING_LOCAL_MUTATION',
      merged:               client,
      requiresRevalidation: false,
    };
  }

  // From here on the record is SERVER_AUTHORITATIVE (bffAcknowledged = true).

  // ── Case 2: server clearly ahead (revision > client) ────────────────────
  if (sRev > cRev) {
    const conflict = detectIdentityConflict(client, server);
    const merged   = buildServerWins(client, server);
    if (conflict !== null) {
      return {
        authority:            'CONFLICT_REQUIRES_REVALIDATION',
        merged:               { ...merged, bffAcknowledged: true },
        requiresRevalidation: true,
        revalidationReason:   `Server changed ${conflict.field}: ${String(conflict.clientValue)} → ${String(conflict.serverValue)}`,
      };
    }
    return {
      authority:            'CACHE_REFRESH',
      merged:               { ...merged, bffAcknowledged: true },
      requiresRevalidation: false,
    };
  }

  // ── Case 3: client revision > server revision — fail closed ─────────────
  // For server-authoritative records, a higher local revision does NOT mean
  // the client wins. The local cache may be stale, corrupt, or tampered with.
  // Treat as a conflict requiring revalidation; take the server's state.
  if (cRev > sRev) {
    // Exception: if the server is at a terminal state, that always wins.
    if (TERMINAL_SERVER_STATES.has(server.status)) {
      const merged = buildServerWins(client, server);
      return {
        authority:            'CONFLICT_REQUIRES_REVALIDATION',
        merged:               { ...merged, bffAcknowledged: true },
        requiresRevalidation: true,
        revalidationReason:   `Server reached terminal state ${server.status} while client was at revision ${cRev}`,
      };
    }

    // Non-terminal: keep client state but flag for revalidation.
    // The calling layer should re-fetch from the server on next opportunity.
    return {
      authority:            'CONFLICT_REQUIRES_REVALIDATION',
      merged:               { ...client, bffAcknowledged: true },
      requiresRevalidation: true,
      revalidationReason:   `Client revision ${cRev} ahead of server revision ${sRev} — server is authoritative; revalidation required`,
    };
  }

  // ── Case 4: equal revision — field-level merge ───────────────────────────
  // Both sides agree on revision. Merge per-field with server-wins on security
  // fields and status-advancement for receipt state.

  const conflict = detectIdentityConflict(client, server);
  if (conflict !== null) {
    const merged = buildServerWins(client, server);
    return {
      authority:            'CONFLICT_REQUIRES_REVALIDATION',
      merged:               { ...merged, bffAcknowledged: true },
      requiresRevalidation: true,
      revalidationReason:   `Identity/security conflict at equal revision — field ${conflict.field}`,
    };
  }

  // Status: take the more advanced state (never roll back).
  const mergedStatus =
    statusRank(server.status) >= statusRank(client.status)
      ? server.status
      : client.status;

  // Bridge fields: server wins if non-null; client value preserved if server null.
  const merged: CachedReceipt = {
    ...client,
    bffAcknowledged:  true,
    status:           mergedStatus,
    revision:         cRev,
    burnTxHash:       server.burnTxHash       ?? client.burnTxHash,
    messageHash:      server.messageHash      ?? client.messageHash,
    messageBytes:     server.messageBytes     ?? client.messageBytes,
    attestationNonce: server.attestationNonce ?? client.attestationNonce,
    receiveTxHash:    server.receiveTxHash    ?? client.receiveTxHash,
    // Resume payload: server wins if present (server has more complete state).
    resumePayload:    server.resumePayload    ?? client.resumePayload,
    updatedAt:        Math.max(server.updatedAt, client.updatedAt),
  };

  return {
    authority:            'SERVER_AUTHORITATIVE',
    merged,
    requiresRevalidation: false,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildServerWins(
  client: CachedReceipt,
  server: ServerReceiptSummary,
): CachedReceipt {
  return {
    ...client,
    status:           server.status,
    revision:         server.revision,
    burnTxHash:       server.burnTxHash       ?? client.burnTxHash,
    messageHash:      server.messageHash      ?? client.messageHash,
    messageBytes:     server.messageBytes     ?? client.messageBytes,
    attestationNonce: server.attestationNonce ?? client.attestationNonce,
    receiveTxHash:    server.receiveTxHash    ?? client.receiveTxHash,
    resumePayload:    server.resumePayload    ?? client.resumePayload,
    updatedAt:        server.updatedAt,
  };
}

// ── Identity record reconciliation (separate from receipts) ──────────────────
// Used for wallet bindings, linked identities, blocks, preferences —
// all SERVER_AUTHORITATIVE, no client-wins path.

export type IdentityRecordType =
  | 'WALLET_BINDING'
  | 'LINKED_IDENTITY'
  | 'SOCIAL_BLOCK'
  | 'RECEIVE_PREFERENCE'
  | 'FOLLOW';

export interface CachedIdentityRecord {
  recordId:   string;
  recordType: IdentityRecordType;
  revision:   number;
  status:     string;
  data:       Record<string, unknown>;
  cachedAt:   number;
}

export interface ServerIdentityRecord {
  recordId:   string;
  recordType: IdentityRecordType;
  revision:   number;
  status:     string;
  data:       Record<string, unknown>;
  updatedAt:  number;
}

export interface IdentityReconciliationResult {
  authority:            ReconciliationAuthority;
  merged:               CachedIdentityRecord;
  requiresRevalidation: boolean;
  revalidationReason?:  string;
}

/**
 * Reconcile a server-authoritative identity record with a local cache entry.
 *
 * Rules:
 *   - Server ALWAYS wins for identity records. There is no client-wins path.
 *   - REVOKED / BLOCKED states are terminal and can never be downgraded by
 *     a client copy, regardless of revision numbers.
 *   - A client cache with a higher revision than the server is treated as
 *     CONFLICT_REQUIRES_REVALIDATION, not as a valid local mutation.
 */
export function mergeIdentityRecord(
  client: CachedIdentityRecord,
  server: ServerIdentityRecord,
): IdentityReconciliationResult {
  const TERMINAL_IDENTITY_STATES = new Set(['REVOKED', 'BLOCKED', 'SUSPENDED', 'DELETED']);

  // Terminal server states always win — no exceptions.
  if (TERMINAL_IDENTITY_STATES.has(server.status)) {
    const merged: CachedIdentityRecord = {
      ...client,
      revision: server.revision,
      status:   server.status,
      data:     server.data,
      cachedAt: Date.now(),
    };

    const wasAlreadyTerminal = TERMINAL_IDENTITY_STATES.has(client.status);
    return {
      authority:            'CONFLICT_REQUIRES_REVALIDATION',
      merged,
      requiresRevalidation: !wasAlreadyTerminal,
      revalidationReason:   wasAlreadyTerminal
        ? undefined
        : `Server set ${server.recordType} to terminal state ${server.status} — client had ${client.status}`,
    };
  }

  // Non-terminal: server always wins regardless of client revision.
  // Client revision > server revision is not a valid local mutation for identity records.
  const merged: CachedIdentityRecord = {
    ...client,
    revision: server.revision,
    status:   server.status,
    data:     server.data,
    cachedAt: Date.now(),
  };

  const revisionAnomalous = client.revision > server.revision;
  return {
    authority:            revisionAnomalous ? 'CONFLICT_REQUIRES_REVALIDATION' : 'SERVER_AUTHORITATIVE',
    merged,
    requiresRevalidation: revisionAnomalous,
    revalidationReason:   revisionAnomalous
      ? `Client revision ${client.revision} > server revision ${server.revision} for ${server.recordType} — server is authoritative`
      : undefined,
  };
}
