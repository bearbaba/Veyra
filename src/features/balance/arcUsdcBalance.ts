/**
 * Exact display-only formatting for pinned Arc Testnet USDC (six decimals).
 * Never derive a balance from float math or treat stale RPC data as zero.
 */
import { formatUnits } from 'viem';

export function formatArcUsdcBalance(rawUnits: bigint): string {
  if (rawUnits < 0n) throw new Error('USDC balance cannot be negative');
  const [whole, fraction = ''] = formatUnits(rawUnits, 6).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const preciseFraction = fraction.replace(/0+$/, '').padEnd(2, '0');
  return `${grouped}.${preciseFraction}`;
}
