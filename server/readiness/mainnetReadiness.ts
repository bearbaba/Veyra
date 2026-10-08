import type { ProviderHealthRecord, ProviderManifestEntry } from '../../src/providers/registry/providerTypes.js';
import type { DatabaseReadinessReport } from './databaseReadiness.js';
import type { SignerReadinessReport } from './signerReadiness.js';
import { SECURITY_CONFIG } from '../../src/lib/securityConfig.js';
import { validateServerRuntimeConfig } from '../config/runtimeConfig.js';

export interface ReadinessCheck { id: string; ok: boolean; detail: string; }
export interface MainnetReadinessReport { ready: boolean; checks: ReadinessCheck[]; }

export interface MainnetReadinessContext {
  database?: DatabaseReadinessReport;
  providerHealth?: ProviderHealthRecord[];
  signer?: SignerReadinessReport;
  now?: number;
}

export function evaluateMainnetReadiness(
  env: NodeJS.ProcessEnv,
  providers: ProviderManifestEntry[],
  context: MainnetReadinessContext = {},
): MainnetReadinessReport {
  const runtime = validateServerRuntimeConfig({ ...env, VEYRA_ENV: 'mainnet' });
  const mainnetProviders = providers.filter((p) => p.environment === 'mainnet' || p.environment === 'all');
  const executableMainnetProviders = mainnetProviders.filter((p) => p.enabled && p.lifecycleStage === 'ENABLED');
  const unverifiedEnabled = executableMainnetProviders.filter((p) => p.trustStatus === 'UNVERIFIED');
  const now = context.now ?? Date.now();
  const freshHealthByProvider = new Map((context.providerHealth ?? []).map((record) => [record.providerId, record]));
  const unhealthyEnabled = executableMainnetProviders.filter((provider) => {
    const health = freshHealthByProvider.get(provider.providerId);
    const stale = !health || now - health.checkedAt > SECURITY_CONFIG.MAX_PROVIDER_HEALTH_AGE_MS;
    return stale || health.status === 'UNKNOWN' || health.status === 'DOWN';
  });

  const checks: ReadinessCheck[] = [
    { id: 'runtime-config', ok: runtime.ok, detail: runtime.ok ? 'Production runtime configuration passes safety gates.' : runtime.errors.join(' ') },
    {
      id: 'signer-readiness',
      ok: context.signer?.ready === true,
      detail: context.signer?.ready ? 'Production KMS/HSM signer gateway is configured and healthy.' : 'Production signer verification has not passed.',
    },
    {
      id: 'database-readiness',
      ok: context.database?.ready === true,
      detail: context.database?.ready
        ? 'Production database connectivity, schema, and migration history are verified.'
        : 'Production database verification has not passed.',
    },
    {
      id: 'mainnet-provider-catalog',
      ok: mainnetProviders.length > 0,
      detail: mainnetProviders.length > 0 ? `${mainnetProviders.length} mainnet provider candidate(s) registered.` : 'No mainnet provider candidate is registered.',
    },
    { id: 'mainnet-provider-present', ok: executableMainnetProviders.length > 0, detail: executableMainnetProviders.length > 0 ? `${executableMainnetProviders.length} executable mainnet provider(s) registered.` : 'No ENABLED mainnet provider is registered.' },
    { id: 'provider-verification', ok: unverifiedEnabled.length === 0, detail: unverifiedEnabled.length === 0 ? 'No enabled mainnet provider is unverified.' : `Unsafe providers: ${unverifiedEnabled.map((p) => p.providerId).join(', ')}` },
    { id: 'provider-runtime-health', ok: executableMainnetProviders.length > 0 && unhealthyEnabled.length === 0, detail: executableMainnetProviders.length === 0 ? 'No executable mainnet providers yet; runtime health gate remains closed.' : unhealthyEnabled.length === 0 ? 'All executable mainnet providers have fresh healthy runtime records.' : `Unhealthy or stale providers: ${unhealthyEnabled.map((p) => p.providerId).join(', ')}` },
  ];

  return { ready: checks.every((c) => c.ok), checks };
}
