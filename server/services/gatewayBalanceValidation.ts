/**
 * Strict decimal validation for Circle Gateway USDC balances.
 * Provider values are decimal strings, never floating-point JS numbers.
 * Zero is valid for a deposited-balance source without credited funds.
 */
const EXACT_USDC_DECIMAL = /^\d{1,18}(?:\.\d{1,6})?$/;

export function isExactGatewayUsdcBalance(value: unknown): value is string {
  return typeof value === 'string' && EXACT_USDC_DECIMAL.test(value);
}
