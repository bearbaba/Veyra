/**
 * Durable, account-scoped recovery lock for the one-signature Arc Testnet beta.
 *
 * A malformed or unreadable persisted record is NOT equivalent to "no previous
 * payment". Never unlock another signature if recovery state is uncertain.
 */
import { createArcTestnetPayPlan } from './arcTestnetPay';

export type ArcPayJournalStage = 'AWAITING_WALLET' | 'UNKNOWN' | 'PENDING' | 'VERIFIED' | 'REVERTED';

export interface ArcPayJournal {
  from: string;
  to: string;
  amount: string;
  stage: ArcPayJournalStage;
  hash: string | null;
}

export type ArcPayJournalLoad =
  | { kind: 'empty' }
  | { kind: 'active'; journal: ArcPayJournal }
  | { kind: 'blocked' };

type JournalStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const HASH_RE = /^0x[0-9a-fA-F]{64}$/;
const STAGES = ['AWAITING_WALLET', 'UNKNOWN', 'PENDING', 'VERIFIED', 'REVERTED'];

export function arcPayJournalKey(account: string): string {
  return `veyra:arc-testnet-payment:v1:${account.toLowerCase()}`;
}

export function loadArcPayJournal(
  account: string, storage: Pick<JournalStorage, 'getItem'>,
): ArcPayJournalLoad {
  try {
    const raw = storage.getItem(arcPayJournalKey(account));
    if (raw === null) return { kind: 'empty' };
    if (raw.length === 0 || raw.length > 4096) return { kind: 'blocked' };
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { kind: 'blocked' };
    const x = value as Partial<ArcPayJournal>;
    if (typeof x.from !== 'string' || x.from.toLowerCase() !== account.toLowerCase() ||
      typeof x.to !== 'string' || typeof x.amount !== 'string' ||
      typeof x.stage !== 'string' || !STAGES.includes(x.stage)) return { kind: 'blocked' };
    // An unknown submission has NO known hash. A terminal or indexed state
    // MUST have a complete hash; otherwise recovery cannot be authenticated.
    const hasHash = typeof x.hash === 'string' && HASH_RE.test(x.hash);
    if ((x.stage === 'AWAITING_WALLET' || x.stage === 'UNKNOWN')
      ? x.hash !== null : !hasHash) return { kind: 'blocked' };
    createArcTestnetPayPlan(account, x.to, x.amount);
    // Previous terminal statuses are never proof on their own. Recheck the
    // original hash against canonical chain evidence after every reload.
    return { kind: 'active', journal: {
      from: account, to: x.to, amount: x.amount,
      stage: x.stage === 'VERIFIED' || x.stage === 'REVERTED' ? 'PENDING' : x.stage,
      hash: x.hash ?? null,
    } };
  } catch {
    return { kind: 'blocked' };
  }
}

export function storeArcPayJournal(journal: ArcPayJournal, storage: JournalStorage): boolean {
  try {
    const serialized = JSON.stringify(journal);
    storage.setItem(arcPayJournalKey(journal.from), serialized);
    return storage.getItem(arcPayJournalKey(journal.from)) === serialized;
  } catch { return false; }
}

export function clearArcPayJournal(account: string, storage: JournalStorage): boolean {
  try {
    storage.removeItem(arcPayJournalKey(account));
    return storage.getItem(arcPayJournalKey(account)) === null;
  } catch { return false; }
}
