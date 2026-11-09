import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { feeBurdenMessage } from '../mainnet/feeBurden';
import { ceilDecimal, parseFeeLine, summarizeQuote, type QuoteSummaryInput } from '../mainnet/quoteSummary';

/** Real shapes captured from Circle's live quote service (Arc Mainnet, 1 USDC -> EURC and 5 USDC Arc -> Base). */
const SWAP: QuoteSummaryInput = {
  mode: 'swap', amount: '1', fromToken: 'USDC', toToken: 'EURC',
  expected: '0.892906', minimum: '0.883977',
  fees: ['provider: 0.0002 USDC', 'gas: 0.020153209192922725 USDC'],
};
const BRIDGE: QuoteSummaryInput = {
  mode: 'bridge', amount: '5', fromToken: 'USDC', toToken: 'USDC',
  expected: '4.945624', minimum: '4.945624',
  fees: ['forwarder: 0.054376 USDC'], bridgeMaxFee: '0.054376',
};
const row = (rows: { label: string; value: string }[], label: string) => rows.find((r) => r.label === label);

describe('decimal rounding never under-reports a cost', () => {
  it('rounds up beyond 6 decimals', () => {
    expect(ceilDecimal('0.020153209192922725')).toMatchObject({ text: '0.020154', rounded: true, units: 20154n });
  });
  it('keeps exact values exact and trims zeros', () => {
    expect(ceilDecimal('0.0002')).toMatchObject({ text: '0.0002', rounded: false, units: 200n });
    expect(ceilDecimal('3')).toMatchObject({ text: '3', rounded: false });
    expect(ceilDecimal('1.500000')).toMatchObject({ text: '1.5', rounded: false });
  });
  it('a sub-micro cost never displays as zero', () => {
    expect(ceilDecimal('0.0000000000001')).toMatchObject({ text: '0.000001', rounded: true });
    expect(ceilDecimal('0.000000999999999999999')).toMatchObject({ text: '0.000001', rounded: true });
  });
  it('an exact zero stays zero', () => {
    expect(ceilDecimal('0')).toMatchObject({ text: '0', rounded: false });
  });
});

describe('fee line parsing', () => {
  it('reads provider, forwarder and gas lines', () => {
    expect(parseFeeLine('provider: 0.0002 USDC')).toMatchObject({ kind: 'provider', amount: '0.0002', token: 'USDC' });
    expect(parseFeeLine('forwarder: 0.054376 USDC')).toMatchObject({ kind: 'forwarder' });
    expect(parseFeeLine('gas: 0.02 ETH')).toMatchObject({ kind: 'gas', token: 'ETH' });
  });
  it('returns null for text it does not understand, so the UI can show it as received', () => {
    expect(parseFeeLine('Fee details unavailable')).toBeNull();
    expect(parseFeeLine('provider: unknown USDC')).toBeNull();
  });
});

describe('Swap quote summary (real USDC -> EURC quote)', () => {
  const summary = summarizeQuote(SWAP);

  it('shows expected and minimum received, then every fee, then the total', () => {
    expect(summary.rows.map((r) => r.label)).toEqual(['Expected received', 'Minimum received', 'Provider fee', 'Network gas', 'Total fees']);
    expect(row(summary.rows, 'Expected received')?.value).toBe('0.892906 EURC');
    expect(row(summary.rows, 'Minimum received')?.value).toBe('0.883977 EURC');
    expect(row(summary.rows, 'Provider fee')?.value).toBe('0.0002 USDC');
    expect(row(summary.rows, 'Network gas')?.value).toBe('≈ 0.020154 USDC');
    expect(row(summary.rows, 'Total fees')?.value).toBe('≈ 0.020354 USDC');
  });

  it('warns that fees are about 2% of a 1 USDC swap, and never calls the swap fine', () => {
    expect(summary.burden).toMatchObject({ level: 'high', percent: '2.0%' });
    expect(feeBurdenMessage(summary.burden!, summary.burdenSubject)).toBe(
      'Network gas and provider fees are about 2.0% of this swap. Check the minimum you will receive before you confirm.');
  });

  it('a larger swap clears the warning with the same fees', () => {
    expect(summarizeQuote({ ...SWAP, amount: '100' }).burden).toMatchObject({ level: 'normal' });
  });

  it('a very small swap is severe', () => {
    expect(summarizeQuote({ ...SWAP, amount: '0.2' }).burden).toMatchObject({ level: 'severe' });
  });
});

describe('Bridge quote summary (real 5 USDC Arc -> Base quote)', () => {
  const summary = summarizeQuote(BRIDGE);

  it('shows expected, minimum and the forwarding fee; gas is honestly left to the wallet', () => {
    expect(row(summary.rows, 'Minimum received')?.value).toBe('4.945624 USDC');
    expect(row(summary.rows, 'Forwarding fee')?.value).toBe('0.054376 USDC');
    expect(row(summary.rows, 'Network gas')?.value).toBe('In your wallet');
    expect(summary.rows.find((r) => r.label === 'Network gas')?.muted).toBe(true);
  });

  it('keeps the existing cap-based fee warning (about 1.1%)', () => {
    expect(summary.burden).toMatchObject({ level: 'high', percent: '1.1%' });
    expect(feeBurdenMessage(summary.burden!, summary.burdenSubject)).toBe(
      'Fees are about 1.1% of this transfer. Check the minimum you will receive before you confirm.');
  });
});

describe('never invents or hides', () => {
  it('shows every provider line, including ones it cannot parse', () => {
    const summary = summarizeQuote({ ...SWAP, fees: ['provider: 0.0002 USDC', 'Fee details unavailable'] });
    expect(summary.rows.some((r) => r.value === 'Fee details unavailable')).toBe(true);
    expect(summary.burden).toBeNull();                       // cannot compare what it cannot read
  });

  it('does not compare a gas fee paid in another asset against a USDC amount', () => {
    const summary = summarizeQuote({ ...SWAP, fees: ['provider: 0.0002 USDC', 'gas: 0.0004 ETH'] });
    expect(row(summary.rows, 'Network gas')?.value).toBe('0.0004 ETH');
    expect(summary.burden).toBeNull();
    expect(summary.rows.some((r) => r.label === 'Total fees')).toBe(false);
  });

  it('does not compare USDC fees against a non-USDC input', () => {
    expect(summarizeQuote({ ...SWAP, fromToken: 'EURC', toToken: 'USDC' }).burden).toBeNull();
  });

  it('an itemized gas line replaces the "shown in your wallet" placeholder', () => {
    expect(summarizeQuote(SWAP).rows.filter((r) => r.label === 'Network gas')).toHaveLength(1);
  });

  it('no fee lines: still shows expected, minimum and the gas placeholder', () => {
    const summary = summarizeQuote({ ...SWAP, fees: [] });
    expect(summary.rows.map((r) => r.label)).toEqual(['Expected received', 'Minimum received', 'Network gas']);
    expect(summary.burden).toBeNull();
  });
});

describe('message wording', () => {
  it('the default transfer wording is unchanged', () => {
    expect(feeBurdenMessage({ bps: 250, level: 'high', percent: '2.5%' })).toBe(
      'Fees are about 2.5% of this transfer. Check the minimum you will receive before you confirm.');
    expect(feeBurdenMessage({ bps: 900, level: 'severe', percent: '9.0%' })).toBe(
      'Fees are about 9.0% of this transfer. Sending a larger amount is usually much cheaper.');
  });
});

describe('Exchange page renders the summary and keeps the provider fee strings untouched', () => {
  const page = readFileSync(new URL('../components/pages/MainnetCirclePage.tsx', import.meta.url), 'utf8');
  it('uses the shared summary rows', () => {
    expect(page).toContain('summarizeQuote(');
    expect(page).toContain('summary.rows.map(');
  });
  it('the Preview-disabled button stays readable (not the 40% general disabled style)', () => {
    expect(page).toContain("'disabled:opacity-80':'disabled:opacity-40'");
  });
  it('the Swap re-check still compares the provider strings verbatim', () => {
    expect(page).toContain('JSON.stringify(feeLines(fresh))!==JSON.stringify(quote.fees)');
    expect(page).toContain('fees:feeLines(estimate)');
  });
  it('no longer labels an expected amount as the minimum', () => {
    expect(page).not.toContain("'MINIMUM RECEIVE'");
  });
});
