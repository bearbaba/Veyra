/**
 * Warns when a transfer fee is a large share of the amount sent. Display only:
 * it never blocks, approves or alters a quote; the fee cap and minimum-received
 * guards in bridgeQuoteGuard.ts remain the safety boundary.
 */
import { parseUnits } from 'viem';

export type FeeBurdenLevel = 'normal' | 'high' | 'severe';
export interface FeeBurden {
  /** Fee as basis points of the amount, rounded up so it is never under-reported. */
  bps: number;
  level: FeeBurdenLevel;
  /** Human-readable share, for example "2.5%". */
  percent: string;
}

export const HIGH_FEE_BPS = 100;   // 1% of the amount
export const SEVERE_FEE_BPS = 500; // 5% of the amount

const AMOUNT = /^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,6})?$/;

/** Returns null when either value is not a valid positive USDC amount. */
export function assessFeeBurden(amount: string, fee: string): FeeBurden | null {
  if (!AMOUNT.test(amount) || !AMOUNT.test(fee)) return null;
  const gross = parseUnits(amount, 6);
  const cost = parseUnits(fee, 6);
  if (gross <= 0n) return null;
  const bps = Number((cost * 10_000n + gross - 1n) / gross);
  const level: FeeBurdenLevel = bps >= SEVERE_FEE_BPS ? 'severe' : bps >= HIGH_FEE_BPS ? 'high' : 'normal';
  return { bps, level, percent: (bps / 100).toFixed(1) + '%' };
}

/** 'swap-usdc-fees': a swap where only the USDC-denominated fees could be measured. */
export type FeeBurdenSubject = 'transfer' | 'swap' | 'swap-usdc-fees';

/** `subject` only changes the wording; the default output is unchanged. */
export function feeBurdenMessage(burden: FeeBurden, subject: FeeBurdenSubject = 'transfer'): string | null {
  if (burden.level === 'normal') return null;
  const cost = subject === 'swap' ? 'Network gas and provider fees are'
    : subject === 'swap-usdc-fees' ? 'Fees paid in USDC are' : 'Fees are';
  const noun = subject === 'transfer' ? 'transfer' : 'swap';
  return burden.level === 'severe'
    ? `${cost} about ${burden.percent} of this ${noun}. ${noun === 'swap' ? 'Swapping' : 'Sending'} a larger amount is usually much cheaper.`
    : `${cost} about ${burden.percent} of this ${noun}. Check the minimum you will receive before you confirm.`;
}
