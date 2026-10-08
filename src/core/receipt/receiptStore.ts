/**
 * Veyra Receipt Store
 *
 * Persists VeyraReceipt records to IndexedDB (local cache only).
 * Chain/provider state is the execution source of truth.
 *
 * BigInt fields are serialised to string for IndexedDB compatibility.
 * Pending bridge receipts are discoverable after reload so verification can resume.
 */

import type { ReceiptStatus, VeyraReceipt } from './receiptTypes';

// ── Serialization ─────────────────────────────────────────────────────────────

type Stored = Omit<VeyraReceipt, 'actualAmountDelta' | 'expectedAmountDelta' | 'verifiedBalanceAfter'> & {
  actualAmountDeltaStr: string | null;
  expectedAmountDeltaStr: string | null;
  verifiedBalanceAfterStr?: string;
};

function toStored(r: VeyraReceipt): Stored {
  const { actualAmountDelta, expectedAmountDelta, verifiedBalanceAfter, ...rest } = r;
  return {
    ...rest,
    actualAmountDeltaStr: actualAmountDelta != null ? actualAmountDelta.toString() : null,
    expectedAmountDeltaStr: expectedAmountDelta != null ? expectedAmountDelta.toString() : null,
    verifiedBalanceAfterStr: verifiedBalanceAfter != null ? verifiedBalanceAfter.toString() : undefined,
  };
}

function fromStored(s: Stored): VeyraReceipt {
  const { actualAmountDeltaStr, expectedAmountDeltaStr, verifiedBalanceAfterStr, ...rest } = s;
  return {
    ...rest,
    actualAmountDelta: actualAmountDeltaStr != null ? BigInt(actualAmountDeltaStr) : null,
    expectedAmountDelta: expectedAmountDeltaStr != null ? BigInt(expectedAmountDeltaStr) : null,
    verifiedBalanceAfter: verifiedBalanceAfterStr != null ? BigInt(verifiedBalanceAfterStr) : undefined,
  };
}

// ── IndexedDB Setup ───────────────────────────────────────────────────────────

const DB_NAME    = 'veyra-receipts';
const DB_VERSION = 2;
const STORE_NAME = 'receipts';

let _db: IDBDatabase | null = null;

function openDb(): Promise<IDBDatabase> {
  if (_db) return Promise.resolve(_db);

  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'receiptId' });
        store.createIndex('status',    'status',    { unique: false });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }
    };

    req.onsuccess = (e) => { _db = (e.target as IDBOpenDBRequest).result; resolve(_db); };
    req.onerror   = (e) => reject(new Error(`[receiptStore] open: ${(e.target as IDBOpenDBRequest).error?.message}`));
  });
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

export async function saveReceipt(receipt: VeyraReceipt): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req   = store.put(toStored(receipt));
    req.onsuccess = () => resolve();
    req.onerror   = (e) => reject(new Error(`[receiptStore] save: ${(e.target as IDBRequest).error?.message}`));
  });
}

export async function getReceipt(receiptId: string): Promise<VeyraReceipt | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req   = store.get(receiptId);
    req.onsuccess = (e) => {
      const result = (e.target as IDBRequest<Stored | undefined>).result;
      resolve(result ? fromStored(result) : null);
    };
    req.onerror = (e) => reject(new Error(`[receiptStore] get: ${(e.target as IDBRequest).error?.message}`));
  });
}

export async function loadAllReceipts(): Promise<VeyraReceipt[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req   = store.getAll();
    req.onsuccess = (e) => {
      const rows = (e.target as IDBRequest<Stored[]>).result;
      resolve(rows.map(fromStored));
    };
    req.onerror = (e) => reject(new Error(`[receiptStore] loadAll: ${(e.target as IDBRequest).error?.message}`));
  });
}

export async function loadReceiptsByStatus(status: ReceiptStatus): Promise<VeyraReceipt[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const index = store.index('status');
    const req   = index.getAll(status);
    req.onsuccess = (e) => {
      const rows = (e.target as IDBRequest<Stored[]>).result;
      resolve(rows.map(fromStored));
    };
    req.onerror = (e) => reject(new Error(`[receiptStore] loadByStatus: ${(e.target as IDBRequest).error?.message}`));
  });
}

export async function deleteReceipt(receiptId: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req   = store.delete(receiptId);
    req.onsuccess = () => resolve();
    req.onerror   = (e) => reject(new Error(`[receiptStore] delete: ${(e.target as IDBRequest).error?.message}`));
  });
}
