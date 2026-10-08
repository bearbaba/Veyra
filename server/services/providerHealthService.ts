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
  const configured = results.filter((r) => r.configured);
  if (configured.length === 0) return 'UNKNOWN';
  const okCount = configured.filter((r) => r.ok).length;
  if (okCount === configured.length) return 'OK';
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
    const response = await fetchImpl(rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
      signal: AbortSignal.timeout(4_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.json() as { result?: string; error?: unknown };
    const observed = body.result ? Number.parseInt(body.result, 16) : NaN;
    if (observed !== chain.chainId) throw new Error(`chainId mismatch: expected ${chain.chainId}, got ${body.result ?? 'missing'}`);
    return { chainId: chain.chainId, name: chain.name, configured: true, ok: true, latencyMs: Date.now() - startedAt, detail: 'RPC responded with expected chainId.' };
  } catch (error) {
    return {
      chainId: chain.chainId,
      name: chain.name,
      configured: true,
      ok: false,
      latencyMs: Date.now() - startedAt,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function refreshMainnetProviderHealth(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: FetchLike = fetch,
): Promise<ProviderHealthProbeReport> {
  const checkedAt = Date.now();
  const rpc = await Promise.all(MAINNET_CHAIN_CATALOG.map((chain) => probeRpcEndpoint(chain, env, fetchImpl)));
  const status = classifyRpcCoverage(rpc);
  const detail = `Mainnet RPC coverage ${rpc.filter((r) => r.ok).length}/${rpc.filter((r) => r.configured).length || 0} configured endpoints healthy.`;
  const providerRecords = getAllProviders()
    .filter((provider) => provider.environment === 'mainnet' || provider.environment === 'all')
    .map<ProviderHealthRecord>((provider) => ({ providerId: provider.providerId, status, checkedAt, detail }));
  for (const record of providerRecords) updateProviderHealth(record);
  return { checkedAt, rpc, providerRecords };
}
