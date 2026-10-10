/**
 * Persistent CCTP bridge recovery checkpoint.
 *
 * Once a source burn has been submitted, recovery must continue from that burn.
 * A checkpoint can NEVER instruct the caller to burn again.
 */

export type BridgeCheckpointStage =
  | 'SOURCE_BROADCAST'
  | 'SOURCE_CONFIRMED'
  | 'ATTESTATION_READY'
  | 'DESTINATION_BROADCAST'
  | 'VERIFIED';

export interface BridgeRecoveryCheckpoint {
  planId: string;
  stage: BridgeCheckpointStage;
  burnTxHash: string;
  sourceChainId: number;
  destinationChainId: number;
  walletAddress: string;
  recipientAddress: string;
  amount: string;
  tokenAddress: string;
  balanceBefore: string;
  attestationMessage?: string;
  attestationSignature?: string;
  receiveTxHash?: string;
  createdAt: number;
  updatedAt: number;
}

export type BridgeResumeInstruction =
  | 'POLL_ATTESTATION'
  | 'SUBMIT_RECEIVE'
  | 'VERIFY_DESTINATION'
  | 'NONE';

const BRIDGE_STAGE_ORDER: Record<BridgeCheckpointStage, number> = {
  SOURCE_BROADCAST: 0,
  SOURCE_CONFIRMED: 1,
  ATTESTATION_READY: 2,
  DESTINATION_BROADCAST: 3,
  VERIFIED: 4,
};

const DB_NAME = 'veyra-bridge-recovery';
const DB_VERSION = 1;
const STORE_NAME = 'checkpoints';

let _db: IDBDatabase | null = null;

function openDb(): Promise<IDBDatabase> {
  if (_db) return Promise.resolve(_db);

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'planId' });
        store.createIndex('stage', 'stage', { unique: false });
        store.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
    };

    request.onsuccess = (event) => {
      _db = (event.target as IDBOpenDBRequest).result;
      resolve(_db);
    };
    request.onerror = (event) => {
      reject(new Error(
        `[bridgeCheckpointStore] open failed: ${(event.target as IDBOpenDBRequest).error?.message ?? 'unknown'}`,
      ));
    };
  });
}

export async function saveBridgeCheckpoint(
  checkpoint: BridgeRecoveryCheckpoint,
): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const request = tx.objectStore(STORE_NAME).put(checkpoint);
    request.onerror = () => reject(new Error('[bridgeCheckpointStore] save failed'));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(new Error(
      `[bridgeCheckpointStore] save transaction failed: ${tx.error?.message ?? 'unknown'}`,
    ));
  });
}

export async function getBridgeCheckpoint(
  planId: string,
): Promise<BridgeRecoveryCheckpoint | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).get(planId);
    request.onsuccess = () => resolve(
      (request.result as BridgeRecoveryCheckpoint | undefined) ?? null,
    );
    request.onerror = () => reject(new Error('[bridgeCheckpointStore] get failed'));
  });
}

export async function loadResumableBridgeCheckpoints(): Promise<BridgeRecoveryCheckpoint[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).getAll();
    request.onsuccess = () => {
      const rows = (request.result as BridgeRecoveryCheckpoint[])
        .filter((row) => row.stage !== 'VERIFIED')
        .sort((a, b) => b.updatedAt - a.updatedAt);
      resolve(rows);
    };
    request.onerror = () => reject(new Error('[bridgeCheckpointStore] load resumable failed'));
  });
}

/**
 * Deterministic resume decision. Intentionally has no REBURN outcome.
 */
export function nextBridgeResumeInstruction(
  checkpoint: BridgeRecoveryCheckpoint,
): BridgeResumeInstruction {
  switch (checkpoint.stage) {
    case 'SOURCE_BROADCAST':
    case 'SOURCE_CONFIRMED':
      return 'POLL_ATTESTATION';
    case 'ATTESTATION_READY':
      return 'SUBMIT_RECEIVE';
    case 'DESTINATION_BROADCAST':
      return 'VERIFY_DESTINATION';
    case 'VERIFIED':
      return 'NONE';
  }
}

function sameAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function sameImmutableBridgeExecution(
  a: BridgeRecoveryCheckpoint,
  b: BridgeRecoveryCheckpoint,
): boolean {
  return (
    a.planId === b.planId &&
    a.burnTxHash.toLowerCase() === b.burnTxHash.toLowerCase() &&
    a.sourceChainId === b.sourceChainId &&
    a.destinationChainId === b.destinationChainId &&
    sameAddress(a.walletAddress, b.walletAddress) &&
    sameAddress(a.recipientAddress, b.recipientAddress) &&
    a.amount === b.amount &&
    sameAddress(a.tokenAddress, b.tokenAddress) &&
    a.balanceBefore === b.balanceBefore &&
    a.createdAt === b.createdAt
  );
}

/**
 * Merge local IndexedDB recovery state with the authenticated Postgres mirror.
 *
 * Conflicting remote rows never overwrite local immutable source execution.
 * A remote-only checkpoint may be imported for cross-device recovery, but the
 * resume path MUST still re-verify chain/provider state before any signature.
 */
export function reconcileBridgeRecoveryCandidates(
  local: BridgeRecoveryCheckpoint[],
  remote: BridgeRecoveryCheckpoint[],
): BridgeRecoveryCheckpoint[] {
  const merged = new Map<string, BridgeRecoveryCheckpoint>();

  for (const checkpoint of local) {
    merged.set(checkpoint.planId, checkpoint);
  }

  for (const checkpoint of remote) {
    const existing = merged.get(checkpoint.planId);
    if (!existing) {
      merged.set(checkpoint.planId, checkpoint);
      continue;
    }

    if (!sameImmutableBridgeExecution(existing, checkpoint)) {
      // Local source execution wins on immutable conflict; caller may surface
      // telemetry separately but must never silently replace the burn.
      continue;
    }

    const existingRank = BRIDGE_STAGE_ORDER[existing.stage];
    const remoteRank = BRIDGE_STAGE_ORDER[checkpoint.stage];

    if (
      remoteRank > existingRank ||
      (remoteRank === existingRank && checkpoint.updatedAt > existing.updatedAt)
    ) {
      merged.set(checkpoint.planId, checkpoint);
    }
  }

  return Array.from(merged.values())
    .filter((checkpoint) => checkpoint.stage !== 'VERIFIED')
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function resetBridgeCheckpointStoreForTesting(): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const request = tx.objectStore(STORE_NAME).clear();
    request.onerror = () => reject(new Error('[bridgeCheckpointStore] reset failed'));
    tx.oncomplete = () => resolve();
  });
}
