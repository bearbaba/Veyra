/**
 * src/lib/settlementGas.ts
 *
 * Arc gas-to-USDC conversion for the VeyraSettlement payment UI.
 *
 * Arc native gas denomination: 18 decimals (gas units × gasPrice = 18-dec native).
 * Arc USDC ERC-20 denomination:  6 decimals.
 * Conversion factor: 10^(18-6) = 10^12.
 *
 * Imported by:
 *   - src/components/pages/SettlementPage.tsx   (production)
 *   - src/tests/settlementGasAndVerification.test.ts  (regression)
 */

/** Decimals of the Arc native gas token (USDC, as a gas asset). */
export const ARC_GAS_DECIMALS = 18;

/** Decimals of the Arc USDC ERC-20 contract. */
export const ARC_USDC_DECIMALS = 6;

/**
 * Conversion divisor from 18-decimal native gas units to 6-decimal USDC micro-units.
 * = 10^(18 - 6) = 10^12 = 1_000_000_000_000n
 *
 * WRONG: formatUnits(nativeGasValue, 6) — treats 18-dec as 6-dec, 10^12× too large.
 * RIGHT: formatUnits(gasNativeToUsdcMicro(nativeGasValue), 6)
 */
export const GAS_TO_USDC_DIVISOR = 10n ** BigInt(ARC_GAS_DECIMALS - ARC_USDC_DECIMALS);

/**
 * Convert a native 18-decimal gas value to 6-decimal USDC micro-units using
 * ceiling division, so the displayed reserve is never less than the actual cost.
 *
 * Floor/truncation can under-report by up to (GAS_TO_USDC_DIVISOR - 1) native
 * units. For a reserve shown to the user, ceiling is the correct choice.
 *
 * Special cases:
 *   - gasNative === 0n  → 0n  (sentinel: no estimate available — caller shows
 *                              "estimation unavailable", not a fee amount)
 *   - 1 ≤ gasNative < GAS_TO_USDC_DIVISOR  → 1n  (sub-micro, ceil to 1)
 *
 * Ceiling integer division: ceil(a / d) = (a + d - 1) / d  for a ≥ 0.
 */
export function gasNativeToUsdcMicro(gasNative: bigint): bigint {
  if (gasNative === 0n) return 0n;
  return (gasNative + GAS_TO_USDC_DIVISOR - 1n) / GAS_TO_USDC_DIVISOR;
}

/**
 * Format a 18-decimal native gas value as a human USDC string for display.
 *
 * Returns '< 0.000001 USDC' when:
 *   - gasNative === 0n (no estimate — component shows "estimation unavailable")
 *   - sub-micro result rounds to 1 but represents < 1 micro-USDC of actual cost
 *
 * The caller is responsible for distinguishing 0n (unavailable) from non-zero
 * sub-micro values when deciding whether to show an estimate or an error.
 */
export function fmtGasUsdc(gasNative: bigint): string {
  const micro = gasNativeToUsdcMicro(gasNative);
  if (micro === 0n) return '< 0.000001 USDC';
  // formatUnits with 6 decimals on micro-USDC gives correct USDC string
  const raw = (micro / 1_000_000n === 0n)
    ? '0.' + micro.toString().padStart(6, '0')
    : micro.toString().slice(0, -6) + '.' + micro.toString().slice(-6).padStart(6, '0');
  // strip trailing zeros after decimal point
  return `~${raw.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')} USDC`;
}
