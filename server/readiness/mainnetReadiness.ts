import type { ProviderManifestEntry } from '../../src/providers/registry/providerTypes.js';
import { validateServerRuntimeConfig } from '../config/runtimeConfig.js';

export interface ReadinessCheck { id: string; ok: boolean; detail: string; }
export interface MainnetReadinessReport { ready: boolean; checks: ReadinessCheck[]; }

export function evaluateMainnetReadiness(
  env: NodeJS.ProcessEnv,
  providers: ProviderManifestEntry[],
): MainnetReadinessReport {
  const runtime = validateServerRuntimeConfig({ ...env, VEYRA_ENV: 'mainnet' });
  const mainnetProviders = providers.filter((p) => p.environment === 'mainnet' || p.environment === 'all');
  const executableMainnetProviders = mainnetProviders.filter((p) => p.enabled && p.lifecycleStage === 'ENABLED');
  const unverifiedEnabled = executableMainnetProviders.filter((p) => p.trustStatus === 'UNVERIFIED' || p.healthStatus === 'UNKNOWN');

  const checks: ReadinessCheck[] = [
    { id: 'runtime-config', ok: runtime.ok, detail: runtime.ok ? 'Production runtime configuration passes safety gates.' : runtime.errors.join(' ') },
    { id: 'mainnet-provider-present', ok: executableMainnetProviders.length > 0, detail: executableMainnetProviders.length > 0 ? `${executableMainnetProviders.length} executable mainnet provider(s) registered.` : 'No ENABLED mainnet provider is registered.' },
    { id: 'provider-verification', ok: unverifiedEnabled.length === 0, detail: unverifiedEnabled.length === 0 ? 'No enabled mainnet provider is unverified/unknown.' : `Unsafe providers: ${unverifiedEnabled.map((p) => p.providerId).join(', ')}` },
  ];

  return { ready: checks.every((c) => c.ok), checks };
}
