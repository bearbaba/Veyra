import { describe, expect, it } from 'vitest';
import { MAINNET_CHAIN_CATALOG } from '../config/mainnetCatalog.js';
import { probeRpcEndpoint, refreshMainnetProviderHealth } from '../../server/services/providerHealthService.js';

function mockFetch(result: unknown, status = 200): typeof fetch {
  return (() =>
    Promise.resolve(
      new Response(JSON.stringify(result), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    ));
}

describe('Phase 3B provider runtime health', () => {
  it('verifies RPC chain identity before marking an endpoint healthy', async () => {
    const chain = MAINNET_CHAIN_CATALOG[0];
    const result = await probeRpcEndpoint(chain, { [chain.rpcEnvKey]: 'https://rpc.example.com' }, mockFetch({ jsonrpc: '2.0', id: 1, result: '0x' + chain.chainId.toString(16) }));
    expect(result.ok).toBe(true);
  });

  it('rejects an RPC that answers for the wrong chain', async () => {
    const chain = MAINNET_CHAIN_CATALOG[0];
    const result = await probeRpcEndpoint(chain, { [chain.rpcEnvKey]: 'https://rpc.example.com' }, mockFetch({ jsonrpc: '2.0', id: 1, result: '0x2105' }));
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('chainId mismatch');
  });

  it('keeps provider health UNKNOWN when no mainnet RPC is configured', async () => {
    const report = await refreshMainnetProviderHealth({}, mockFetch({}));
    expect(report.providerRecords.length).toBeGreaterThan(0);
    expect(report.providerRecords.every((record) => record.status === 'UNKNOWN')).toBe(true);
  });

  it('rejects malformed chain IDs and non-HTTPS RPC endpoints', async () => {
    const chain = MAINNET_CHAIN_CATALOG[0];
    const malformed = await probeRpcEndpoint(chain, { [chain.rpcEnvKey]: 'https://rpc.example.com' }, mockFetch({ result: '0x13garbage' }));
    expect(malformed.ok).toBe(false);
    const insecure = await probeRpcEndpoint(chain, { [chain.rpcEnvKey]: 'http://rpc.example.com' }, mockFetch({ result: '0x13b2' }));
    expect(insecure.ok).toBe(false);
    expect(insecure.detail).toContain('HTTPS');
  });

  it('never marks all-chain providers healthy when only Ethereum RPC works', async () => {
    const report = await refreshMainnetProviderHealth(
      { ETHEREUM_RPC_URL: 'https://rpc.example.com' },
      mockFetch({ jsonrpc: '2.0', id: 1, result: '0x1' }),
    );
    expect(report.providerRecords.every((record) => record.status !== 'OK')).toBe(true);
    expect(report.providerRecords.some((record) => record.status === 'DEGRADED')).toBe(true);
  });

  it('only marks mainnet providers OK when every required RPC answers for its own chain', async () => {
    const env: NodeJS.ProcessEnv = {};
    for (const chain of MAINNET_CHAIN_CATALOG) env[chain.rpcEnvKey] = 'https://rpc-' + chain.chainId + '.example.com';
    const multiChainFetch = ((input: RequestInfo | URL) => {
      const chainId = Number(String(input).match(/rpc-(\d+)/)?.[1] ?? NaN);
      return Promise.resolve(new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0x' + chainId.toString(16) }), { status: 200 }));
    }) as typeof fetch;
    const report = await refreshMainnetProviderHealth(env, multiChainFetch);
    expect(report.rpc).toHaveLength(MAINNET_CHAIN_CATALOG.length);
    expect(report.providerRecords.length).toBeGreaterThan(0);
    expect(report.providerRecords.every((record) => record.status === 'OK')).toBe(true);
  });

});
