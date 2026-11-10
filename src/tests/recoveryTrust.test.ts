import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { hasVerificationProof, withTrustedStatus, type StoredExchangeRecord } from '../mainnet/recoveryTrust';

const H = (n: string) => `0x${n.repeat(32).slice(0, 64)}`;
const rec = (over: Partial<StoredExchangeRecord>): StoredExchangeRecord => ({ mode: 'bridge', status: 'VERIFIED', ...over });

describe('stored VERIFIED records need their proof', () => {
  it('a bridge needs both the burn and the mint hash', () => {
    expect(hasVerificationProof(rec({ burnHash: H('ab'), mintHash: H('cd') }))).toBe(true);
    expect(hasVerificationProof(rec({ burnHash: H('ab') }))).toBe(false);
    expect(hasVerificationProof(rec({ mintHash: H('cd') }))).toBe(false);
    expect(hasVerificationProof(rec({}))).toBe(false);
  });

  it('a swap needs its transaction hash', () => {
    expect(hasVerificationProof(rec({ mode: 'swap', hash: H('ab') }))).toBe(true);
    expect(hasVerificationProof(rec({ mode: 'swap' }))).toBe(false);
  });

  it('an unproven VERIFIED record becomes PENDING (still locked, still rechecks onchain)', () => {
    expect(withTrustedStatus(rec({})).status).toBe('PENDING');
    expect(withTrustedStatus(rec({ mode: 'swap' })).status).toBe('PENDING');
    expect(withTrustedStatus(rec({ burnHash: H('ab') })).status).toBe('PENDING');
  });

  it('a proven VERIFIED record is left alone', () => {
    const proven = rec({ burnHash: H('ab'), mintHash: H('cd') });
    expect(withTrustedStatus(proven)).toBe(proven);
  });

  it('keeps every hash and records that it was saved as verified (evidence is never discarded)', () => {
    const downgraded = withTrustedStatus({ ...rec({ burnHash: H('ab') }), amount: '5' });
    expect(downgraded).toMatchObject({ status: 'PENDING', downgradedFrom: 'VERIFIED', burnHash: H('ab'), amount: '5' });
  });

  it('a missing local proof is "unresolved", never "failed"', () => {
    for (const r of [rec({}), rec({ mode: 'swap' }), rec({ burnHash: H('ab') })]) {
      expect(withTrustedStatus(r).status).not.toBe('REVERTED');
      expect(withTrustedStatus(r).status).toBe('PENDING');
    }
  });

  it('is idempotent: applying it again changes nothing', () => {
    const once = withTrustedStatus(rec({}));
    expect(withTrustedStatus(once)).toBe(once);
  });

  it('a record that later gets its proof is verified again and keeps the audit trail', () => {
    const recovered = { ...withTrustedStatus(rec({})), status: 'VERIFIED' as const, burnHash: H('ab'), mintHash: H('cd') };
    expect(withTrustedStatus(recovered)).toBe(recovered);
    expect(recovered.downgradedFrom).toBe('VERIFIED');
  });

  it('never upgrades and never touches other fields or statuses', () => {
    for (const status of ['UNKNOWN', 'PENDING', 'REVERTED'] as const) {
      const r = rec({ status });
      expect(withTrustedStatus(r)).toBe(r);
    }
    const downgraded = withTrustedStatus({ ...rec({ burnHash: H('ab') }), amount: '5', minimum: '4.98' });
    expect(downgraded).toMatchObject({ status: 'PENDING', amount: '5', minimum: '4.98', burnHash: H('ab') });
  });
});

describe('the Exchange component applies it when it loads a stored record', () => {
  const circle = readFileSync(new URL('../components/pages/MainnetCirclePage.tsx', import.meta.url), 'utf8');
  it('parseSaved returns the trusted status', () => {
    expect(circle).toContain('return withFreshVerification(v as Recovery);');
  });
  it('the write-back touches only the connected wallet\'s own key, so other wallets are unaffected', () => {
    expect(circle).toMatch(/const raw=localStorage\.getItem\(key\(mode,address\)\);/);
    expect(circle).not.toMatch(/localStorage\.setItem\(key\(mode,(?!address)/);
  });
  it('the unresolved panel explains a downgraded record without calling it failed', () => {
    expect(circle).toContain("recovery?.downgradedFrom&&recovery.status==='PENDING'");
    expect(circle).toContain('It is not marked failed and nothing was resent.');
  });
  it('the downgrade is written back so every other reader of the record sees it', () => {
    expect(circle).toMatch(/localStorage\.setItem\(key\(mode,address\),JSON\.stringify\(saved\)\)/);
  });
});
