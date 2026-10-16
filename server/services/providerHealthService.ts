import { MAINNET_CHAIN_CATALOG } from '../../src/config/mainnetCatalog.js';
import { getAllProviders, updateProviderHealth } from '../../src/providers/registry/providerRegistry.js';
import type { ProviderHealthRecord, ProviderHealthStatus } from '../../src/providers/registry/providerTypes.js';

export interface RpcProbeResult {
  chainId: number;
  name: string;
  configured: boolean;
  ok: boolean;
  latencyMs?: number;
  detail: string;
}

export interface ProviderHealthProbeReport {
  checkedAt: number;
  rpc: RpcProbeResult[];
  providerRecords: ProviderHealthRecord[];
}

type FetchLike = typeof fetch;

function classifyRpcCoverage(results: RpcProbeResult[]): ProviderHealthStatus {
  if (results.length === 0 || results.every((r) => !r.configured)) return 'UNKNOWN';
  const okCount = results.filter((r) => r.configured && r.ok).length;
  // Missing endpoints are unhealthy too: a single working chain must never
  // make a multichain money-moving provider look production-ready.
  if (okCount === results.length) return 'OK';
  if (okCount === 0) return 'DOWN';
  return 'DEGRADED';
}

export async function probeRpcEndpoint(
  chain: (typeof MAINNET_CHAIN_CATALOG)[number],
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: FetchLike = fetch,
): Promise<RpcProbeResult> {
  const rpcUrl = env[chain.rpcEnvKey];
  if (!rpcUrl) {
    return { chainId: chain.chainId, name: chain.name, configured: false, ok: false, detail: `${chain.rpcEnvKey} is not configured.` };
  }
  const startedAt = Date.now();
  try {
    if (new URL(rpcUrl).protocol !== 'https:') throw new Error('RPC must use HTTPS.');
    const response = await fetchImpl(rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
      signal: AbortSignal.timeout(4_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.json() as { result?: string; error?: unknown };
    if (body.error || typeof body.result !== 'string' || !/^0x[0-9a-fA-F]+$/.test(body.result)) {
      throw new Error('RPC returned an invalid eth_chainId response.');
    }
    const observed = Number.parseInt(body.result, 16);
    if (observed !== chain.chainId) throw new Error(`chainId mismatch: expected ${chain.chainId}.`);
    return { chainId: chain.chainId, name: chain.name, configured: true, ok: true, latencyMs: Date.now() - startedAt, detail: 'RPC responded with expected chainId.' };
  } catch (error) {
    return {
      chainId: chain.chainId,
      name: chain.name,
      configured: true,
      ok: false,
      latencyMs: Date.now() - startedAt,
      // Do not echo provider URLs or thrown HTTP errors: RPC URLs often hold API keys.
      detail: error instanceof Error && (error.message.startsWith('chainId mismatch:') || error.message === 'RPC must use HTTPS.' || error.message === 'RPC returned an invalid eth_chainId response.')
        ? error.message : 'RPC health probe failed.',
    };
  }
}

export async function refreshMainnetProviderHealth(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: FetchLike = fetch,
): Promise<ProviderHealthProbeReport> {
  const checkedAt = Date.now();
  const rpc = await Promise.all(MAINNET_CHAIN_CATALOG.map((chain) => probeRpcEndpoint(chain, env, fetchImpl)));
  const rpcByChain = new Map(rpc.map((record) => [record.chainId, record]));
  const providerRecords = getAllProviders()
    .filter((provider) => provider.environment === 'mainnet' || provider.environment === 'all')
    .map<ProviderHealthRecord>((provider) => {
      const requiredRpc = provider.supportedChainIds.map((chainId) => rpcByChain.get(chainId) ?? {
        chainId, name: `chain ${chainId}`, configured: false, ok: false, detail: 'Unsupported mainnet RPC chain.',
      });
      const status = classifyRpcCoverage(requiredRpc);
      const passing = requiredRpc.filter((record) => record.ok && record.configured).length;
      return { providerId: provider.providerId, status, checkedAt,
        detail: `Required mainnet RPC coverage ${passing}/${requiredRpc.length} healthy.` };
    });
  for (const record of providerRecords) updateProviderHealth(record);
  return { checkedAt, rpc, providerRecords };
}
