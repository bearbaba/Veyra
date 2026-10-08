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
    const result = await probeRpcEndpoint(chain, { [chain.rpcEnvKey]: 'https://rpc.example.com' }, mockFetch({ jsonrpc: '2.0', id: 1, result: '0x1' }));
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
});
