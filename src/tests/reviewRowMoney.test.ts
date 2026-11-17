import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const page = readFileSync(new URL('../components/pages/SettlementPage.tsx', import.meta.url), 'utf8');

describe('Settlement review rows never split an amount', () => {
  it('only addresses and hashes may break mid-string; amounts stay whole; other text breaks at spaces', () => {
    expect(page).toContain("const valueWrap = money ? 'whitespace-nowrap shrink-0' : mono ? 'break-all' : 'break-words';");
    const row = page.slice(page.indexOf('function ReviewRow'), page.indexOf('function ReviewRow') + 900);
    expect(row).not.toMatch(/text-right break-all/);          // the old rule split "1.25 USD" / "C"
  });

  it('every row that shows an amount is marked as money', () => {
    for (const label of ['Amount', 'Fee', 'Recipient receives', 'Total sent', 'Gross', 'Protocol fee', 'Net received']) {
      const line = page.split('\n').find((l) => l.includes(`<ReviewRow label="${label}"`));
      expect(line, label).toBeDefined();
      expect(line, label).toMatch(/ money\b/);
    }
  });

  it('network fee estimates use the same rule', () => {
    const gas = page.slice(page.indexOf('function GasRow'), page.indexOf('function GasRow') + 400);
    expect(gas).toMatch(/\n\s+money\n/);
  });
});
