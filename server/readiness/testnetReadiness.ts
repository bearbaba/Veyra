/**
 * Hosted testnet infrastructure gate. Do NOT confuse infrastructure
 * availability with provider activation or a user-signed testnet E2E.
 *
 * The Mainnet KMS/provider catalog gate is intentionally NOT reused here:
 * Arc/Ethereum/Base Sepolia have separate chain IDs and acceptance rules.
 */
import { MANIFEST_CONSTANTS } from '../../src/providers/registry/providerManifest.js';
import { validateServerRuntimeConfig } from '../config/runtimeConfig.js';
import type { DatabaseReadinessReport } from './databaseReadiness.js';

export const REQUIRED_TESTNET_RPCS = [
  { id: 'arc', envKey: 'ARC_TESTNET_RPC_URL', chainId: MANIFEST_CONSTANTS.ARC_TESTNET_CHAIN_ID },
  { id: 'eth-sepolia', envKey: 'ETH_SEPOLIA_RPC_URL', chainId: MANIFEST_CONSTANTS.ETH_SEPOLIA_CHAIN_ID },
  { id: 'base-sepolia', envKey: 'BASE_SEPOLIA_RPC_URL', chainId: MANIFEST_CONSTANTS.BASE_SEPOLIA_CHAIN_ID },
] as const;

export interface TestnetRpcCheck {
  id: string;
  chainId: number;
  ok: boolean;
  detail: string;
}

export interface TestnetReadinessReport {
  ready: boolean;
  scope: 'infrastructure-only';
  environment: 'testnet';
  financialAcceptanceReady: false;
  checks: Array<{ id: string; ok: boolean; detail: string }>;
  capabilities: {
    walletSessions: 'requires-live-acceptance';
    directPay: 'requires-signed-e2e';
    convert: 'disabled-pending-e2e';
    cctpBridge: 'requires-signed-e2e';
    aiAgent: 'requires-live-acceptance';
    activity: 'requires-owner-session-e2e';
  };
}

const CHECK_TIMEOUT_MS = 4_000;
function publicError(error: unknown): string {
  // Never echo a fetch URL, hostname, credentials, query string or
  // RPC error body into the unauthenticated health API.
  if (error instanceof DOMException && error.name === 'AbortError') return 'Timed out.';
  return 'RPC unavailable or returned an invalid response.';
}

export async function probeTestnetRpcEndpoints(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<TestnetRpcCheck[]> {
  return Promise.all(REQUIRED_TESTNET_RPCS.map(async ({ id, envKey, chainId }) => {
    const url = env[envKey];
    if (!url) return { id, chainId, ok: false, detail: `${envKey} is not configured.` };

    try {
      const parsed = new URL(url);
      const isHttps = parsed.protocol === 'https:';
      const isLocal = env.NODE_ENV !== 'production' &&
        parsed.protocol === 'http:' &&
        ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
      if ((!isHttps && !isLocal) || parsed.username || parsed.password) {
        return { id, chainId, ok: false, detail: `${envKey} must be a secure HTTPS RPC endpoint.` };
      }
    } catch {
      return { id, chainId, ok: false, detail: `${envKey} is not a valid URL.` };
    }

    try {
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
        signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error('Unhealthy status.');
      const raw = await response.json() as unknown;
      if (!raw || typeof raw !== 'object') throw new Error('Invalid RPC body.');
      const body = raw as Record<string, unknown>;
      if (body.error || typeof body.result !== 'string' || !/^0x[0-9a-fA-F]+$/.test(body.result)) {
        throw new Error('Invalid RPC chain ID response.');
      }
      const receivedChain = BigInt(body.result);
      if (receivedChain !== BigInt(chainId)) {
        return { id, chainId, ok: false, detail: 'RPC chain ID does not match the pinned testnet.' };
      }
      return { id, chainId, ok: true, detail: 'Pinned testnet RPC chain ID verified.' };
    } catch (error) {
      return { id, chainId, ok: false, detail: publicError(error) };
    }
  }));
}

export function evaluateTestnetReadiness(
  env: NodeJS.ProcessEnv,
  database: DatabaseReadinessReport,
  rpc: readonly TestnetRpcCheck[],
): TestnetReadinessReport {
  // Only evaluate this on the testnet branch; a mainnet environment must
  // use the separate high-assurance mainnet gate.
  const validConfig = validateServerRuntimeConfig({ ...env, VEYRA_ENV: 'testnet' });
  const configuredAsTestnet = env.VEYRA_ENV === 'testnet';
  const checks: TestnetReadinessReport['checks'] = [
    {
      id: 'testnet-runtime-config',
      ok: configuredAsTestnet && validConfig.ok,
      detail: !configuredAsTestnet
        ? 'VEYRA_ENV must explicitly be testnet.'
        : validConfig.ok
          ? 'Testnet runtime configuration passes its deployment gate.'
          : 'Testnet runtime configuration is not valid.',
    },
    {
      id: 'phase5-postgresql',
      ok: database.ready,
      detail: database.ready
        ? 'PostgreSQL and Phase 5 migration 0012 are ready.'
        : 'PostgreSQL or required Phase 5 schema/migrations are not ready.',
    },
  ];
  for (const target of REQUIRED_TESTNET_RPCS) {
    const observed = rpc.filter((record) => record.id === target.id && record.chainId === target.chainId);
    checks.push({
      id: `testnet-rpc-${target.id}`,
      ok: observed.length === 1 && observed[0].ok,
      detail: observed.length === 1 ? observed[0].detail : 'Matching testnet RPC check was not performed.',
    });
  }
  return {
    ready: checks.every((check) => check.ok),
    scope: 'infrastructure-only',
    environment: 'testnet',
    financialAcceptanceReady: false,
    checks,
    capabilities: {
      walletSessions: 'requires-live-acceptance',
      directPay: 'requires-signed-e2e',
      convert: 'disabled-pending-e2e',
      cctpBridge: 'requires-signed-e2e',
      aiAgent: 'requires-live-acceptance',
      activity: 'requires-owner-session-e2e',
    },
  };
}
