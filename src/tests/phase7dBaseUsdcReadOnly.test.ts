import { describe, expect, it } from 'vitest';
import { getBaseUsdcNetwork, readBaseUsdcBalance } from '../preview/baseUsdcReadOnly';
import type { BaseUsdcEnvironment } from '../preview/baseUsdcReadOnly';
import { readFileSync } from 'node:fs';

const ACCOUNT = '0x1111111111111111111111111111111111111111';
const balance = '0x' + (1_234_567n).toString(16).padStart(64, '0');
const decimals = '0x' + (6n).toString(16).padStart(64, '0');

interface StubOptions {
  chain?: string;
  decimalResult?: string;
  balanceResult?: string;
  codeResult?: string;
  blockResult?: string;
  httpStatus?: number;
  error?: unknown;
  wrongId?: boolean;
}

function stub(environment: BaseUsdcEnvironment, overrides: StubOptions = {}) {
  const chain = getBaseUsdcNetwork(environment);
  const calls: Array<{ method: string; params: unknown[]; url: string }> = [];
  const fetchFn: typeof fetch = (request, init) => {
    const url = String(request);
    const packet = JSON.parse(String(init?.body)) as { method: string; params: unknown[]; id: number };
    calls.push({ method: packet.method, params: packet.params, url });
    const result = packet.method === 'eth_chainId'
      ? overrides.chain ?? '0x' + chain.chainId.toString(16)
      : packet.method === 'eth_blockNumber'
        ? overrides.blockResult ?? '0x42'
        : packet.method === 'eth_getCode'
          ? overrides.codeResult ?? '0x60016000'
          : packet.method === 'eth_call'
            ? (packet.params[0] as { data: string }).data === '0x313ce567'
              ? overrides.decimalResult ?? decimals
              : overrides.balanceResult ?? balance
            : '0xdead';
    const response = overrides.error === undefined
      ? { jsonrpc: '2.0', id: overrides.wrongId ? 999 : packet.id, result }
      : { jsonrpc: '2.0', id: packet.id, error: overrides.error };
    return Promise.resolve(new Response(JSON.stringify(response), {
      status: overrides.httpStatus ?? 200, headers: { 'Content-Type': 'application/json' },
    }));
  };
  return { fetchFn, calls, chain };
}

describe('Phase 7D — Base-native USDC portfolio observation', () => {
  it.each(['testnet', 'mainnet'] as const)(
    'reads a real-format 6-decimal balance only from pinned %s Base network', async environment => {
      const spy = stub(environment);
      const result = await readBaseUsdcBalance(ACCOUNT, environment, { fetchFn: spy.fetchFn });
      expect(result.address.toLowerCase()).toBe(ACCOUNT.toLowerCase());
      expect(result.chainId).toBe(spy.chain.chainId);
      expect(result.amountUnits).toBe(1_234_567n);
      expect(result.decimals).toBe(6);
      expect(result.blockNumber).toBe(66n);
      expect(result.observedAt).toBeGreaterThan(0);
      expect(spy.calls.map(x => x.method)).toEqual([
        'eth_chainId', 'eth_blockNumber', 'eth_getCode', 'eth_call', 'eth_call',
      ]);
      expect(spy.calls.every(x => x.url === spy.chain.rpc)).toBe(true);
      const tokenCalls = spy.calls.filter(x => x.method === 'eth_call');
      expect(tokenCalls.every(x => (x.params[0] as { to: string }).to.toLowerCase() === spy.chain.usdc.toLowerCase())).toBe(true);
      expect((tokenCalls[1].params[0] as { data: string }).data).toBe(
        '0x70a08231' + ACCOUNT.slice(2).toLowerCase().padStart(64, '0'));
      expect(spy.calls.some(x => /eth_send|eth_sign|personal_sign|wallet_switch/i.test(x.method))).toBe(false);
    },
  );

  it('rejects unknown addresses and unsupported environments before making requests', async () => {
    const spy = stub('mainnet');
    await expect(readBaseUsdcBalance('bad wallet', 'mainnet', { fetchFn: spy.fetchFn })).rejects.toThrow('valid EVM');
    await expect(readBaseUsdcBalance(ACCOUNT, 'unknown' as BaseUsdcEnvironment, { fetchFn: spy.fetchFn })).rejects.toThrow('Unsupported');
    expect(spy.calls).toHaveLength(0);
  });
  it('fails closed against a wrong-chain public RPC or zero-height snapshot', async () => {
    await expect(readBaseUsdcBalance(ACCOUNT, 'mainnet', { fetchFn: stub('mainnet', { chain: '0x1' }).fetchFn }))
      .rejects.toThrow('chain mismatch');
    await expect(readBaseUsdcBalance(ACCOUNT, 'testnet', { fetchFn: stub('testnet', { blockResult: '0x0' }).fetchFn }))
      .rejects.toThrow('confirmed block');
  });
  it('rejects wrong token decimals, missing code, malformed bytes and untrusted response IDs', async () => {
    await expect(readBaseUsdcBalance(ACCOUNT, 'mainnet', { fetchFn: stub('mainnet', { decimalResult: '0x12' }).fetchFn }))
      .rejects.toThrow('decimals mismatch');
    await expect(readBaseUsdcBalance(ACCOUNT, 'mainnet', { fetchFn: stub('mainnet', { codeResult: '0x' }).fetchFn }))
      .rejects.toThrow('code unavailable');
    await expect(readBaseUsdcBalance(ACCOUNT, 'mainnet', { fetchFn: stub('mainnet', { balanceResult: 'not-hex' }).fetchFn }))
      .rejects.toThrow('Invalid USDC balance');
    await expect(readBaseUsdcBalance(ACCOUNT, 'mainnet', { fetchFn: stub('mainnet', { wrongId: true }).fetchFn }))
      .rejects.toThrow('untrusted response');
  });
  it('does not manufacture a zero balance on 429, 500 or JSON-RPC error', async () => {
    await expect(readBaseUsdcBalance(ACCOUNT, 'mainnet', { fetchFn: stub('mainnet', { httpStatus: 429 }).fetchFn }))
      .rejects.toThrow('rate-limited');
    await expect(readBaseUsdcBalance(ACCOUNT, 'mainnet', { fetchFn: stub('mainnet', { httpStatus: 500 }).fetchFn }))
      .rejects.toThrow('unavailable');
    await expect(readBaseUsdcBalance(ACCOUNT, 'mainnet', { fetchFn: stub('mainnet', { error: { code: -32000 } }).fetchFn }))
      .rejects.toThrow('untrusted response');
  });
  it('shows exact zero only when the onchain balanceOf returned zero', async () => {
    const result = await readBaseUsdcBalance(ACCOUNT, 'mainnet', { fetchFn: stub('mainnet', { balanceResult: '0x' + '0'.repeat(64) }).fetchFn });
    expect(result.amountUnits).toBe(0n);
  });
  it('keeps wallet-held balance reads separate from Circle Gateway and all signing', () => {
    const source = readFileSync(new URL('../preview/baseUsdcReadOnly.ts', import.meta.url), 'utf8');
    const surface = readFileSync(new URL('../preview/PreviewBaseUsdcBalance.tsx', import.meta.url), 'utf8');
    expect(source + surface).not.toMatch(/eth_sendTransaction|eth_signTypedData|personal_sign|depositForBurn|kit\.unifiedBalance\.(deposit|spend)\(/);
    expect(surface).toContain('Unavailable —');
    expect(surface).toContain('wallet.address');
    expect(surface).toContain('controller.abort()');
    expect(surface).not.toMatch(/Total portfolio|Total USD|Estimated value/);
  });
});
