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

export async function resetBridgeCheckpointStoreForTesting(): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const request = tx.objectStore(STORE_NAME).clear();
    request.onerror = () => reject(new Error('[bridgeCheckpointStore] reset failed'));
    tx.oncomplete = () => resolve();
  });
}
