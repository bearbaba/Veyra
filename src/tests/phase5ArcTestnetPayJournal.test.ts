import { describe, expect, it } from 'vitest';
import { arcPayJournalKey, clearArcPayJournal, loadArcPayJournal, storeArcPayJournal, type ArcPayJournal } from '../preview/arcPayJournal';

const FROM = '0x1111111111111111111111111111111111111111';
const TO = '0x2222222222222222222222222222222222222222';
const HASH = `0x${'a'.repeat(64)}`;
const pending: ArcPayJournal = { from: FROM, to: TO, amount: '0.25', stage: 'PENDING', hash: HASH };

function storage() {
  const memory = new Map<string, string>();
  return {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => { memory.set(key, value); },
    removeItem: (key: string) => { memory.delete(key); },
  };
}

describe('Arc Testnet Pay browser recovery must fail closed', () => {
  it('loads empty or validated records, never trusts persisted terminal finality', () => {
    const db = storage();
    expect(loadArcPayJournal(FROM, db)).toEqual({ kind: 'empty' });
    expect(storeArcPayJournal(pending, db)).toBe(true);
    expect(loadArcPayJournal(FROM, db)).toEqual({ kind: 'active', journal: pending });
    for (const stage of ['VERIFIED', 'REVERTED'] as const) {
      storeArcPayJournal({ ...pending, stage }, db);
      expect(loadArcPayJournal(FROM, db)).toEqual({ kind: 'active', journal: pending });
    }
    expect(clearArcPayJournal(FROM, db)).toBe(true);
    expect(loadArcPayJournal(FROM, db)).toEqual({ kind: 'empty' });
  });

  it('refuses corrupted, cross-wallet, contradictory, and truncated records', () => {
    const db = storage();
    const variants: unknown[] = [
      '', 'not json', 'null', '{}', '[]',
      { ...pending, from: TO },
      { ...pending, amount: '1.000001' },
      { ...pending, stage: 'COMPLETE' },
      { ...pending, stage: 'PENDING', hash: null },
      { ...pending, stage: 'VERIFIED', hash: null },
      { ...pending, stage: 'REVERTED', hash: null },
      { ...pending, stage: 'UNKNOWN', hash: HASH },
      { ...pending, stage: 'AWAITING_WALLET', hash: HASH },
      { ...pending, hash: '0x123' },
      { ...pending, to: 'not-an-address' },
    ];
    for (const item of variants) {
      db.setItem(arcPayJournalKey(FROM), typeof item === 'string' ? item : JSON.stringify(item));
      expect(loadArcPayJournal(FROM, db)).toEqual({ kind: 'blocked' });
    }
  });

  it('records unknown wallet submission conservatively and never clears on storage failure', () => {
    const db = storage();
    const unknown: ArcPayJournal = { ...pending, stage: 'UNKNOWN', hash: null };
    expect(storeArcPayJournal(unknown, db)).toBe(true);
    expect(loadArcPayJournal(FROM, db)).toEqual({ kind: 'active', journal: unknown });
    const broken = {
      getItem: (_key: string): string | null => { throw new Error('storage unavailable'); },
      setItem: (_key: string, _value: string): void => { throw new Error('storage unavailable'); },
      removeItem: (_key: string): void => { throw new Error('storage unavailable'); },
    };
    expect(loadArcPayJournal(FROM, broken)).toEqual({ kind: 'blocked' });
    expect(storeArcPayJournal(unknown, broken)).toBe(false);
    expect(clearArcPayJournal(FROM, broken)).toBe(false);
  });
});
