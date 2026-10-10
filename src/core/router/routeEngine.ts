import { getAddress, keccak256, stringToHex } from 'viem';
import { SECURITY_CONFIG } from '../../lib/securityConfig';
import { checkProviderEligibility } from '../../providers/registry/providerRegistry';
import type {
  BridgeProviderAdapter,
  RouteOption,
  RouteQuoteParams,
} from '../../providers/bridge/bridgeProviderTypes';

export interface RouteSelectionResult {
  routes: RouteOption[];
  checkedProviders: string[];
  excludedProviders: Array<{ providerId: string; reason: string }>;
}

function canonicalRouteId(input: {
  clientIntentId: string;
  senderAddress: string;
  recipientSnapshotId: string;
  amountIn: bigint;
  sourceTokenAddress: string;
  sourceChainId: number;
  destinationTokenAddress: string;
  destinationChainId: number;
  provider: string;
  providerVersion: string;
}): string {
  const canonical = JSON.stringify({
    clientIntentId: input.clientIntentId,
    senderAddress: getAddress(input.senderAddress),
    recipientSnapshotId: input.recipientSnapshotId,
    amountIn: input.amountIn.toString(),
    sourceTokenAddress: getAddress(input.sourceTokenAddress),
    sourceChainId: input.sourceChainId,
    destinationTokenAddress: getAddress(input.destinationTokenAddress),
    destinationChainId: input.destinationChainId,
    provider: input.provider,
    providerVersion: input.providerVersion,
  });

  return keccak256(stringToHex(canonical));
}

export function buildRouteId(
  input: Parameters<typeof canonicalRouteId>[0],
): string {
  return canonicalRouteId(input);
}

function routeCoverageMatches(
  adapter: BridgeProviderAdapter,
  params: RouteQuoteParams,
): boolean {
  const sourceToken = params.sourceTokenAddress.toLowerCase();

  return adapter.capabilities.supportedRoutes.some((route) => {
    if (
      route.sourceChainId !== params.sourceChainId ||
      route.destinationChainId !== params.destinationChainId ||
      route.sourceTokenAddress.toLowerCase() !== sourceToken
    ) {
      return false;
    }

    if (route.minAmountIn !== null && params.amountIn < route.minAmountIn) {
      return false;
    }
    if (route.maxAmountIn !== null && params.amountIn > route.maxAmountIn) {
      return false;
    }
    return true;
  });
}

async function quoteWithTimeout(
  adapter: BridgeProviderAdapter,
  params: RouteQuoteParams,
): Promise<RouteOption | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      adapter.quoteRoute(params),
      new Promise<null>((resolve) => {
        timer = setTimeout(
          () => resolve(null),
          SECURITY_CONFIG.ROUTE_QUOTE_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function isRouteStructurallySafe(
  route: RouteOption,
  adapter: BridgeProviderAdapter,
  now: number,
): boolean {
  if (
    route.provider !== adapter.providerId ||
    route.providerVersion !== adapter.version ||
    route.expiresAt <= now ||
    route.quotedAt > now ||
    route.ttlMs !== route.expiresAt - route.quotedAt ||
    route.amountIn <= 0n ||
    route.amountOut <= 0n
  ) {
    return false;
  }

  const minimumOutput =
    (route.amountIn * BigInt(SECURITY_CONFIG.ROUTE_MIN_OUTPUT_RATIO_BPS)) /
    10_000n;
  if (route.amountOut < minimumOutput) return false;

  if (!adapter.capabilities.multiHopSupported && route.hops.length > 1) {
    return false;
  }

  if (!route.multiHopEnabled && route.hops.length > 1) return false;

  return true;
}

function confidenceRank(confidence: RouteOption['confidence']): number {
  if (confidence === 'HIGH') return 3;
  if (confidence === 'MEDIUM') return 2;
  return 1;
}

export async function selectBridgeRoutes(input: {
  params: RouteQuoteParams;
  adapters: readonly BridgeProviderAdapter[];
  runtimeEnvironment?: 'local' | 'testnet' | 'mainnet';
  now?: number;
}): Promise<RouteSelectionResult> {
  const runtimeEnvironment = input.runtimeEnvironment ?? 'testnet';
  const now = input.now ?? Date.now();
  const checkedProviders: string[] = [];
  const excludedProviders: Array<{ providerId: string; reason: string }> = [];

  const eligible = input.adapters.filter((adapter) => {
    checkedProviders.push(adapter.providerId);

    if (
      adapter.capabilities.lifecycleStage !== 'ENABLED' ||
      !routeCoverageMatches(adapter, input.params)
    ) {
      excludedProviders.push({
        providerId: adapter.providerId,
        reason: 'CAPABILITY_OR_LIFECYCLE_NOT_ELIGIBLE',
      });
      return false;
    }

    const registry = checkProviderEligibility(
      adapter.providerId,
      'BRIDGE',
      input.params.sourceChainId,
      input.params.sourceTokenAddress,
      runtimeEnvironment,
    );

    if (!registry.eligible || registry.status !== 'ELIGIBLE') {
      excludedProviders.push({
        providerId: adapter.providerId,
        reason: registry.status,
      });
      return false;
    }

    return true;
  });

  const quoted = await Promise.all(
    eligible.map(async (adapter) => ({
      adapter,
      route: await quoteWithTimeout(adapter, input.params).catch(() => null),
    })),
  );

  const routes: RouteOption[] = [];
  for (const { adapter, route } of quoted) {
    if (!route) {
      excludedProviders.push({
        providerId: adapter.providerId,
        reason: 'QUOTE_UNAVAILABLE',
      });
      continue;
    }

    if (!isRouteStructurallySafe(route, adapter, now)) {
      excludedProviders.push({
        providerId: adapter.providerId,
        reason: 'UNSAFE_OR_EXPIRED_ROUTE',
      });
      continue;
    }

    routes.push(route);
  }

  routes.sort((a, b) => {
    if (a.amountOut !== b.amountOut) return a.amountOut > b.amountOut ? -1 : 1;
    if (a.estimatedTimeMs !== b.estimatedTimeMs) {
      return a.estimatedTimeMs - b.estimatedTimeMs;
    }
    return confidenceRank(b.confidence) - confidenceRank(a.confidence);
  });

  return {
    routes: routes.slice(0, SECURITY_CONFIG.ROUTE_MAX_OPTIONS),
    checkedProviders,
    excludedProviders,
  };
}
