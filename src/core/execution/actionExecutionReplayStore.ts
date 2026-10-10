import { SECURITY_CONFIG } from '../../lib/securityConfig';

export type ActionExecutionReplayState =
  | 'RESERVED'
  | 'SUBMISSION_STARTED'
  | 'LOCKED';

export interface ActionExecutionReplayEntry {
  actionId: string;
  providerId: string;
  operation: string;
  state: ActionExecutionReplayState;
  reservedAt: number;
  submissionStartedAt?: number;
  lockedAt?: number;
  updatedAt: number;
}

export type ReserveActionExecutionResult =
  | { success: true }
  | {
      success: false;
      reason: 'ALREADY_RESERVED' | 'SUBMISSION_STARTED' | 'LOCKED';
    };

const DB_NAME = 'veyra-action-execution-replay';
const DB_VERSION = 1;
const STORE_NAME = 'executions';

let _db: IDBDatabase | null = null;
let _hydrated = false;

function openDb(): Promise<IDBDatabase> {
  if (_db) return Promise.resolve(_db);

  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'actionId' });
        store.createIndex('state', 'state', { unique: false });
      }
    };

    req.onsuccess = (event) => {
      _db = (event.target as IDBOpenDBRequest).result;
      resolve(_db);
    };
    req.onerror = (event) => {
      reject(
        new Error(
          `[actionExecutionReplay] Failed to open IndexedDB: ${(event.target as IDBOpenDBRequest).error?.message}`,
        ),
      );
    };
  });
}

export async function reconcileStaleActionReservations(): Promise<number> {
  const db = await openDb();
  const now = Date.now();
  let released = 0;

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();

    req.onerror = () =>
      reject(new Error('[actionExecutionReplay] reconciliation read failed'));

    req.onsuccess = () => {
      const entries = req.result as ActionExecutionReplayEntry[];
      for (const entry of entries) {
        if (
          entry.state === 'RESERVED' &&
          now - entry.reservedAt >
            SECURITY_CONFIG.ACTION_EXECUTION_RESERVATION_TIMEOUT_MS
        ) {
          store.delete(entry.actionId);
          released++;
        }
      }
    };

    tx.oncomplete = () => resolve();
    tx.onerror = () =>
      reject(
        new Error(
          `[actionExecutionReplay] reconciliation failed: ${tx.error?.message ?? 'unknown'}`,
        ),
      );
  });

  return released;
}

export async function hydrateActionExecutionReplayStore(): Promise<void> {
  await openDb();
  await reconcileStaleActionReservations();
  _hydrated = true;
}

export function isActionExecutionReplayStoreHydrated(): boolean {
  return _hydrated;
}

export function assertActionExecutionReplayStoreHydrated(): void {
  if (!_hydrated) {
    throw new Error(
      '[actionExecutionReplay] Store has not hydrated. Execution cannot proceed.',
    );
  }
}

export async function reserveActionExecution(input: {
  actionId: string;
  providerId: string;
  operation: string;
}): Promise<ReserveActionExecutionResult> {
  assertActionExecutionReplayStoreHydrated();

  const actionId = input.actionId.trim();
  const providerId = input.providerId.trim();
  const operation = input.operation.trim();
  if (!actionId || !providerId || !operation) {
    throw new Error(
      '[actionExecutionReplay] actionId, providerId and operation are required.',
    );
  }

  const db = await openDb();
  const now = Date.now();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const getReq = store.get(actionId);
    let result: ReserveActionExecutionResult | null = null;

    getReq.onerror = () =>
      reject(new Error('[actionExecutionReplay] reserve read failed'));

    getReq.onsuccess = () => {
      const existing = getReq.result as ActionExecutionReplayEntry | undefined;
      if (existing) {
        result = {
          success: false,
          reason:
            existing.state === 'RESERVED'
              ? 'ALREADY_RESERVED'
              : existing.state,
        };
        return;
      }

      const entry: ActionExecutionReplayEntry = {
        actionId,
        providerId,
        operation,
        state: 'RESERVED',
        reservedAt: now,
        updatedAt: now,
      };
      store.put(entry);
      result = { success: true };
    };

    tx.oncomplete = () => {
      if (result) resolve(result);
      else
        reject(
          new Error(
            '[actionExecutionReplay] reserve transaction completed without result',
          ),
        );
    };
    tx.onerror = () =>
      reject(
        new Error(
          `[actionExecutionReplay] reserve failed: ${tx.error?.message ?? 'unknown'}`,
        ),
      );
  });
}

export async function releaseActionExecutionReservation(
  actionId: string,
): Promise<void> {
  assertActionExecutionReplayStoreHydrated();
  const db = await openDb();

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(actionId);

    req.onerror = () =>
      reject(new Error('[actionExecutionReplay] release read failed'));
    req.onsuccess = () => {
      const existing = req.result as ActionExecutionReplayEntry | undefined;
      if (existing?.state === 'RESERVED') store.delete(actionId);
    };

    tx.oncomplete = () => resolve();
    tx.onerror = () =>
      reject(
        new Error(
          `[actionExecutionReplay] release failed: ${tx.error?.message ?? 'unknown'}`,
        ),
      );
  });
}

async function transition(
  actionId: string,
  expected: ActionExecutionReplayState,
  next: ActionExecutionReplayState,
): Promise<void> {
  assertActionExecutionReplayStoreHydrated();
  const db = await openDb();
  const now = Date.now();

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(actionId);

    req.onerror = () =>
      reject(new Error('[actionExecutionReplay] transition read failed'));

    req.onsuccess = () => {
      const existing = req.result as ActionExecutionReplayEntry | undefined;
      if (!existing) {
        reject(
          new Error(
            `[actionExecutionReplay] Action "${actionId}" is not reserved.`,
          ),
        );
        try {
          tx.abort();
        } catch {
          // already aborting
        }
        return;
      }
      if (existing.state !== expected) {
        reject(
          new Error(
            `[actionExecutionReplay] Action "${actionId}" must be ${expected}, got ${existing.state}.`,
          ),
        );
        try {
          tx.abort();
        } catch {
          // already aborting
        }
        return;
      }

      store.put({
        ...existing,
        state: next,
        ...(next === 'SUBMISSION_STARTED'
          ? { submissionStartedAt: now }
          : {}),
        ...(next === 'LOCKED' ? { lockedAt: now } : {}),
        updatedAt: now,
      } satisfies ActionExecutionReplayEntry);
    };

    tx.oncomplete = () => resolve();
    tx.onerror = () => {
      if (tx.error) {
        reject(
          new Error(
            `[actionExecutionReplay] transition failed: ${tx.error.message}`,
          ),
        );
      }
    };
    tx.onabort = () => {
      // Validation failures reject above with the useful message.
    };
  });
}

export function markActionExecutionSubmissionStarted(
  actionId: string,
): Promise<void> {
  return transition(actionId, 'RESERVED', 'SUBMISSION_STARTED');
}

export function lockActionExecution(actionId: string): Promise<void> {
  return transition(actionId, 'SUBMISSION_STARTED', 'LOCKED');
}

export async function getActionExecutionReplayEntry(
  actionId: string,
): Promise<ActionExecutionReplayEntry | null> {
  assertActionExecutionReplayStoreHydrated();
  const db = await openDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(actionId);
    req.onsuccess = () =>
      resolve((req.result as ActionExecutionReplayEntry | undefined) ?? null);
    req.onerror = () =>
      reject(new Error('[actionExecutionReplay] get failed'));
  });
}

/** Test-only helper. */
export async function resetActionExecutionReplayStore(): Promise<void> {
  _hydrated = false;

  // Clear the object store in-place instead of deleteDatabase().
  //
  // Resolving a blocked delete request leaves that delete pending in
  // fake-indexeddb (and can do the same in a real browser while another
  // connection is still closing). A subsequent indexedDB.open() then waits
  // behind the pending delete forever, which made later tests time out.
  //
  // Keeping one known connection and clearing the store gives tests the same
  // clean-state guarantee without creating a delete/open race.
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const req = tx.objectStore(STORE_NAME).clear();

    req.onerror = () =>
      reject(new Error('[actionExecutionReplay] reset clear failed'));
    tx.oncomplete = () => resolve();
    tx.onerror = () =>
      reject(
        new Error(
          `[actionExecutionReplay] reset failed: ${tx.error?.message ?? 'unknown'}`,
        ),
      );
    tx.onabort = () =>
      reject(
        new Error(
          `[actionExecutionReplay] reset aborted: ${tx.error?.message ?? 'unknown'}`,
        ),
      );
  });
}

/** Test-only helper. */
export function forceActionExecutionReplayHydratedForTesting(): void {
  _hydrated = true;
}

/** Test-only helper. */
export function forceActionExecutionReplayUnhydratedForTesting(): void {
  _hydrated = false;
}
