import { formatUnits } from 'viem';

/** Preserve token precision; never round a small available balance to zero. */
export function formatUsdcBalance(raw: bigint, decimals: number): string {
  const [whole, fractional = ''] = formatUnits(raw, decimals).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${grouped}.${fractional.padEnd(2, '0')}`;
}
