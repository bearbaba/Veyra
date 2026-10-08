/**
 * Veyra Quote Replay Protection Store
 *
 * Lifecycle: AVAILABLE → RESERVED → BROADCAST → USED
 *
 * Required operations:
 * - reserve (AVAILABLE → RESERVED, atomic before wallet execution)
 * - release reservation (RESERVED → AVAILABLE, only if not yet broadcast)
 * - mark broadcast (RESERVED → BROADCAST)
 * - mark used (BROADCAST → USED)
 * - stale reservation reconciliation
 * - replay detection
 * - expiry cleanup
 *
 * Persisted in IndexedDB so replay protection survives page reload.
 * Execution cannot start before this store has hydrated.
 *
 * Uncertain broadcast state stays locked until reconciled (never auto-released).
 */

import { SECURITY_CONFIG } from '../../lib/securityConfig';

// ── Quote Lifecycle ───────────────────────────────────────────────────────────

export type QuoteState = 'AVAILABLE' | 'RESERVED' | 'BROADCAST' | 'USED';

export interface QuoteEntry {
  quoteId: string;
  state: QuoteState;
  /** Expiry timestamp from the provider (ms). */
  expiresAt: number;
  /** ms timestamp when the reservation was created (for stale detection). */
  reservedAt?: number;
  /** ms timestamp when broadcast was recorded. */
  broadcastAt?: number;
  /** ms timestamp when usage was confirmed. */
  usedAt?: number;
  /** ms timestamp when entry was created. */
  createdAt: number;
  /** ms timestamp of last update. */
  updatedAt: number;
}

// ── IndexedDB Setup ───────────────────────────────────────────────────────────

const DB_NAME = 'veyra-quote-replay';
const DB_VERSION = 1;
const STORE_NAME = 'quotes';

let _db: IDBDatabase | null = null;
/** True once hydration completes successfully. Execution gates on this. */
let _hydrated = false;

function openDb(): Promise<IDBDatabase> {
  if (_db) return Promise.resolve(_db);

  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'quoteId' });
        store.createIndex('state', 'state', { unique: false });
        store.createIndex('expiresAt', 'expiresAt', { unique: false });
      }
    };

    req.onsuccess = (event) => {
      _db = (event.target as IDBOpenDBRequest).result;
      resolve(_db);
    };

    req.onerror = (event) => {
      reject(
        new Error(
          `[quoteReplayStore] Failed to open IndexedDB: ${(event.target as IDBOpenDBRequest).error?.message}`,
        ),
      );
    };
  });
}

// ── Hydration ─────────────────────────────────────────────────────────────────

/**
 * Hydrate the store. Must complete before execution is enabled.
 * Performs stale reservation reconciliation and expiry cleanup on startup.
 */
export async function hydrateQuoteReplayStore(): Promise<void> {
  await openDb();
  await reconcileStaleReservations();
  await cleanupExpired();
  _hydrated = true;
}

/** Returns true after successful hydration. */
export function isQuoteReplayStoreHydrated(): boolean {
  return _hydrated;
}

/** Assert hydrated — throws if not. */
export function assertQuoteReplayStoreHydrated(): void {
  if (!_hydrated) {
    throw new Error(
      '[quoteReplayStore] Store has not hydrated. Execution cannot proceed.',
    );
  }
}

// ── Core Operations ───────────────────────────────────────────────────────────

function getEntry(db: IDBDatabase, quoteId: string): Promise<QuoteEntry | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(quoteId);
    req.onsuccess = () => resolve(req.result as QuoteEntry | undefined);
    req.onerror = () => reject(new Error('[quoteReplayStore] get failed'));
  });
}

function putEntry(db: IDBDatabase, entry: QuoteEntry): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.put(entry);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(new Error('[quoteReplayStore] put failed'));
  });
}

function getAllEntries(db: IDBDatabase): Promise<QuoteEntry[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result as QuoteEntry[]);
    req.onerror = () => reject(new Error('[quoteReplayStore] getAll failed'));
  });
}

// ── Reservation ───────────────────────────────────────────────────────────────

export type ReserveResult =
  | { success: true }
  | { success: false; reason: 'ALREADY_RESERVED' | 'ALREADY_USED' | 'ALREADY_BROADCAST' | 'EXPIRED' };

/**
 * Reserve a quote atomically before wallet execution.
 * Returns failure if the quote is already in a non-AVAILABLE state.
 */
export async function reserveQuote(quoteId: string, expiresAt: number): Promise<ReserveResult> {
  assertQuoteReplayStoreHydrated();

  const db = await openDb();
  const now = Date.now();

  // Check expiry first
  if (expiresAt <= now + SECURITY_CONFIG.QUOTE_EXPIRY_BUFFER_MS) {
    return { success: false, reason: 'EXPIRED' };
  }

  const existing = await getEntry(db, quoteId);

  if (existing) {
    if (existing.state === 'USED') return { success: false, reason: 'ALREADY_USED' };
    if (existing.state === 'BROADCAST') return { success: false, reason: 'ALREADY_BROADCAST' };
    if (existing.state === 'RESERVED') return { success: false, reason: 'ALREADY_RESERVED' };
    // AVAILABLE: fall through to reserve
  }

  const entry: QuoteEntry = {
    quoteId,
    state: 'RESERVED',
    expiresAt,
    reservedAt: now,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  await putEntry(db, entry);
  return { success: true };
}

/**
 * Release a reservation (RESERVED → AVAILABLE).
 * Only valid before broadcast. BROADCAST state stays locked.
 */
export async function releaseReservation(quoteId: string): Promise<void> {
  assertQuoteReplayStoreHydrated();

  const db = await openDb();
  const existing = await getEntry(db, quoteId);

  if (!existing || existing.state !== 'RESERVED') {
    // Cannot release a non-reserved quote (including BROADCAST — stays locked)
    return;
  }

  const entry: QuoteEntry = {
    ...existing,
    state: 'AVAILABLE',
    reservedAt: undefined,
    updatedAt: Date.now(),
  };

  await putEntry(db, entry);
}

/** Mark a quote as broadcast (RESERVED → BROADCAST). */
export async function markQuoteBroadcast(quoteId: string): Promise<void> {
  assertQuoteReplayStoreHydrated();

  const db = await openDb();
  const existing = await getEntry(db, quoteId);

  if (!existing) {
    throw new Error(`[quoteReplayStore] Quote ${quoteId} not found — cannot mark broadcast.`);
  }
  if (existing.state === 'USED') {
    throw new Error(`[quoteReplayStore] Quote ${quoteId} is already USED.`);
  }

  const entry: QuoteEntry = {
    ...existing,
    state: 'BROADCAST',
    broadcastAt: Date.now(),
    updatedAt: Date.now(),
  };

  await putEntry(db, entry);
}

/** Mark a quote as used (BROADCAST → USED). */
export async function markQuoteUsed(quoteId: string): Promise<void> {
  assertQuoteReplayStoreHydrated();

  const db = await openDb();
  const existing = await getEntry(db, quoteId);

  if (!existing) {
    throw new Error(`[quoteReplayStore] Quote ${quoteId} not found — cannot mark used.`);
  }

  const entry: QuoteEntry = {
    ...existing,
    state: 'USED',
    usedAt: Date.now(),
    updatedAt: Date.now(),
  };

  await putEntry(db, entry);
}

// ── Replay Detection ──────────────────────────────────────────────────────────

export type ReplayCheckResult =
  | { replayed: false }
  | { replayed: true; state: QuoteState; reason: string };

/**
 * Check whether a quote has been replayed (already RESERVED, BROADCAST, or USED).
 */
export async function checkQuoteReplay(quoteId: string): Promise<ReplayCheckResult> {
  const db = await openDb();
  const existing = await getEntry(db, quoteId);

  if (!existing) return { replayed: false };

  if (existing.state === 'AVAILABLE') {
    // Was previously released — not a replay
    return { replayed: false };
  }

  return {
    replayed: true,
    state: existing.state,
    reason: `Quote ${quoteId} is already in state ${existing.state}.`,
  };
}

// ── Stale Reservation Reconciliation ─────────────────────────────────────────

/**
 * Release RESERVED entries that are older than QUOTE_RESERVATION_TIMEOUT_MS.
 * Called on hydration and can be called periodically.
 * BROADCAST entries are never auto-released.
 */
export async function reconcileStaleReservations(): Promise<number> {
  const db = await openDb();
  const all = await getAllEntries(db);
  const now = Date.now();
  let released = 0;

  for (const entry of all) {
    if (
      entry.state === 'RESERVED' &&
      entry.reservedAt !== undefined &&
      now - entry.reservedAt > SECURITY_CONFIG.QUOTE_RESERVATION_TIMEOUT_MS
    ) {
      const updated: QuoteEntry = {
        ...entry,
        state: 'AVAILABLE',
        reservedAt: undefined,
        updatedAt: now,
      };
      await putEntry(db, updated);
      released++;
    }
  }

  return released;
}

// ── Expiry Cleanup ────────────────────────────────────────────────────────────

/**
 * Remove USED and AVAILABLE entries older than QUOTE_REPLAY_RETENTION_MS.
 * BROADCAST entries are never pruned until reconciled to USED.
 */
export async function cleanupExpired(): Promise<number> {
  const db = await openDb();
  const all = await getAllEntries(db);
  const cutoff = Date.now() - SECURITY_CONFIG.QUOTE_REPLAY_RETENTION_MS;
  let pruned = 0;

  for (const entry of all) {
    if (
      (entry.state === 'USED' || entry.state === 'AVAILABLE') &&
      entry.updatedAt < cutoff
    ) {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.delete(entry.quoteId);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(new Error('[quoteReplayStore] delete failed'));
      });
      pruned++;
    }
  }

  return pruned;
}

// ── Testing Helpers ───────────────────────────────────────────────────────────

/** Reset store + hydration flag. For testing only. */
export async function resetQuoteReplayStore(): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(new Error('[quoteReplayStore] clear failed'));
  });
  _hydrated = false;
}

/** Force-set hydrated (for unit tests that bypass IndexedDB). */
export function forceHydratedForTesting(): void {
  _hydrated = true;
}

/** Force-reset hydrated flag. */
export function forceUnhydratedForTesting(): void {
  _hydrated = false;
}
