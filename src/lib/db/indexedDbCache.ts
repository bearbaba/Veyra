/**
 * IndexedDB cache layer (Phase 1).
 *
 * Scope (per approved decisions):
 *   - Pending activity receipts (resumable execution state)
 *   - Identity snapshots (frozen at review time, needed for confirm-time re-verification)
 *   - Recent activity (last 50 receipts for display)
 *   - Profiles/contacts needed for UX (current user profile, recently viewed)
 *
 * NOT cached:
 *   - Full social graph (fetched from API on demand)
 *   - Full server database mirror
 *
 * IndexedDB is a LOCAL CACHE ONLY. The server (Postgres) is the source of truth.
 * Conflicts are resolved via revision-based reconciliation (see reconciliation.ts).
 */

const DB_NAME    = 'veyra-cache';
const DB_VERSION = 1;

// Store names
export const STORES = {
  RECEIPTS:   'receipts',
  SNAPSHOTS:  'identity_snapshots',
  PROFILES:   'profiles',
  ACTIVITY:   'recent_activity',
} as const;

type StoreName = typeof STORES[keyof typeof STORES];

// ── Types ───────────────────────────────────────────────────────────────────

export interface CachedReceipt {
  receiptId:        string;
  clientIntentId:   string;
  status:           string;
  revision:         number;
  environment:      string;
  senderAddress:    string;
  /**
   * True once the BFF has acknowledged and persisted this receipt on the server.
   * False for local drafts and in-progress executions not yet server-confirmed.
   * Controls reconciliation authority: false = PENDING_LOCAL_MUTATION,
   * true = SERVER_AUTHORITATIVE.
   */
  bffAcknowledged?: boolean;
  // Bridge state (nullable)
  burnTxHash?:      string;
  messageHash?:     string;
  messageBytes?:    string;
  attestationNonce?: string;
  receiveTxHash?:   string;
  // Resume payload: the minimal data needed to resume a failed/pending transfer
  resumePayload?:   Record<string, unknown>;
  updatedAt:        number;  // unix ms
  cachedAt:         number;  // unix ms — for TTL eviction
}

export interface CachedSnapshot {
  snapshotId:       string;
  veyraUserId:      string;
  veyraHandle:      string;
  displayName:      string;
  avatarUrl?:       string;
  identityRevision: number;
  resolvedWallets:  unknown[];
  receivePreference: unknown;
  frozenAt:         string;
  expiresAt:        string;
  verifiedAt?:      string;
  invalidatedAt?:   string;
  cachedAt:         number;
}

export interface CachedProfile {
  veyraUserId:    string;
  veyraHandle:    string;
  displayName:    string;
  avatarUrl?:     string;
  bio?:           string;
  cachedAt:       number;
}

// ── DB open ─────────────────────────────────────────────────────────────────

let _db: IDBDatabase | null = null;

export function openCache(): Promise<IDBDatabase> {
  if (_db) return Promise.resolve(_db);

  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;

      // receipts — keyed by receiptId; indexed by status and environment
      if (!db.objectStoreNames.contains(STORES.RECEIPTS)) {
        const receipts = db.createObjectStore(STORES.RECEIPTS, { keyPath: 'receiptId' });
        receipts.createIndex('by_status',      'status',      { unique: false });
        receipts.createIndex('by_environment', 'environment', { unique: false });
        receipts.createIndex('by_updatedAt',   'updatedAt',   { unique: false });
      }

      // identity_snapshots — keyed by snapshotId; indexed by veyraUserId
      if (!db.objectStoreNames.contains(STORES.SNAPSHOTS)) {
        const snaps = db.createObjectStore(STORES.SNAPSHOTS, { keyPath: 'snapshotId' });
        snaps.createIndex('by_user', 'veyraUserId', { unique: false });
      }

      // profiles — keyed by veyraUserId
      if (!db.objectStoreNames.contains(STORES.PROFILES)) {
        db.createObjectStore(STORES.PROFILES, { keyPath: 'veyraUserId' });
      }

      // recent_activity — keyed by receiptId; max 50 entries (eviction on write)
      if (!db.objectStoreNames.contains(STORES.ACTIVITY)) {
        const activity = db.createObjectStore(STORES.ACTIVITY, { keyPath: 'receiptId' });
        activity.createIndex('by_cachedAt', 'cachedAt', { unique: false });
      }
    };

    req.onsuccess = (e) => {
      _db = (e.target as IDBOpenDBRequest).result;
      resolve(_db);
    };

    req.onerror = (e) => {
      const raw = (e.target as IDBOpenDBRequest).error;
      reject(raw instanceof Error ? raw : new Error(String(raw)));
    };
  });
}

// ── Generic helpers ──────────────────────────────────────────────────────────

function idbError(req: IDBRequest): Error {
  const e = req.error;
  return e instanceof Error ? e : new Error(String(e));
}

function idbPut<T>(db: IDBDatabase, store: StoreName, value: T): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(store, 'readwrite');
    const req = tx.objectStore(store).put(value);
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(idbError(req));
  });
}

function idbGet<T>(db: IDBDatabase, store: StoreName, key: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror   = () => reject(idbError(req));
  });
}

function idbDelete(db: IDBDatabase, store: StoreName, key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(store, 'readwrite');
    const req = tx.objectStore(store).delete(key);
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(idbError(req));
  });
}

function idbGetAll<T>(db: IDBDatabase, store: StoreName): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror   = () => reject(idbError(req));
  });
}

// ── Receipt cache ────────────────────────────────────────────────────────────

export async function cacheReceipt(receipt: CachedReceipt): Promise<void> {
  const db = await openCache();
  await idbPut(db, STORES.RECEIPTS, { ...receipt, cachedAt: Date.now() });
}

export async function getCachedReceipt(receiptId: string): Promise<CachedReceipt | undefined> {
  const db = await openCache();
  return idbGet(db, STORES.RECEIPTS, receiptId);
}

export async function getAllCachedReceipts(): Promise<CachedReceipt[]> {
  const db = await openCache();
  return idbGetAll(db, STORES.RECEIPTS);
}

export async function deleteCachedReceipt(receiptId: string): Promise<void> {
  const db = await openCache();
  await idbDelete(db, STORES.RECEIPTS, receiptId);
}

// ── Snapshot cache ───────────────────────────────────────────────────────────

export async function cacheSnapshot(snapshot: CachedSnapshot): Promise<void> {
  const db = await openCache();
  await idbPut(db, STORES.SNAPSHOTS, { ...snapshot, cachedAt: Date.now() });
}

export async function getCachedSnapshot(snapshotId: string): Promise<CachedSnapshot | undefined> {
  const db = await openCache();
  return idbGet(db, STORES.SNAPSHOTS, snapshotId);
}

// ── Profile cache ────────────────────────────────────────────────────────────

export async function cacheProfile(profile: CachedProfile): Promise<void> {
  const db = await openCache();
  await idbPut(db, STORES.PROFILES, { ...profile, cachedAt: Date.now() });
}

export async function getCachedProfile(veyraUserId: string): Promise<CachedProfile | undefined> {
  const db = await openCache();
  return idbGet(db, STORES.PROFILES, veyraUserId);
}

// ── Recent activity cache (max 50) ──────────────────────────────────────────

const ACTIVITY_MAX = 50;

export async function cacheActivity(receipt: CachedReceipt): Promise<void> {
  const db = await openCache();
  await idbPut(db, STORES.ACTIVITY, { ...receipt, cachedAt: Date.now() });

  // Evict oldest entries if over limit.
  const all = await idbGetAll<CachedReceipt>(db, STORES.ACTIVITY);
  if (all.length > ACTIVITY_MAX) {
    const sorted = all.sort((a, b) => a.cachedAt - b.cachedAt);
    const toDelete = sorted.slice(0, all.length - ACTIVITY_MAX);
    for (const item of toDelete) {
      await idbDelete(db, STORES.ACTIVITY, item.receiptId);
    }
  }
}

export async function getRecentActivity(): Promise<CachedReceipt[]> {
  const db = await openCache();
  const all = await idbGetAll<CachedReceipt>(db, STORES.ACTIVITY);
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}
