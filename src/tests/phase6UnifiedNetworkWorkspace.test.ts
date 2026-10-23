import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { encodeFunctionData, parseAbi } from 'viem';
import {
  PREVIEW_ARC_MAINNET_CHAIN_ID, PREVIEW_ARC_MAINNET_RPC,
  PREVIEW_ARC_MAINNET_USDC, PREVIEW_MAINNET_CANARY_MAX,
  assertMainnetReadCatalog, createReadOnlyMainnetIntent, mainnetGasReserve,
  readMainnetBalance, simulateReadOnlyMainnetIntent, verifyMainnetReadChain,
} from '../preview/arcMainnetReadOnly';

const FROM = '0x1111111111111111111111111111111111111111';
const TO = '0x2222222222222222222222222222222222222222';
const rpcCalls: string[] = [];
afterEach(() => { vi.unstubAllGlobals(); rpcCalls.length = 0; });

function fakeRpc(opts: { chain?: string; decimals?: string; balance?: string; simulation?: string;
  gas?: string; gasPrice?: string; forgedId?: boolean; invalid?: boolean } = {}) {
  const fetchFn = vi.fn((endpoint: unknown, request: unknown) => {
    if (endpoint !== PREVIEW_ARC_MAINNET_RPC) throw new Error('Unapproved RPC URL.');
    const packet = JSON.parse((request as { body: string }).body) as { id: number; method: string; params: unknown[] };
    rpcCalls.push(packet.method);
    let result: unknown;
    switch (packet.method) {
      case 'eth_chainId': result = opts.chain ?? '0x13b2'; break;
      case 'eth_estimateGas': result = opts.gas ?? '0xc350'; break;
      case 'eth_gasPrice': result = opts.gasPrice ?? '0x3b9aca00'; break;
      case 'eth_call': {
        const tx = packet.params[0] as { data: string };
        result = tx.data === '0x313ce567' ? opts.decimals ?? '0x6'
          : tx.data.startsWith('0x70a08231') ? opts.balance ?? '0x989680'
          : opts.simulation ?? '0x1';
        break;
      }
      default: throw new Error('Unexpected RPC method requested');
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve(opts.invalid ? [] : {
      jsonrpc: '2.0', id: opts.forgedId ? 9 : packet.id, result,
    }) });
  });
  vi.stubGlobal('fetch', fetchFn);
  return fetchFn;
}
function src(path: string): string {
  return readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

describe('Phase 6 unified Veyra network selector safety', () => {
  it('pins Arc Mainnet to the reviewed chain and token without enabling its signer', () => {
    expect(PREVIEW_ARC_MAINNET_CHAIN_ID).toBe(5042);
    expect(PREVIEW_ARC_MAINNET_USDC.toLowerCase()).toBe('0x3600000000000000000000000000000000000000');
    expect(PREVIEW_MAINNET_CANARY_MAX).toBe(1_000_000n);
    expect(assertMainnetReadCatalog).not.toThrow();
    const observer = src('src/preview/arcMainnetReadOnly.ts');
    const page = src('src/preview/PreviewMainnetSurfaces.tsx');
    for (const code of [observer, page]) {
      expect(code).not.toMatch(/eth_sendTransaction|wallet_addEthereumChain|privateKeyToAccount|signTypedData|depositForBurn|receiveMessage/);
      expect(code).not.toMatch(/from ['"][^'"]*(?:mainnet\/arcMainnetPay|server\/|core\/execution)/);
    }
    const hosting = src('vercel.json');
    const expected = hosting.includes('VITE_VEYRA_IDENTITY_BETA=1')
      ? 'VITE_VEYRA_ENV=testnet VITE_VEYRA_IDENTITY_BETA=1'
      : 'VITE_VEYRA_ENV=testnet VITE_VEYRA_UI_ONLY=1 VITE_VEYRA_TESTNET_PAY=1';
    expect(hosting).toContain(expected);
    expect(hosting).not.toContain('VITE_VEYRA_MAINNET_PAY=1');
  });
  it('has a compact, explicit default-Testnet selector and discards forms when switching', () => {
    const app = src('src/preview/PreviewApp.tsx');
    expect(app).toContain("useState<PreviewNetwork>('testnet')");
    expect(app).toContain('aria-label="Veyra network environment"');
    expect(app).toContain("onNetworkChange('testnet')");
    expect(app).toContain("onNetworkChange('mainnet')");
    expect(app).toContain("setPage('home')");
    expect(app).toContain('<PreviewMainnetPay/>');
    expect(app).toContain('<PreviewTestnetPayPage />');
    expect(app).toContain('network === \'mainnet\'');
    expect(app).toContain('Mainnet signing');
    expect(src('src/preview/preview.css')).toContain('.vp-network-segment');
    expect(src('src/preview/PreviewLiveAgent.tsx')).toContain('MAINNET_EXAMPLES');
  });
  it('uses chain-pinned 6-decimal USDC calldata, 18-decimal gas and 1-token limit', () => {
    const intent = createReadOnlyMainnetIntent(FROM, TO, '0.25');
    expect(intent.units).toBe(250_000n);
    expect(intent.token.toLowerCase()).toBe(PREVIEW_ARC_MAINNET_USDC);
    expect(intent.calldata).toBe(encodeFunctionData({
      abi: parseAbi(['function transfer(address to,uint256 amount) returns (bool)']),
      functionName: 'transfer', args: [TO, 250_000n],
    }));
    expect(mainnetGasReserve(50_000n, 1_000_000_000n)).toBe(100n);
    expect(() => mainnetGasReserve(0n, 1n)).toThrow();
    for (const amt of ['0', '1.000001', '-1', '1.0000001', '1e0', 'Infinity', '0x5']) {
      expect(() => createReadOnlyMainnetIntent(FROM, TO, amt)).toThrow();
    }
    for (const to of [FROM, '0x0', '0x0000000000000000000000000000000000000000']) {
      expect(() => createReadOnlyMainnetIntent(FROM, to, '0.01')).toThrow();
    }
  });
  it('reads only independently verified Arc RPC balance and token decimals', async () => {
    fakeRpc();
    await expect(readMainnetBalance(FROM)).resolves.toMatchObject({ chainId: 5042, units: 10_000_000n, decimals: 6 });
    expect(rpcCalls).toEqual(['eth_chainId', 'eth_call', 'eth_call']);
    fakeRpc({ chain: '0x1' });
    await expect(verifyMainnetReadChain()).rejects.toThrow('RPC chain mismatch');
    fakeRpc({ decimals: '0x12' });
    await expect(readMainnetBalance(FROM)).rejects.toThrow('decimals');
    fakeRpc({ forgedId: true });
    await expect(readMainnetBalance(FROM)).rejects.toThrow('untrusted');
    fakeRpc({ invalid: true });
    await expect(readMainnetBalance(FROM)).rejects.toThrow('untrusted');
  });
  it('simulates exact reviewed transfer without wallet submission or fake settlement', async () => {
    const fetchFn = fakeRpc();
    const quote = await simulateReadOnlyMainnetIntent(FROM, TO, '0.25');
    expect(quote.units).toBe(250_000n);
    expect(quote.gasLimit).toBe(50_000n);
    expect(quote.feeReserveUnits).toBe(100n);
    expect(quote.availableUnits).toBe(10_000_000n);
    expect(rpcCalls).toEqual(['eth_chainId', 'eth_call', 'eth_call', 'eth_call', 'eth_estimateGas', 'eth_gasPrice']);
    expect(fetchFn).toHaveBeenCalledTimes(6);
    fakeRpc({ simulation: '0x0' });
    await expect(simulateReadOnlyMainnetIntent(FROM, TO, '0.25')).rejects.toThrow('did not return success');
    fakeRpc({ balance: '0x1' });
    await expect(simulateReadOnlyMainnetIntent(FROM, TO, '0.25')).rejects.toThrow('Insufficient');
    fakeRpc({ decimals: '0x12' });
    await expect(simulateReadOnlyMainnetIntent(FROM, TO, '0.25')).rejects.toThrow('decimals');
  });
});
