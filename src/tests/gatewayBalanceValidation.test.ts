import { describe, expect, it } from 'vitest';
import { isExactGatewayUsdcBalance } from '../../server/services/gatewayBalanceValidation';

describe('Circle Gateway decimal balance validation', () => {
  it('accepts zero, exact fractional USDC, and six decimals without floating point', () => {
    for (const value of [
      '0', '0.0', '0.000000', '1', '1.25', '3.141592', '999999999999999999.999999',
    ]) expect(isExactGatewayUsdcBalance(value), value).toBe(true);
  });
  it('rejects malformed or high-precision provider balances instead of inventing zero', () => {
    for (const value of [
      '1e6', '1,2', '1\\.25', '1.0000001', '.25', '1.', '-1', '+1', 'NaN',
      '', ' 1.25 ', 'Infinity', 1.25, null, undefined, {}, [],
    ]) expect(isExactGatewayUsdcBalance(value), String(value)).toBe(false);
  });
});
