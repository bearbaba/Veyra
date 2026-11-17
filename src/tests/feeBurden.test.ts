import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { assessFeeBurden, feeBurdenMessage, HIGH_FEE_BPS, SEVERE_FEE_BPS } from '../mainnet/feeBurden';

describe('Transfer fee burden', () => {
  it('is normal below 1% of the amount', () => {
    expect(assessFeeBurden('100', '0.5')).toMatchObject({ bps: 50, level: 'normal' });
    expect(feeBurdenMessage(assessFeeBurden('100', '0.5')!)).toBeNull();
  });
  it('warns at exactly 1% and becomes severe at exactly 5%', () => {
    expect(assessFeeBurden('100', '1')).toMatchObject({ bps: HIGH_FEE_BPS, level: 'high', percent: '1.0%' });
    expect(assessFeeBurden('100', '5')).toMatchObject({ bps: SEVERE_FEE_BPS, level: 'severe' });
  });
  it('rounds the share up so a fee is never under-reported', () => {
    // 0.99 / 100 = 99 bps exactly; 0.990001 cannot be expressed, but 1 micro over 1% must still warn.
    expect(assessFeeBurden('100', '0.999999')?.bps).toBe(100);
    expect(assessFeeBurden('1', '0.056885')).toMatchObject({ bps: 569, level: 'severe' });
  });
  it('rejects invalid or non-positive input instead of guessing', () => {
    for (const [amount, fee] of [['0', '1'], ['-1', '1'], ['abc', '1'], ['1', 'x'], ['1.1234567', '1']]) {
      expect(assessFeeBurden(amount, fee)).toBeNull();
    }
  });
  it('is display-only and shown in the Bridge review without altering signing', () => {
    const page = readFileSync(new URL('../components/pages/MainnetCirclePage.tsx', import.meta.url), 'utf8');
    // The warning is computed by the shared quote summary, on the CCTP fee cap for a Bridge.
    expect(page).toContain('summarizeQuote(');
    expect(page).toContain('feeBurdenMessage(summary.burden,summary.burdenSubject)');
    const summary = readFileSync(new URL('../mainnet/quoteSummary.ts', import.meta.url), 'utf8');
    expect(summary).toContain('assessFeeBurden(input.amount, input.bridgeMaxFee)');
    expect(summary).not.toMatch(/throw|signNow|writeContract/);
    expect(page).toContain("quote&&!quoteExpired?signNow()");
    const guard = readFileSync(new URL('../mainnet/feeBurden.ts', import.meta.url), 'utf8');
    expect(guard).not.toMatch(/throw|signNow|writeContract/);
  });
});
