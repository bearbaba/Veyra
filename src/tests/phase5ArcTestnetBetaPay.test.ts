import { afterEach, describe, expect, it, vi } from 'vitest';
import { encodeFunctionData, parseAbi, toEventSelector } from 'viem';
import {
  ARC_TESTNET_CHAIN_ID, MAX_TESTNET_PAYMENT_UNITS, ARC_PAY_FINALITY_CONFIRMATIONS, arcPayExplorerUrl,
  assertArcRpcChain, createArcTestnetPayPlan, reconcileArcTestnetPay,
  submitArcTestnetPay,
} from '../preview/arcTestnetPay';
import type { InjectedPreviewProvider } from '../preview/PreviewWallet';

const SENDER = '0x1111111111111111111111111111111111111111';
const RECIPIENT = '0x2222222222222222222222222222222222222222';
const CONTRACT = '0x3600000000000000000000000000000000000000';
const HASH = `0x${'a'.repeat(64)}`;
const BLOCK_HASH = `0x${'b'.repeat(64)}`;
const transferAbi = parseAbi(['function transfer(address to,uint256 amount) returns (bool)']);

afterEach(() => vi.unstubAllGlobals());

function rpc(results: Record<string, unknown>) {
  const called: string[] = [];
  const fetchMock = vi.fn((_url: unknown, options: unknown) => {
    const body = (options as { body: string }).body;
    const request = JSON.parse(body) as { method: string };
    called.push(request.method);
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ jsonrpc: '2.0', id: 1, result: results[request.method] }),
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { called, fetchMock };
}

function wallet(config: { chain?: string; accounts?: string[]; hash?: unknown } = {}) {
  const methods: string[] = [];
  const provider: InjectedPreviewProvider = {
    request: ({ method }) => {
      methods.push(method);
      if (method === 'eth_chainId') return Promise.resolve(config.chain ?? `0x${ARC_TESTNET_CHAIN_ID.toString(16)}`);
      if (method === 'eth_accounts') return Promise.resolve(config.accounts ?? [SENDER]);
      if (method === 'eth_sendTransaction') return Promise.resolve(config.hash ?? HASH);
      return Promise.reject(new Error('unexpected wallet RPC'));
    },
  };
  return { methods, provider };
}

const plan = () => createArcTestnetPayPlan(SENDER, RECIPIENT, '0.25');

describe('real Arc Testnet-only wallet-signed USDC beta', () => {
  it('pins correct chain 5042002, canonical Arc USDC, decimals and 1 token cap', () => {
    const p = plan();
    expect(p.token.toLowerCase()).toBe(CONTRACT);
    expect(p.units).toBe(250_000n);
    expect(MAX_TESTNET_PAYMENT_UNITS).toBe(1_000_000n);
    expect(p.data).toBe(encodeFunctionData({ abi: transferAbi, functionName: 'transfer', args: [RECIPIENT, 250_000n] }));
    expect(createArcTestnetPayPlan(SENDER, RECIPIENT, '0.000001').units).toBe(1n);
    expect(createArcTestnetPayPlan(SENDER, RECIPIENT, '1').units).toBe(MAX_TESTNET_PAYMENT_UNITS);
  });

  it('blocks amounts larger than cap, zero, too many decimals and malformed recipients', () => {
    for (const amount of ['1.000001', '10', '100', '0', '0.0', '-1', '1.0000001', 'NaN', 'Infinity', '2e0']) {
      expect(() => createArcTestnetPayPlan(SENDER, RECIPIENT, amount)).toThrow();
    }
    for (const recipient of ['@veyra', '0x1234', SENDER, '0x0000000000000000000000000000000000000000']) {
      expect(() => createArcTestnetPayPlan(SENDER, recipient, '0.1')).toThrow();
    }
    expect(() => createArcTestnetPayPlan(RECIPIENT, SENDER, '0.25')).not.toThrow();
  });


  it('rejects stale or malformed JSON-RPC replies before payment verification', async () => {
    const chain = `0x${ARC_TESTNET_CHAIN_ID.toString(16)}`;
    const rejected: unknown[] = [
      { jsonrpc: '2.0', id: 2, result: chain },
      { jsonrpc: '1.0', id: 1, result: chain },
      { jsonrpc: '2.0', id: '1', result: chain },
      { jsonrpc: '2.0', id: 1, error: { message: 'private-provider-key=123' } },
      { jsonrpc: '2.0', id: 1 },
      [ { jsonrpc: '2.0', id: 1, result: chain } ],
      null,
    ];
    for (const reply of rejected) {
      vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
        ok: true, json: () => Promise.resolve(reply),
      })));
      await expect(assertArcRpcChain()).rejects.toThrow('Arc RPC returned an untrusted response.');
    }
  });

  it('rejects tampered reviewed payment plans before wallet signing or recovery', async () => {
    const original = plan();
    const modified = [
      { ...original, amount: '0.5' },
      { ...original, units: 500_000n },
      { ...original, token: RECIPIENT as typeof original.token },
      { ...original, to: '0x3333333333333333333333333333333333333333' as typeof original.to },
      { ...original, data: `${original.data}00` as typeof original.data },
    ];
    for (const attempt of modified) {
      const w = wallet();
      await expect(submitArcTestnetPay(w.provider, attempt)).rejects.toThrow('Payment details changed since review.');
      await expect(reconcileArcTestnetPay(attempt, HASH)).rejects.toThrow('Payment details changed since review.');
      expect(w.methods).toEqual([]);
    }
  });

  it('requires independent Arc RPC + wallet chain/account + balance before ONE user-sign RPC', async () => {
    const { called } = rpc({ eth_chainId: `0x${ARC_TESTNET_CHAIN_ID.toString(16)}`, eth_call: '0x4c4b40' });
    const w = wallet();
    await expect(submitArcTestnetPay(w.provider, plan())).resolves.toBe(HASH);
    expect(w.methods).toEqual(['eth_chainId', 'eth_accounts', 'eth_sendTransaction']);
    expect(called).toEqual(['eth_chainId', 'eth_call']);
  });

  it('fails closed before signing if RPC or wallet is on another chain', async () => {
    rpc({ eth_chainId: '0x1', eth_call: '0x4c4b40' });
    await expect(assertArcRpcChain()).rejects.toThrow(/unexpected network/);
    const w = wallet();
    await expect(submitArcTestnetPay(w.provider, plan())).rejects.toThrow(/unexpected network/);
    expect(w.methods).not.toContain('eth_sendTransaction');
    const actual = rpc({ eth_chainId: `0x${ARC_TESTNET_CHAIN_ID.toString(16)}`, eth_call: '0x4c4b40' });
    const wrong = wallet({ chain: '0x1' });
    await expect(submitArcTestnetPay(wrong.provider, plan())).rejects.toThrow(/Switch your wallet/);
    expect(wrong.methods).not.toContain('eth_sendTransaction');
    expect(actual.called).toEqual(['eth_chainId']);
  });

  it('fails closed on unexpected wallet account or not enough USDC', async () => {
    rpc({ eth_chainId: `0x${ARC_TESTNET_CHAIN_ID.toString(16)}`, eth_call: '0x0' });
    const w = wallet({ accounts: [RECIPIENT] });
    await expect(submitArcTestnetPay(w.provider, plan())).rejects.toThrow(/Wallet account changed/);
    const validWallet = wallet();
    await expect(submitArcTestnetPay(validWallet.provider, plan())).rejects.toThrow(/Insufficient testnet USDC/);
    expect(validWallet.methods).not.toContain('eth_sendTransaction');
  });

  it('reconciles a canonical receipt only after exact USDC Transfer log and 12 confirmations', async () => {
    const p = plan();
    const tx = { hash: HASH, from: SENDER, to: CONTRACT, input: p.data };
    const log = {
      address: CONTRACT,
      topics: [
        toEventSelector('Transfer(address,address,uint256)'),
        `0x${SENDER.slice(2).padStart(64, '0')}`,
        `0x${RECIPIENT.slice(2).padStart(64, '0')}`,
      ],
      data: '0x3d090',
    };
    const receipt = { transactionHash: HASH, status: '0x1', blockHash: BLOCK_HASH, blockNumber: '0xc7', logs: [log] };
    const good = {
      eth_chainId: `0x${ARC_TESTNET_CHAIN_ID.toString(16)}`,
      eth_getTransactionByHash: tx, eth_getTransactionReceipt: receipt,
      eth_getBlockByNumber: { hash: BLOCK_HASH }, eth_blockNumber: '0xd2',
    };
    rpc(good);
    await expect(reconcileArcTestnetPay(p, HASH)).resolves.toMatchObject({
      state: 'VERIFIED',
      proof: { txHash: HASH, blockHash: BLOCK_HASH, blockNumber: 199, confirmations: 12 },
    });
    expect(arcPayExplorerUrl(HASH)).toContain('/tx/');
    rpc({ ...good, eth_blockNumber: '0xc7' });
    await expect(reconcileArcTestnetPay(p, HASH)).resolves.toMatchObject({ state: 'PENDING' });
    rpc({ ...good, eth_getTransactionByHash: { ...tx, to: RECIPIENT } });
    await expect(reconcileArcTestnetPay(p, HASH)).rejects.toThrow(/does not match/);
    rpc({ ...good, eth_getTransactionReceipt: { ...receipt, logs: [] } });
    await expect(reconcileArcTestnetPay(p, HASH)).rejects.toThrow(/no matching USDC Transfer/);
    rpc({ ...good, eth_getBlockByNumber: { hash: HASH } });
    await expect(reconcileArcTestnetPay(p, HASH)).rejects.toThrow(/Canonical block hash changed/);
  });

  it('keeps a reverted payment LOCKED until canonical 12-block finality', async () => {
    const p = plan();
    expect(ARC_PAY_FINALITY_CONFIRMATIONS).toBe(12n);
    const tx = { hash: HASH, from: SENDER, to: CONTRACT, input: p.data };
    const receipt = { transactionHash: HASH, status: '0x0', blockHash: BLOCK_HASH, blockNumber: '0xc7', logs: [] };
    const results = {
      eth_chainId: `0x${ARC_TESTNET_CHAIN_ID.toString(16)}`,
      eth_getTransactionByHash: tx,
      eth_getTransactionReceipt: receipt,
      eth_getBlockByNumber: { hash: BLOCK_HASH },
      eth_blockNumber: '0xd1', // 11 confirmations
    };
    rpc(results);
    await expect(reconcileArcTestnetPay(p, HASH)).resolves.toMatchObject({ state: 'PENDING' });
    rpc({ ...results, eth_blockNumber: '0xd2' }); // 12 confirmations
    await expect(reconcileArcTestnetPay(p, HASH)).resolves.toMatchObject({ state: 'REVERTED' });
  });

  it('rejects a reorged or forged reverted receipt instead of unlocking another send', async () => {
    const p = plan();
    const tx = { hash: HASH, from: SENDER, to: CONTRACT, input: p.data };
    const receipt = { transactionHash: HASH, status: '0x0', blockHash: BLOCK_HASH, blockNumber: '0xc7', logs: [] };
    const results = {
      eth_chainId: `0x${ARC_TESTNET_CHAIN_ID.toString(16)}`,
      eth_getTransactionByHash: tx,
      eth_getTransactionReceipt: receipt,
      eth_getBlockByNumber: { hash: HASH },
      eth_blockNumber: '0xd2',
    };
    rpc(results);
    await expect(reconcileArcTestnetPay(p, HASH)).rejects.toThrow(/Canonical block hash changed/);
    rpc({ ...results, eth_getBlockByNumber: null });
    await expect(reconcileArcTestnetPay(p, HASH)).rejects.toThrow(/Canonical block hash changed/);
    rpc({ ...results, eth_getTransactionReceipt: { ...receipt, transactionHash: HASH.replace('a', 'b') } });
    await expect(reconcileArcTestnetPay(p, HASH)).rejects.toThrow(/Receipt identity/);
    rpc({ ...results, eth_getBlockByNumber: { hash: BLOCK_HASH }, eth_blockNumber: '0xc6' });
    await expect(reconcileArcTestnetPay(p, HASH)).resolves.toMatchObject({ state: 'PENDING' });
  });
});
