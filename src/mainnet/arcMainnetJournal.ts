/** Account+chain-scoped conservative browser recovery state. Never trust it as onchain proof. */
import { buildMainnetPayPlan } from './arcMainnetPay.js';

export type MainnetStage = 'AWAITING_WALLET' | 'UNKNOWN' | 'PENDING' | 'VERIFIED' | 'REVERTED';
export type MainnetJournal = {
  from: string; to: string; amount: string; stage: MainnetStage; hash: string | null;
  /** Optional non-authoritative browser-only context. Never used to approve a transaction. */
  note?:string; recipientLabel?:string; recipientSnapshotId?:string; senderUserId?:string;
};
export type JournalRead =
  | { kind: 'empty' } | { kind: 'blocked' } | { kind: 'active'; value: MainnetJournal };
type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const HASH = /^0x[0-9a-fA-F]{64}$/;
const UNAVAILABLE: StorageLike = {
  getItem: () => { throw new Error('Browser storage blocked'); },
  setItem: () => { throw new Error('Browser storage blocked'); },
  removeItem: () => { throw new Error('Browser storage blocked'); },
};
export function storageForMainnet(): StorageLike {
  try { return window.localStorage; } catch { return UNAVAILABLE; }
}
export function mainnetJournalKey(from: string): string {
  return `veyra:arc-mainnet-5042-payment:v1:${from.toLowerCase()}`;
}
export function readMainnetJournal(from: string, storage: Pick<StorageLike, 'getItem'>): JournalRead {
  try {
    const raw = storage.getItem(mainnetJournalKey(from));
    if (raw === null) return { kind: 'empty' };
    if (raw.length === 0 || raw.length > 4096) return { kind: 'blocked' };
    const input: unknown = JSON.parse(raw);
    if (!input || typeof input !== 'object' || Array.isArray(input)) return { kind: 'blocked' };
    const value = input as Partial<MainnetJournal>;
    if (typeof value.from !== 'string' || value.from.toLowerCase() !== from.toLowerCase() ||
      typeof value.to !== 'string' || typeof value.amount !== 'string' ||
      !['AWAITING_WALLET','UNKNOWN','PENDING','VERIFIED','REVERTED'].includes(value.stage ?? '') ||
      !(value.hash === null || typeof value.hash === 'string' && HASH.test(value.hash)) ||
      (value.note!==undefined && (typeof value.note!=='string'||value.note.length>120)) ||
      (value.recipientLabel!==undefined && (typeof value.recipientLabel!=='string'||value.recipientLabel.length>50)) ||
      (value.senderUserId!==undefined&&(typeof value.senderUserId!=='string'||
        !/^usr_[1-9A-HJ-NP-Za-km-z]{10,}$/.test(value.senderUserId))) ||
      (value.recipientSnapshotId!==undefined&&(typeof value.recipientSnapshotId!=='string'||
        !/^snp_[1-9A-HJ-NP-Za-km-z]{10,}$/.test(value.recipientSnapshotId))))
      return { kind: 'blocked' };
    buildMainnetPayPlan(from, value.to, value.amount);
    if ((value.stage === 'PENDING' || value.stage === 'VERIFIED' || value.stage === 'REVERTED') && !value.hash) {
      return { kind: 'blocked' };
    }
    if ((value.stage === 'AWAITING_WALLET' || value.stage === 'UNKNOWN') && value.hash !== null) return { kind: 'blocked' };
    // Terminal state is always rechecked with the public RPC after reload.
    return { kind: 'active', value: { from, to: value.to, amount: value.amount,
      stage: value.stage === 'VERIFIED' || value.stage === 'REVERTED' ? 'PENDING' : value.stage as MainnetStage,
      hash: value.hash, note:value.note, recipientLabel:value.recipientLabel,
      recipientSnapshotId:value.recipientSnapshotId,senderUserId:value.senderUserId } };
  } catch {
    return { kind: 'blocked' };
  }
}
export function writeMainnetJournal(value: MainnetJournal, storage: StorageLike): boolean {
  try {
    const serialized = JSON.stringify(value);
    storage.setItem(mainnetJournalKey(value.from), serialized);
    const saved=storage.getItem(mainnetJournalKey(value.from)) === serialized;
    if(saved)try{window.dispatchEvent?.(new Event('veyra:mainnet:journal'));}catch{/* saved */}
    return saved;
  } catch { return false; }
}
export function clearMainnetJournal(from: string, storage: StorageLike): boolean {
  try {
    storage.removeItem(mainnetJournalKey(from));
    const cleared=storage.getItem(mainnetJournalKey(from)) === null;
    if(cleared)try{window.dispatchEvent?.(new Event('veyra:mainnet:journal'));}catch{/* cleared */}
    return cleared;
  } catch { return false; }
}
