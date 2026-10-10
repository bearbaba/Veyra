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

  if (expiresAt <= now + SECURITY_CONFIG.QUOTE_EXPIRY_BUFFER_MS) {
    return { success: false, reason: 'EXPIRED' };
  }

  // IMPORTANT: get + decision + put live in one readwrite transaction.
  // This makes reservation atomic across concurrent tabs/callers. Performing
  // get() and put() in separate transactions would allow two callers to both
  // observe AVAILABLE and double-reserve the same provider quote.
  return new Promise<ReserveResult>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const getReq = store.get(quoteId);

    let result: ReserveResult | null = null;

    getReq.onerror = () => {
      reject(new Error('[quoteReplayStore] reserve get failed'));
    };

    getReq.onsuccess = () => {
      const existing = getReq.result as QuoteEntry | undefined;

      if (existing?.state === 'USED') {
        result = { success: false, reason: 'ALREADY_USED' };
        return;
      }
      if (existing?.state === 'BROADCAST') {
        result = { success: false, reason: 'ALREADY_BROADCAST' };
        return;
      }
      if (existing?.state === 'RESERVED') {
        result = { success: false, reason: 'ALREADY_RESERVED' };
        return;
      }

      const entry: QuoteEntry = {
        quoteId,
        state: 'RESERVED',
        expiresAt,
        reservedAt: now,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };

      const putReq = store.put(entry);
      putReq.onerror = () => {
        reject(new Error('[quoteReplayStore] reserve put failed'));
      };
      putReq.onsuccess = () => {
        result = { success: true };
      };
    };

    tx.oncomplete = () => {
      if (result) resolve(result);
      else reject(new Error('[quoteReplayStore] reserve transaction completed without result'));
    };
    tx.onerror = () => {
      reject(new Error(`[quoteReplayStore] reserve transaction failed: ${tx.error?.message ?? 'unknown'}`));
    };
    tx.onabort = () => {
      reject(new Error(`[quoteReplayStore] reserve transaction aborted: ${tx.error?.message ?? 'unknown'}`));
    };
  });
}

/**
 * Release a reservation (RESERVED → AVAILABLE).
 * Only valid before broadcast. BROADCAST state stays locked.
 */
export async function releaseReservation(quoteId: string): Promise<void> {
  assertQuoteReplayStoreHydrated();

  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const getReq = store.get(quoteId);

    getReq.onerror = () => reject(new Error('[quoteReplayStore] release get failed'));
    getReq.onsuccess = () => {
      const existing = getReq.result as QuoteEntry | undefined;

      // Missing or already advanced entries are intentionally a no-op. Most
      // importantly, BROADCAST/USED can never be rolled back to AVAILABLE.
      if (!existing || existing.state !== 'RESERVED') return;

      store.put({
        ...existing,
        state: 'AVAILABLE',
        reservedAt: undefined,
        updatedAt: Date.now(),
      } satisfies QuoteEntry);
    };

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(new Error(
      `[quoteReplayStore] release transaction failed: ${tx.error?.message ?? 'unknown'}`,
    ));
  });
}

/** Mark a quote as broadcast (RESERVED → BROADCAST). */
export async function markQuoteBroadcast(quoteId: string): Promise<void> {
  assertQuoteReplayStoreHydrated();

  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const getReq = store.get(quoteId);

    getReq.onerror = () => reject(new Error('[quoteReplayStore] broadcast get failed'));
    getReq.onsuccess = () => {
      const existing = getReq.result as QuoteEntry | undefined;
      if (!existing) {
        tx.abort();
        reject(new Error(`[quoteReplayStore] Quote ${quoteId} not found — cannot mark broadcast.`));
        return;
      }
      if (existing.state !== 'RESERVED') {
        tx.abort();
        reject(new Error(
          `[quoteReplayStore] Quote ${quoteId} must be RESERVED before BROADCAST; current state is ${existing.state}.`,
        ));
        return;
      }

      store.put({
        ...existing,
        state: 'BROADCAST',
        broadcastAt: Date.now(),
        updatedAt: Date.now(),
      } satisfies QuoteEntry);
    };

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(new Error(
      `[quoteReplayStore] broadcast transaction failed: ${tx.error?.message ?? 'unknown'}`,
    ));
  });
}

/** Mark a quote as used (BROADCAST → USED). */
export async function markQuoteUsed(quoteId: string): Promise<void> {
  assertQuoteReplayStoreHydrated();

  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const getReq = store.get(quoteId);

    getReq.onerror = () => reject(new Error('[quoteReplayStore] used get failed'));
    getReq.onsuccess = () => {
      const existing = getReq.result as QuoteEntry | undefined;
      if (!existing) {
        tx.abort();
        reject(new Error(`[quoteReplayStore] Quote ${quoteId} not found — cannot mark used.`));
        return;
      }
      if (existing.state !== 'BROADCAST') {
        tx.abort();
        reject(new Error(
          `[quoteReplayStore] Quote ${quoteId} must be BROADCAST before USED; current state is ${existing.state}.`,
        ));
        return;
      }

      store.put({
        ...existing,
        state: 'USED',
        usedAt: Date.now(),
        updatedAt: Date.now(),
      } satisfies QuoteEntry);
    };

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(new Error(
      `[quoteReplayStore] used transaction failed: ${tx.error?.message ?? 'unknown'}`,
    ));
  });
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

  for (const snapshot of all) {
    if (
      snapshot.state !== 'RESERVED' ||
      snapshot.reservedAt === undefined ||
      now - snapshot.reservedAt <= SECURITY_CONFIG.QUOTE_RESERVATION_TIMEOUT_MS
    ) {
      continue;
    }

    // Re-read inside a write transaction so startup reconciliation can never
    // overwrite a quote that another tab advanced to BROADCAST/USED after the
    // initial snapshot was read.
    const didRelease = await new Promise<boolean>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const getReq = store.get(snapshot.quoteId);
      let changed = false;

      getReq.onerror = () => reject(new Error('[quoteReplayStore] reconcile get failed'));
      getReq.onsuccess = () => {
        const current = getReq.result as QuoteEntry | undefined;
        if (
          !current ||
          current.state !== 'RESERVED' ||
          current.reservedAt === undefined ||
          now - current.reservedAt <= SECURITY_CONFIG.QUOTE_RESERVATION_TIMEOUT_MS
        ) {
          return;
        }

        store.put({
          ...current,
          state: 'AVAILABLE',
          reservedAt: undefined,
          updatedAt: now,
        } satisfies QuoteEntry);
        changed = true;
      };

      tx.oncomplete = () => resolve(changed);
      tx.onerror = () => reject(new Error(
        `[quoteReplayStore] reconcile transaction failed: ${tx.error?.message ?? 'unknown'}`,
      ));
    });

    if (didRelease) released++;
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

  for (const snapshot of all) {
    if (
      (snapshot.state !== 'USED' && snapshot.state !== 'AVAILABLE') ||
      snapshot.updatedAt >= cutoff
    ) {
      continue;
    }

    const didDelete = await new Promise<boolean>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const getReq = store.get(snapshot.quoteId);
      let deleted = false;

      getReq.onerror = () => reject(new Error('[quoteReplayStore] cleanup get failed'));
      getReq.onsuccess = () => {
        const current = getReq.result as QuoteEntry | undefined;
        if (
          !current ||
          (current.state !== 'USED' && current.state !== 'AVAILABLE') ||
          current.updatedAt >= cutoff
        ) {
          return;
        }

        store.delete(current.quoteId);
        deleted = true;
      };

      tx.oncomplete = () => resolve(deleted);
      tx.onerror = () => reject(new Error(
        `[quoteReplayStore] cleanup transaction failed: ${tx.error?.message ?? 'unknown'}`,
      ));
    });

    if (didDelete) pruned++;
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
