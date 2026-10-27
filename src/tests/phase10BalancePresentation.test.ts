import { describe, expect, it } from 'vitest';
import { formatUsdcBalance } from '../core/receipt/formatUsdcBalance';
describe('USDC balance presentation', () => {
  it('preserves small balances and amounts beyond Number precision', () => {
    expect(formatUsdcBalance(0n, 6)).toBe('0.00');
    expect(formatUsdcBalance(1n, 6)).toBe('0.000001');
    expect(formatUsdcBalance(1234500n, 6)).toBe('1.2345');
    expect(formatUsdcBalance(123456789123456789n, 6)).toBe('123,456,789,123.456789');
  });
});
