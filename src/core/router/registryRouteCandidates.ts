import { getCapability } from '../capabilities/capabilityRegistry';
import type { VeyraCapability } from '../capabilities/capabilityTypes';
import type { ProviderCapability, ProviderManifestEntry } from '../../providers/registry/providerTypes';
import {
  checkProviderNetworkEligibility,
  getProvider,
  getProvidersForCapability,
} from '../../providers/registry/providerRegistry';
import { buildRoutePlan } from './universalMoneyRouter';
import type {
  NetworkRef,
  RouteCandidate,
  RouteMoneyCost,
  RoutePlan,
  RoutePreference,
} from './routeTypes';
import {
  estimateSignatureBudget,
  type AllowanceState,
  type SignatureOperation,
} from './signatureBudget';

export interface ProviderRouteRuntimeFacts {
  allowance?: AllowanceState;
  destinationRelayAvailable?: boolean;
  sourceSwitchAutomated?: boolean;
  extraManualConfirmations?: number;
  cost?: RouteMoneyCost;
}

export interface RegistryRouteRequest {
  capability: VeyraCapability;
  source: NetworkRef;
  destination?: NetworkRef;
  assetAddress?: string;
  runtimeEnvironment?: 'local' | 'testnet' | 'mainnet';
  operation?: SignatureOperation;
  /**
   * Optional exact low-level provider capability. Required when the caller needs
   * a specific EARN operation rather than generic discovery.
   */
  providerCapability?: ProviderCapability;
  providerFacts?: Readonly<Record<string, ProviderRouteRuntimeFacts>>;
}

function providerCapabilitiesForRequest(request: RegistryRouteRequest): readonly ProviderCapability[] {
  if (request.providerCapability) return [request.providerCapability];

  if (request.capability === 'EARN') {
    switch (request.operation) {
      case 'EARN_DEPOSIT': return ['EARN_DEPOSIT'];
      case 'EARN_WITHDRAW': return ['EARN_WITHDRAW'];
      case 'EARN_POSITION': return ['EARN_POSITION'];
      case 'EARN_DISCOVER':
      default:
        return ['EARN_DISCOVER'];
    }
  }

  return getCapability(request.capability).providerCapabilities;
}

function providerSupportsNetwork(entry: ProviderManifestEntry, network: NetworkRef): boolean {
  const ids = entry.supportedNetworkIds ?? [];
  const normalized = network.networkId.trim().toLowerCase();

  if (network.chainId !== undefined && entry.supportedChainIds.includes(network.chainId)) {
    if (ids.length === 0) return true;
    return ids.some((id) => id.toLowerCase() === normalized);
  }

  return ids.some((id) => id.toLowerCase() === normalized);
}

function riskScoreFromClassification(
  classification: ProviderManifestEntry['riskClassification'],
): number {
  switch (classification) {
    case 'LOW': return 20;
    case 'MEDIUM': return 45;
    case 'HIGH': return 70;
    case 'CRITICAL': return 95;
    case 'UNKNOWN': return 100;
  }
}

function uniqueProviders(capabilities: readonly ProviderCapability[]): Array<{
  entry: ProviderManifestEntry;
  providerCapability: ProviderCapability;
}> {
  const seen = new Set<string>();
  const providers: Array<{ entry: ProviderManifestEntry; providerCapability: ProviderCapability }> = [];

  for (const providerCapability of capabilities) {
    for (const entry of getProvidersForCapability(providerCapability)) {
      if (seen.has(entry.providerId)) continue;
      seen.add(entry.providerId);
      providers.push({ entry, providerCapability });
    }
  }

  return providers.sort((a, b) => a.entry.providerId.localeCompare(b.entry.providerId));
}

function candidateId(
  capability: VeyraCapability,
  providerId: string,
  source: NetworkRef,
  destination?: NetworkRef,
): string {
  return [
    capability.toLowerCase(),
    providerId,
    source.networkId.toLowerCase(),
    destination?.networkId.toLowerCase() ?? 'same-network',
  ].join(':');
}

/**
 * Build deterministic route candidates directly from the provider registry.
 *
 * No fee, ETA, allowance or relay behavior is invented. Runtime-known facts
 * may be supplied by the caller; missing values are budgeted conservatively.
 * Disabled, unhealthy, wrong-network and wrong-lifecycle providers remain in
 * the returned list as rejected candidates so the UI can explain why.
 */
export function generateRegistryRouteCandidates(
  request: RegistryRouteRequest,
): RouteCandidate[] {
  const providerCapabilities = providerCapabilitiesForRequest(request);
  if (providerCapabilities.length === 0) return [];

  const runtimeEnvironment = request.runtimeEnvironment ?? 'testnet';
  const factsByProvider = request.providerFacts ?? {};

  return uniqueProviders(providerCapabilities).map(({ entry, providerCapability }) => {
    const lookup = getProvider(entry.providerId);
    const health = lookup.found ? lookup.effectiveHealth : 'UNKNOWN';

    const sourceEligibility = checkProviderNetworkEligibility(
      entry.providerId,
      providerCapability,
      request.source,
      request.assetAddress,
      runtimeEnvironment,
    );

    const destinationSupported =
      request.destination === undefined || providerSupportsNetwork(entry, request.destination);

    const facts = factsByProvider[entry.providerId] ?? {};
    const budget = estimateSignatureBudget({
      capability: request.capability,
      providerId: entry.providerId,
      ...(request.operation ? { operation: request.operation } : {}),
      allowance: facts.allowance ?? 'UNKNOWN',
      destinationRelayAvailable: facts.destinationRelayAvailable ?? false,
      sourceSwitchAutomated: facts.sourceSwitchAutomated ?? false,
      extraManualConfirmations: facts.extraManualConfirmations ?? 0,
    });

    const eligible = sourceEligibility.eligible && destinationSupported;
    const rejectionReason = !sourceEligibility.eligible
      ? sourceEligibility.status
      : !destinationSupported
        ? 'DESTINATION_NOT_SUPPORTED'
        : undefined;

    const routeId = candidateId(
      request.capability,
      entry.providerId,
      request.source,
      request.destination,
    );

    const explanationParts = [
      sourceEligibility.detail,
      request.destination
        ? destinationSupported
          ? `Destination ${request.destination.displayName} is supported by ${entry.displayName}.`
          : `Destination ${request.destination.displayName} is not supported by ${entry.displayName}.`
        : null,
      budget.explanation,
      facts.cost?.feeUsd === undefined ? 'Fee unavailable until a verified quote is supplied.' : null,
      facts.cost?.etaSeconds === undefined ? 'ETA unavailable until provider evidence is supplied.' : null,
    ].filter((part): part is string => Boolean(part));

    return {
      routeId,
      capability: request.capability,
      providerId: entry.providerId,
      source: request.source,
      ...(request.destination ? { destination: request.destination } : {}),
      eligible,
      ...(rejectionReason ? { rejectionReason } : {}),
      riskScore: riskScoreFromClassification(entry.riskClassification),
      health,
      ux: {
        protocolSignatures: budget.protocolSignatures,
        veyraAddedSignatures: 0,
        manualNetworkSwitches: budget.manualNetworkSwitches,
        extraManualConfirmations: budget.extraManualConfirmations,
      },
      cost: { ...(facts.cost ?? {}) },
      explanation: explanationParts.join(' '),
    };
  });
}

export function buildRegistryRoutePlan(
  request: RegistryRouteRequest,
  preference: RoutePreference = 'BALANCED',
): RoutePlan {
  return buildRoutePlan(generateRegistryRouteCandidates(request), preference);
}
