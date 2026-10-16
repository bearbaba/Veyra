import { afterEach, describe, expect, it, vi } from 'vitest';
import { encodeFunctionData, parseAbi, toEventSelector } from 'viem';
import {
  ARC_MAINNET_CHAIN_ID, ARC_MAINNET_USDC, MAX_MAINNET_CANARY_UNITS,
  assertArcMainnetCatalog, assertArcMainnetNetwork, buildMainnetPayPlan,
  mainnetPreflight, reserveGasInUsdcUnits, reconcileMainnetCanary,
  requestMainnetCanaryTransfer, type MainnetWallet,
} from '../mainnet/arcMainnetPay';
import {
  mainnetJournalKey, readMainnetJournal, writeMainnetJournal, clearMainnetJournal,
} from '../mainnet/arcMainnetJournal';

const FROM = '0x1111111111111111111111111111111111111111';
const TO = '0x2222222222222222222222222222222222222222';
const HASH = `0x${'a'.repeat(64)}`;
const BLOCK = `0x${'b'.repeat(64)}`;
const DATA = encodeFunctionData({
  abi: parseAbi(['function transfer(address to,uint256 amount) returns (bool)']),
  functionName: 'transfer', args: [TO, 250_000n],
});
const plan = () => buildMainnetPayPlan(FROM, TO, '0.25');
const defaults: Record<string, unknown> = {
  eth_chainId: '0x13b2',
  eth_call: '0x1',
  eth_estimateGas: '0xc350',
  eth_gasPrice: '0x3b9aca00',
};
function rpc(results: Record<string, unknown> = {}, overrides?: { balance?: string; decimals?: string; simulation?: string }) {
  const calls: string[] = [];
  const mock = vi.fn((_url: unknown, options: unknown) => {
    const request = JSON.parse((options as { body: string }).body) as {
      method: string; params: unknown[];
    };
    calls.push(request.method);
    let result = results[request.method] ?? defaults[request.method];
    if (request.method === 'eth_call') {
      const args = request.params[0] as { data: string };
      if (args.data === '0x313ce567') result = overrides?.decimals ?? '0x6';
      else if (args.data.startsWith('0x70a08231')) result = overrides?.balance ?? '0x989680';
      else result = overrides?.simulation ?? '0x1';
    }
    return Promise.resolve({ ok: true,
      json: () => Promise.resolve({ jsonrpc: '2.0', id: 1, result }) });
  });
  vi.stubGlobal('fetch', mock);
  return { calls, mock };
}
function wallet(overrides: { chain?: string; accounts?: string[]; hash?: string } = {}) {
  const calls: string[] = [];
  const provider: MainnetWallet = { request: ({ method }) => {
    calls.push(method);
    if (method === 'eth_chainId') return Promise.resolve(overrides.chain ?? '0x13b2');
    if (method === 'eth_accounts') return Promise.resolve(overrides.accounts ?? [FROM]);
    if (method === 'eth_sendTransaction') return Promise.resolve(overrides.hash ?? HASH);
    return Promise.reject(new Error('Unexpected wallet request'));
  } };
  return { provider, calls };
}
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('Phase 6 — isolated Arc Mainnet USDC canary', () => {
  it('requires the reviewed Arc 5042 catalog and canonical ERC-20 USDC', () => {
    expect(() => assertArcMainnetCatalog()).not.toThrow();
    expect(ARC_MAINNET_CHAIN_ID).toBe(5042);
    expect(ARC_MAINNET_USDC).toBe('0x3600000000000000000000000000000000000000');
    expect(MAX_MAINNET_CANARY_UNITS).toBe(1_000_000n);
    const p = plan();
    expect(p.units).toBe(250_000n);
    expect(p.data).toBe(DATA);
  });
  it('blocks bad recipients, self-sends, zero amounts and unbounded precision', () => {
    for (const amount of ['0', '1.000001', '5', '0.0000001', '-1', '1e0', '0xff', 'NaN', '2.']) {
      expect(() => buildMainnetPayPlan(FROM, TO, amount)).toThrow();
    }
    for (const destination of [FROM, '0x0', '0x0000000000000000000000000000000000000000', '@name']) {
      expect(() => buildMainnetPayPlan(FROM, destination, '0.1')).toThrow();
    }
    expect(buildMainnetPayPlan(FROM, TO, '0.000001').units).toBe(1n);
    expect(buildMainnetPayPlan(FROM, TO, '1').units).toBe(MAX_MAINNET_CANARY_UNITS);
  });
  it('enforces the native 18 / ERC-20 6 decimals gas reserve against ONE shared balance', () => {
    expect(reserveGasInUsdcUnits(50_000n, 1_000_000_000n)).toBe(100n);
    expect(() => reserveGasInUsdcUnits(0n, 1n)).toThrow();
  });
  it('requires correct public RPC chain, real token decimals, gas and simulation', async () => {
    rpc();
    const w = wallet();
    const good = await mainnetPreflight(w.provider, plan());
    expect(good.balance).toBe(10_000_000n);
    expect(good.feeReserveUnits).toBe(100n);
    rpc({ eth_chainId: '0x1' });
    await expect(assertArcMainnetNetwork()).rejects.toThrow('RPC network mismatch');
    const wrong = wallet({ chain: '0x1' });
    rpc();
    await expect(mainnetPreflight(wrong.provider, plan())).rejects.toThrow('Switch your wallet');
    rpc({}, { decimals: '0x12' });
    await expect(mainnetPreflight(w.provider, plan())).rejects.toThrow('decimals mismatch');
    rpc({}, { simulation: '0x0' });
    await expect(mainnetPreflight(w.provider, plan())).rejects.toThrow('simulation did not approve');
    rpc({}, { balance: '0x1' });
    await expect(mainnetPreflight(w.provider, plan())).rejects.toThrow('Insufficient');
  });
  it('never reaches a wallet signature RPC when release gate is disabled', async () => {
    vi.stubEnv('VITE_VEYRA_MAINNET_PAY', '0');
    rpc();
    const w = wallet();
    await expect(requestMainnetCanaryTransfer(w.provider, plan(), () => undefined)).rejects.toThrow('disabled');
    expect(w.calls).not.toContain('eth_sendTransaction');
  });
  it('when explicitly release-enabled, requests exactly one pinned transfer after fresh preflight', async () => {
    vi.stubEnv('VITE_VEYRA_MAINNET_PAY', '1');
    const { calls: rpcCalls } = rpc();
    const walletCalls: Array<{ method: string; params?: readonly unknown[] }> = [];
    const provider: MainnetWallet = {
      request: (args) => {
        walletCalls.push(args);
        if (args.method === 'eth_chainId') return Promise.resolve('0x13b2');
        if (args.method === 'eth_accounts') return Promise.resolve([FROM]);
        if (args.method === 'eth_sendTransaction') return Promise.resolve(HASH);
        return Promise.reject(new Error('unexpected wallet method'));
      },
    };
    let prompts = 0;
    await expect(requestMainnetCanaryTransfer(provider, plan(), () => { prompts++; })).resolves.toBe(HASH);
    expect(prompts).toBe(1);
    expect(walletCalls.map(x => x.method)).toEqual([
      'eth_chainId', 'eth_accounts', 'eth_chainId', 'eth_accounts', 'eth_sendTransaction',
    ]);
    expect(walletCalls.filter(x => x.method === 'eth_sendTransaction')).toEqual([{
      method: 'eth_sendTransaction',
      params: [{ from: FROM, to: ARC_MAINNET_USDC, data: DATA, value: '0x0' }],
    }]);
    expect(rpcCalls.filter(x => x === 'eth_chainId')).toHaveLength(2);
    // Chain/account replacement is detected before the wallet can submit.
    const other = wallet({ accounts: [TO] });
    await expect(requestMainnetCanaryTransfer(other.provider, plan(), () => undefined)).rejects.toThrow('changed');
    expect(other.calls).not.toContain('eth_sendTransaction');
  });
  it('rejects tampered reviewed plans before any wallet request', async () => {
    const original = plan();
    for (const changed of [
      { ...original, units: 500_000n },
      { ...original, data: '0x1234' as typeof original.data },
      { ...original, token: TO as typeof original.token },
      { ...original, amount: '0.5' },
    ]) {
      const w = wallet();
      await expect(mainnetPreflight(w.provider, changed)).rejects.toThrow('changed');
      expect(w.calls).toEqual([]);
    }
  });
  it('only accepts actual recipient-matched USDC Transfer on a canonical successful receipt', async () => {
    const transaction = { hash: HASH, from: FROM, to: ARC_MAINNET_USDC,
      value: '0x0', input: DATA };
    const log = { address: ARC_MAINNET_USDC, topics: [
      toEventSelector('Transfer(address,address,uint256)'),
      `0x${FROM.slice(2).padStart(64,'0')}`,
      `0x${TO.slice(2).padStart(64,'0')}`,
    ], data: '0x3d090' };
    const receipt = { transactionHash: HASH, blockHash: BLOCK, blockNumber: '0x10',
      status: '0x1', gasUsed: '0xc350', effectiveGasPrice: '0x3b9aca00', logs: [log] };
    const valid = {
      eth_getTransactionByHash: transaction,
      eth_getTransactionReceipt: receipt,
      eth_getBlockByNumber: { hash: BLOCK },
    };
    rpc(valid);
    await expect(reconcileMainnetCanary(plan(), HASH)).resolves.toMatchObject({
      state: 'VERIFIED', blockNumber: 16n, hash: HASH,
    });
    rpc({ ...valid, eth_getTransactionReceipt: { ...receipt, logs: [] } });
    await expect(reconcileMainnetCanary(plan(), HASH)).rejects.toThrow('no matching USDC Transfer');
    rpc({ ...valid, eth_getTransactionByHash: { ...transaction, to: TO } });
    await expect(reconcileMainnetCanary(plan(), HASH)).rejects.toThrow('differs from');
    rpc({ ...valid, eth_getBlockByNumber: { hash: HASH } });
    await expect(reconcileMainnetCanary(plan(), HASH)).rejects.toThrow('block hash');
    rpc({ ...valid, eth_getTransactionReceipt: null });
    await expect(reconcileMainnetCanary(plan(), HASH)).resolves.toMatchObject({ state: 'PENDING', indexed: true });
    rpc({ ...valid, eth_getTransactionReceipt: { ...receipt, status: '0x0', logs: [] } });
    await expect(reconcileMainnetCanary(plan(), HASH)).resolves.toMatchObject({ state: 'REVERTED' });
  });
  it('never uses the testnet journal namespace and fails closed on malformed storage', () => {
    const memory = new Map<string,string>();
    const storage = {
      getItem: (k: string) => memory.get(k) ?? null,
      setItem: (k: string, v: string) => { memory.set(k,v); },
      removeItem: (k: string) => { memory.delete(k); },
    };
    expect(mainnetJournalKey(FROM)).toContain('mainnet-5042');
    expect(readMainnetJournal(FROM,storage).kind).toBe('empty');
    expect(writeMainnetJournal({ from: FROM, to: TO, amount: '0.25', hash: null, stage: 'UNKNOWN' },storage)).toBe(true);
    expect(readMainnetJournal(FROM,storage).kind).toBe('active');
    memory.set(mainnetJournalKey(FROM), '{corrupted');
    expect(readMainnetJournal(FROM,storage).kind).toBe('blocked');
    expect(clearMainnetJournal(FROM,storage)).toBe(true);
  });
});
