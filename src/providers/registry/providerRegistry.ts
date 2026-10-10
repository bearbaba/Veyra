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

export function getProviderHealthRecord(providerId: string): ProviderHealthRecord | undefined {
  const record = _healthStore.get(providerId);
  return record ? { ...record } : undefined;
}

export function getAllProviderHealthRecords(): ProviderHealthRecord[] {
  return [..._healthStore.values()].map((record) => ({ ...record }));
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


function normalizeAssetIdentifier(value: string): string {
  return value.trim().toLowerCase();
}

function assetSupportedOnChain(
  entry: ProviderManifestEntry,
  chainId: number,
  assetIdentifier: string,
): boolean {
  const asset = normalizeAssetIdentifier(assetIdentifier);
  const matrix = entry.networkAssetSupport ?? [];

  if (matrix.length > 0) {
    const rows = matrix.filter((row) => row.chainId === chainId);
    if (rows.length === 0) return false;
    return rows.some((row) =>
      row.assets.some((candidate) => normalizeAssetIdentifier(candidate) === asset),
    );
  }

  // Legacy single-network providers may still use the flat list. Empty means
  // unrestricted for non-asset-specific providers such as simulation.
  return (
    entry.supportedAssets.length === 0 ||
    entry.supportedAssets.some(
      (candidate) => normalizeAssetIdentifier(candidate) === asset,
    )
  );
}

function assetSupportedOnNetwork(
  entry: ProviderManifestEntry,
  network: { networkId: string; chainId?: number },
  assetIdentifier: string,
): boolean {
  const asset = normalizeAssetIdentifier(assetIdentifier);
  const normalizedNetworkId = network.networkId.trim().toLowerCase();
  const matrix = entry.networkAssetSupport ?? [];

  if (matrix.length === 0) {
    // EVM legacy path may still use supportedAssets. Non-EVM execution must
    // have an explicit network↔asset matrix before it can be enabled.
    if (network.chainId !== undefined) {
      return assetSupportedOnChain(entry, network.chainId, assetIdentifier);
    }
    return false;
  }

  const rows = matrix.filter((row) => {
    if (row.chainId !== undefined && network.chainId !== undefined && row.chainId !== network.chainId) {
      return false;
    }
    if (row.chainId !== undefined && network.chainId === undefined) {
      return false;
    }
    if (
      row.networkId !== undefined &&
      row.networkId.trim().toLowerCase() !== normalizedNetworkId
    ) {
      return false;
    }
    return row.chainId !== undefined || row.networkId !== undefined;
  });

  return rows.some((row) =>
    row.assets.some((candidate) => normalizeAssetIdentifier(candidate) === asset),
  );
}

function networkIdMatchesChainMetadata(
  entry: ProviderManifestEntry,
  network: { networkId: string; chainId: number },
): boolean {
  const normalizedNetworkId = network.networkId.trim().toLowerCase();
  const explicitIds = entry.supportedNetworkIds ?? [];

  if (explicitIds.length > 0) {
    return explicitIds.some((id) => id.trim().toLowerCase() === normalizedNetworkId);
  }

  // If exact network↔asset rows name the network for this chain, use them as
  // authoritative network identity metadata. This prevents a contradictory
  // NetworkRef such as { networkId: 'solana-devnet', chainId: 5042002 } from
  // passing an EVM provider merely because the numeric chainId is valid.
  const namedRows = (entry.networkAssetSupport ?? []).filter(
    (row) => row.chainId === network.chainId && row.networkId !== undefined,
  );

  if (namedRows.length === 0) return true;

  return namedRows.some(
    (row) => row.networkId!.trim().toLowerCase() === normalizedNetworkId,
  );
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

  // Asset must be supported on this exact chain. Multi-network providers use
  // the network↔asset matrix so an address from chain A cannot be accepted on
  // chain B merely because it appears in the provider's flat asset list.
  if (
    assetAddress !== undefined &&
    !assetSupportedOnChain(entry, chainId, assetAddress)
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

/**
 * Network-family-aware eligibility wrapper for product-layer routing.
 *
 * EVM providers continue through the existing chainId gate. Non-EVM networks
 * are checked against supportedNetworkIds so the registry never invents fake
 * numeric chain IDs for Solana or future ecosystems.
 */
export function checkProviderNetworkEligibility(
  providerId: string,
  capability: ProviderCapability,
  network: { networkId: string; chainId?: number },
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

  const supportedNetworkIds = result.entry.supportedNetworkIds ?? [];
  const normalizedNetworkId = network.networkId.trim().toLowerCase();

  if (network.chainId !== undefined) {
    const chainResult = checkProviderEligibility(
      providerId,
      capability,
      network.chainId,
      assetAddress,
      runtimeEnvironment,
    );
    if (!chainResult.eligible) return chainResult;

    if (!networkIdMatchesChainMetadata(result.entry, {
      networkId: network.networkId,
      chainId: network.chainId,
    })) {
      return {
        eligible: false,
        status: 'CHAIN_NOT_SUPPORTED',
        requiresConfirmation: false,
        detail:
          `Provider "${providerId}" network metadata does not match "${network.networkId}" for chain ${network.chainId}.`,
      };
    }
    return chainResult;
  }

  if (supportedNetworkIds.length === 0) {
    return {
      eligible: false,
      status: 'CHAIN_NOT_SUPPORTED',
      requiresConfirmation: false,
      detail:
        `Provider "${providerId}" has no non-EVM network metadata for "${network.networkId}".`,
    };
  }

  if (!supportedNetworkIds.some((id) => id.toLowerCase() === normalizedNetworkId)) {
    return {
      eligible: false,
      status: 'CHAIN_NOT_SUPPORTED',
      requiresConfirmation: false,
      detail: `Provider "${providerId}" does not support network "${network.networkId}".`,
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

  // Mainnet parity with EVM eligibility: manifest health is never enough.
  // A fresh runtime health record is mandatory regardless of network family.
  if (runtimeEnvironment === 'mainnet' && !_healthStore.has(providerId)) {
    return {
      eligible: false,
      status: 'HEALTH_UNKNOWN',
      requiresConfirmation: false,
      detail: `Provider "${providerId}" has no fresh runtime health record for mainnet.`,
    };
  }

  if (!entry.enabled) {
    return {
      eligible: false,
      status: entry.trustStatus === 'UNVERIFIED' ? 'UNVERIFIED' : 'DISABLED',
      requiresConfirmation: false,
      detail: `Provider "${providerId}" is disabled.`,
    };
  }
  if (entry.lifecycleStage !== 'ENABLED') {
    return {
      eligible: false,
      status: 'NOT_LIFECYCLE_READY',
      requiresConfirmation: false,
      detail: `Provider "${providerId}" is not ENABLED.`,
    };
  }
  if (!entry.capabilities.includes(capability)) {
    return {
      eligible: false,
      status: 'CAPABILITY_NOT_SUPPORTED',
      requiresConfirmation: false,
      detail: `Provider "${providerId}" does not support capability "${capability}".`,
    };
  }
  if (
    assetAddress !== undefined &&
    !assetSupportedOnNetwork(entry, network, assetAddress)
  ) {
    return {
      eligible: false,
      status: 'ASSET_NOT_SUPPORTED',
      requiresConfirmation: false,
      detail:
        `Provider "${providerId}" does not support asset "${assetAddress}" on network "${network.networkId}".`,
    };
  }
  if (health === 'DOWN' || health === 'UNKNOWN') {
    return {
      eligible: false,
      status: health === 'DOWN' ? 'HEALTH_DOWN' : 'HEALTH_UNKNOWN',
      requiresConfirmation: false,
      detail: `Provider "${providerId}" health is ${health}.`,
    };
  }
  return {
    eligible: true,
    status: 'ELIGIBLE',
    requiresConfirmation: health === 'DEGRADED',
    detail: health === 'DEGRADED'
      ? `Provider "${providerId}" is DEGRADED and requires confirmation.`
      : `Provider "${providerId}" is eligible on ${network.networkId}.`,
  };
}
