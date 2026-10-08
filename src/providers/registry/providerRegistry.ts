/**
 * Veyra Provider Registry
 *
 * Runtime registry built from the manifest.
 * Provides:
 * - provider lookup
 * - execution eligibility checks (capability + chain + asset + health + enabled)
 * - health tracking with per-provider override
 * - dependency propagation (a dependent provider's health degrades when its deps degrade)
 *
 * The Agent cannot use an unregistered or disabled provider.
 * Official Circle/Arc status is metadata — it never forces LOW risk or bypasses checks.
 */

import { SECURITY_CONFIG } from '../../lib/securityConfig';
import { findManifestEntry, PROVIDER_MANIFEST } from './providerManifest';
import type {
  ProviderCapability,
  ProviderEligibilityResult,
  ProviderHealthRecord,
  ProviderHealthStatus,
  ProviderManifestEntry,
  ProviderResult,
  ProviderEnvironment,
} from './providerTypes';

// ── Health Store ──────────────────────────────────────────────────────────────

const _healthStore = new Map<string, ProviderHealthRecord>();

/**
 * Update the runtime health for a provider.
 * This is called by the health-check subsystem — not by the Agent.
 */
export function updateProviderHealth(record: ProviderHealthRecord): void {
  _healthStore.set(record.providerId, record);
}

/**
 * Return the effective health for a provider, respecting the health TTL.
 * If the last check is older than MAX_PROVIDER_HEALTH_AGE_MS, returns UNKNOWN.
 */
function effectiveHealth(providerId: string, manifestHealth: ProviderHealthStatus): ProviderHealthStatus {
  const stored = _healthStore.get(providerId);
  if (!stored) {
    // No runtime check — fall back to manifest value, but UNKNOWN if it was already UNKNOWN
    return manifestHealth === 'OK' || manifestHealth === 'DEGRADED' ? manifestHealth : 'UNKNOWN';
  }
  const age = Date.now() - stored.checkedAt;
  if (age > SECURITY_CONFIG.MAX_PROVIDER_HEALTH_AGE_MS) {
    return 'UNKNOWN';
  }
  return stored.status;
}

// ── Registry Lookup ───────────────────────────────────────────────────────────

/**
 * Look up a provider by ID.
 */
export function getProvider(providerId: string): ProviderResult {
  const entry = findManifestEntry(providerId);
  if (!entry) {
    return { found: false, providerId };
  }
  return {
    found: true,
    entry,
    effectiveHealth: effectiveHealth(entry.providerId, entry.healthStatus),
  };
}

/**
 * Return all registered providers.
 */
export function getAllProviders(): ProviderManifestEntry[] {
  return [...PROVIDER_MANIFEST];
}

/**
 * Return all providers for a given capability.
 */
export function getProvidersForCapability(
  capability: ProviderCapability,
): ProviderManifestEntry[] {
  return PROVIDER_MANIFEST.filter((e) => e.capabilities.includes(capability));
}

// ── Execution Eligibility ─────────────────────────────────────────────────────

function environmentMatches(providerEnvironment: ProviderEnvironment, runtimeEnvironment: 'local' | 'testnet' | 'mainnet'): boolean {
  if (providerEnvironment === 'all') return true;
  if (runtimeEnvironment === 'local') return providerEnvironment === 'local' || providerEnvironment === 'testnet';
  return providerEnvironment === runtimeEnvironment;
}


/**
 * Check whether a provider may execute a given action on a given chain
 * with a given asset.
 *
 * @param providerId   - The provider to check
 * @param capability   - The action capability required
 * @param chainId      - The chain the action will execute on
 * @param assetAddress - The ERC-20 asset address (lowercase), or undefined if chain-native
 */
export function checkProviderEligibility(
  providerId: string,
  capability: ProviderCapability,
  chainId: number,
  assetAddress?: string,
  runtimeEnvironment: 'local' | 'testnet' | 'mainnet' = 'testnet',
): ProviderEligibilityResult {
  const result = getProvider(providerId);

  if (!result.found) {
    return {
      eligible: false,
      status: 'NOT_FOUND',
      requiresConfirmation: false,
      detail: `Provider "${providerId}" is not registered. Unregistered providers cannot execute.`,
    };
  }

  const { entry, effectiveHealth: health } = result;

  if (!environmentMatches(entry.environment, runtimeEnvironment)) {
    return {
      eligible: false,
      status: 'ENVIRONMENT_NOT_SUPPORTED',
      requiresConfirmation: false,
      detail: `Provider "${providerId}" is registered for ${entry.environment}, not ${runtimeEnvironment}.`,
    };
  }

  // Mainnet never trusts manifest-only health. A fresh runtime health record is mandatory.
  if (runtimeEnvironment === 'mainnet' && !_healthStore.has(providerId)) {
    return {
      eligible: false,
      status: 'HEALTH_UNKNOWN',
      requiresConfirmation: false,
      detail: `Provider "${providerId}" has no fresh runtime health record for mainnet.`,
    };
  }

  // Must be enabled
  if (!entry.enabled) {
    const reason =
      entry.trustStatus === 'UNVERIFIED'
        ? `Provider "${providerId}" has not been independently verified and is disabled.`
        : `Provider "${providerId}" is explicitly disabled.`;
    return {
      eligible: false,
      status: entry.trustStatus === 'UNVERIFIED' ? 'UNVERIFIED' : 'DISABLED',
      requiresConfirmation: false,
      detail: reason,
    };
  }

  // Lifecycle gate — must reach ENABLED before participating in execution.
  // Documentation verification (VERIFIED) or adapter existence (IMPLEMENTED) alone
  // is NOT sufficient. Real testnet end-to-end execution must succeed (TESTED)
  // before promotion to ENABLED.
  if (entry.lifecycleStage !== 'ENABLED') {
    return {
      eligible: false,
      status: 'NOT_LIFECYCLE_READY',
      requiresConfirmation: false,
      detail:
        `Provider "${providerId}" is in lifecycle stage "${entry.lifecycleStage}" — ` +
        `only ENABLED providers may execute. ` +
        `Required path: DISCOVERED → VERIFIED → IMPLEMENTED → TESTED → ENABLED. ` +
        `Promotion to TESTED requires successful real testnet E2E execution and ` +
        `post-execution state verification.`,
    };
  }

  // Capability must be supported
  if (!entry.capabilities.includes(capability)) {
    return {
      eligible: false,
      status: 'CAPABILITY_NOT_SUPPORTED',
      requiresConfirmation: false,
      detail: `Provider "${providerId}" does not support capability "${capability}".`,
    };
  }

  // Chain must be supported
  if (!entry.supportedChainIds.includes(chainId)) {
    return {
      eligible: false,
      status: 'CHAIN_NOT_SUPPORTED',
      requiresConfirmation: false,
      detail: `Provider "${providerId}" does not support chain ${chainId}.`,
    };
  }

  // Asset must be supported (skip check if provider has no asset restrictions, i.e. empty = unrestricted for simulation-like providers)
  if (
    assetAddress !== undefined &&
    entry.supportedAssets.length > 0 &&
    !entry.supportedAssets.includes(assetAddress.toLowerCase())
  ) {
    return {
      eligible: false,
      status: 'ASSET_NOT_SUPPORTED',
      requiresConfirmation: false,
      detail: `Provider "${providerId}" does not support asset "${assetAddress}" on chain ${chainId}.`,
    };
  }

  // Health check — UNKNOWN fails conservatively for financial actions
  if (health === 'DOWN') {
    return {
      eligible: false,
      status: 'HEALTH_DOWN',
      requiresConfirmation: false,
      detail: `Provider "${providerId}" health is DOWN. Execution is blocked.`,
    };
  }

  if (health === 'UNKNOWN') {
    return {
      eligible: false,
      status: 'HEALTH_UNKNOWN',
      requiresConfirmation: false,
      detail: `Provider "${providerId}" health is UNKNOWN. Failing conservatively — refresh health before executing.`,
    };
  }

  // DEGRADED — eligible but requires explicit user confirmation
  if (health === 'DEGRADED') {
    return {
      eligible: true,
      status: 'ELIGIBLE',
      requiresConfirmation: true,
      detail: `Provider "${providerId}" is DEGRADED. Proceeding requires explicit user confirmation.`,
    };
  }

  return {
    eligible: true,
    status: 'ELIGIBLE',
    requiresConfirmation: false,
    detail: `Provider "${providerId}" is eligible for "${capability}" on chain ${chainId}.`,
  };
}

/**
 * Find the best eligible provider for a capability on a chain with an asset.
 * Returns the first fully eligible provider (OK health preferred over DEGRADED).
 */
export function findEligibleProvider(
  capability: ProviderCapability,
  chainId: number,
  assetAddress?: string,
  runtimeEnvironment: 'local' | 'testnet' | 'mainnet' = 'testnet',
): { found: true; entry: ProviderManifestEntry; requiresConfirmation: boolean } | { found: false; reason: string } {
  const candidates = getProvidersForCapability(capability);

  // Prefer fully-OK providers first
  for (const entry of candidates) {
    const check = checkProviderEligibility(entry.providerId, capability, chainId, assetAddress, runtimeEnvironment);
    if (check.eligible && !check.requiresConfirmation) {
      return { found: true, entry, requiresConfirmation: false };
    }
  }

  // Fall back to DEGRADED if no OK provider
  for (const entry of candidates) {
    const check = checkProviderEligibility(entry.providerId, capability, chainId, assetAddress, runtimeEnvironment);
    if (check.eligible && check.requiresConfirmation) {
      return { found: true, entry, requiresConfirmation: true };
    }
  }

  const reasons = candidates
    .map((e) => {
      const r = checkProviderEligibility(e.providerId, capability, chainId, assetAddress, runtimeEnvironment);
      return `${e.providerId}: ${r.detail}`;
    })
    .join('; ');

  return {
    found: false,
    reason: candidates.length === 0
      ? `No provider registered for capability "${capability}".`
      : `No eligible provider found for capability "${capability}" on chain ${chainId}: ${reasons}`,
  };
}
