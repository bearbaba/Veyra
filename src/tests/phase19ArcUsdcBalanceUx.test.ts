import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { formatArcUsdcBalance } from '../features/balance/arcUsdcBalance';

const read=(p:string)=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');

describe('Phase 19 — verified Arc USDC balance display',()=>{
  it('preserves all six decimals without JS floating point conversion',()=>{
    expect(formatArcUsdcBalance(0n)).toBe('0.00');
    expect(formatArcUsdcBalance(1n)).toBe('0.000001');
    expect(formatArcUsdcBalance(9_999n)).toBe('0.009999');
    expect(formatArcUsdcBalance(10_000n)).toBe('0.01');
    expect(formatArcUsdcBalance(1_000_000n)).toBe('1.00');
    expect(formatArcUsdcBalance(1_230_000n)).toBe('1.23');
    expect(formatArcUsdcBalance(9_007_199_254_740_993_123_456_789n)).toBe('9,007,199,254,740,993,123.456789');
    expect(()=>formatArcUsdcBalance(-1n)).toThrow();
  });
  it('never invents a balance or asks to sign merely to read',()=>{
    const home=read('src/components/pages/HomePage.tsx');
    expect(home).toContain('getUsdc(ARC_TESTNET_CHAIN_ID)');
    expect(home).toContain('chainId: ARC_TESTNET_CHAIN_ID');
    expect(home).toContain("VEYRA_ENV !== 'mainnet'");
    expect(home).toContain('!balanceError && balanceRaw != null');
    expect(home).toContain('formatArcUsdcBalance(balanceRaw)');
    expect(home).toContain('Balance unavailable. Your funds have not been assumed to be zero. Try Refresh.');
    expect(home).toContain('balanceLoading || formattedBalance===null');
    expect(home).not.toContain('Number(formatUnits(balanceRaw');
    expect(home).not.toContain('writeContract');
    expect(home).not.toContain('signMessage');
  });
  it('refreshes read-only RPC data with honest time and error statuses',()=>{
    const home=read('src/components/pages/HomePage.tsx');
    expect(home).toContain('refetchInterval: 30_000');
    expect(home).toContain('refetchOnWindowFocus: true');
    expect(home).toContain('disabled={balanceFetching}');
    expect(home).toContain('Last read');
    expect(home).toContain('role="alert"');
  });
});
