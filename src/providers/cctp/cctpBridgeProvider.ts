import {
  createPublicClient,
  getAddress,
  http,
  isAddress,
} from 'viem';
import { SECURITY_CONFIG } from '../../lib/securityConfig';
import { MANIFEST_CONSTANTS, findManifestEntry } from '../registry/providerManifest';
import type {
  BridgeProviderAdapter,
  ExecutionResult,
  PreflightResult,
  ResumePayload,
  RouteOption,
  RouteQuoteParams,
  TransactionSigner,
  ActivityTrace,
} from '../bridge/bridgeProviderTypes';
import { buildRouteId } from '../../core/router/routeEngine';

export const CCTP_V2_PROVIDER_ID = 'cctp-v2-bridge';
export const CCTP_V2_PROVIDER_VERSION = 'cctp-v2-api';
const PROVIDER_ID = CCTP_V2_PROVIDER_ID;
const PROVIDER_VERSION = CCTP_V2_PROVIDER_VERSION;
const STANDARD_ESTIMATED_TIME_MS = 15 * 60 * 1000;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

const DESTINATIONS: Record<
  number,
  { rpcUrl: string; usdc: string }
> = {
  [MANIFEST_CONSTANTS.ETH_SEPOLIA_CHAIN_ID]: {
    rpcUrl: 'https://ethereum-sepolia-rpc.publicnode.com',
    usdc: MANIFEST_CONSTANTS.ETH_SEPOLIA_USDC,
  },
  [MANIFEST_CONSTANTS.BASE_SEPOLIA_CHAIN_ID]: {
    rpcUrl: 'https://sepolia.base.org',
    usdc: MANIFEST_CONSTANTS.BASE_SEPOLIA_USDC,
  },
};

const manifestEntry = findManifestEntry(PROVIDER_ID);
if (!manifestEntry) {
  throw new Error('[cctpBridgeProvider] cctp-v2-bridge is not registered.');
}

export const cctpV2BridgeProvider: BridgeProviderAdapter = {
  providerId: PROVIDER_ID,
  version: PROVIDER_VERSION,
  capabilities: {
    providerId: PROVIDER_ID,
    version: PROVIDER_VERSION,
    lifecycleStage: manifestEntry.lifecycleStage,
    supportedRoutes: Object.entries(DESTINATIONS).map(
      ([destinationChainId, destination]) => ({
        sourceChainId: MANIFEST_CONSTANTS.ARC_TESTNET_CHAIN_ID,
        destinationChainId: Number(destinationChainId),
        sourceTokenAddress: MANIFEST_CONSTANTS.ARC_TESTNET_USDC,
        destinationTokenAddress: destination.usdc,
        minAmountIn: 1n,
        maxAmountIn: null,
      }),
    ),
    relaySupported: true,
    resumeSupported: true,
    multiHopSupported: false,
    swapSupported: false,
    destinationGasRequired: false,
    minDestinationGasWei: null,
    quoteTtlMs: SECURITY_CONFIG.ROUTE_STABLE_TTL_MS,
    supportsLiveQuotes: false,
  },

  canRoute(sourceChainId, destinationChainId, tokenAddress) {
    return this.capabilities.supportedRoutes.some(
      (route) =>
        route.sourceChainId === sourceChainId &&
        route.destinationChainId === destinationChainId &&
        route.sourceTokenAddress.toLowerCase() === tokenAddress.toLowerCase(),
    );
  },

  quoteRoute(params: RouteQuoteParams): Promise<RouteOption | null> {
    if (
      params.amountIn <= 0n ||
      !isAddress(params.senderAddress) ||
      !isAddress(params.destinationAddress) ||
      params.destinationAddress.toLowerCase() === ZERO_ADDRESS ||
      !this.canRoute(
        params.sourceChainId,
        params.destinationChainId,
        params.sourceTokenAddress,
      )
    ) {
      return Promise.resolve(null);
    }

    const supported = this.capabilities.supportedRoutes.find(
      (route) =>
        route.sourceChainId === params.sourceChainId &&
        route.destinationChainId === params.destinationChainId &&
        route.sourceTokenAddress.toLowerCase() ===
          params.sourceTokenAddress.toLowerCase(),
    );
    if (!supported) return Promise.resolve(null);

    const quotedAt = Date.now();
    const expiresAt = quotedAt + this.capabilities.quoteTtlMs;
    const routeId = buildRouteId({
      clientIntentId: params.clientIntentId,
      senderAddress: params.senderAddress,
      recipientSnapshotId: params.recipientSnapshotId,
      amountIn: params.amountIn,
      sourceTokenAddress: params.sourceTokenAddress,
      sourceChainId: params.sourceChainId,
      destinationTokenAddress: supported.destinationTokenAddress,
      destinationChainId: params.destinationChainId,
      provider: this.providerId,
      providerVersion: this.version,
    });

    return Promise.resolve({
      routeId,
      provider: this.providerId,
      providerVersion: this.version,
      sourceChainId: params.sourceChainId,
      sourceTokenAddress: getAddress(params.sourceTokenAddress),
      destinationChainId: params.destinationChainId,
      destinationTokenAddress: getAddress(
        supported.destinationTokenAddress,
      ),
      destinationAddress: getAddress(params.destinationAddress),
      amountIn: params.amountIn,
      amountOut: params.amountIn,
      fees: [],
      estimatedTimeMs: STANDARD_ESTIMATED_TIME_MS,
      confidence: 'HIGH',
      quotedAt,
      expiresAt,
      ttlMs: expiresAt - quotedAt,
      hops: [
        {
          hopIndex: 0,
          provider: this.providerId,
          sourceChainId: params.sourceChainId,
          destinationChainId: params.destinationChainId,
          sourceTokenAddress: getAddress(params.sourceTokenAddress),
          destinationTokenAddress: getAddress(
            supported.destinationTokenAddress,
          ),
          estimatedTimeMs: STANDARD_ESTIMATED_TIME_MS,
        },
      ],
      multiHopEnabled: false,
      providerMetadata: {
        mechanism: 'CCTP_V2',
        finality: 'STANDARD',
        sourceDomain: MANIFEST_CONSTANTS.ARC_TESTNET_CCTP_DOMAIN,
      },
    });
  },

  async preflight(routeOption: RouteOption): Promise<PreflightResult[]> {
    const results: PreflightResult[] = [];

    const destination = DESTINATIONS[routeOption.destinationChainId];
    const routeSupported = this.canRoute(
      routeOption.sourceChainId,
      routeOption.destinationChainId,
      routeOption.sourceTokenAddress,
    );

    results.push({
      checkId: 'DESTINATION_CHAIN_DISABLED',
      severity: 'HARD_BLOCK',
      passed: routeSupported && Boolean(destination),
      message:
        routeSupported && destination
          ? 'Destination route is enabled for CCTP V2.'
          : 'Destination route is not enabled for CCTP V2.',
    });

    results.push({
      checkId: 'ZERO_RECIPIENT',
      severity: 'HARD_BLOCK',
      passed:
        isAddress(routeOption.destinationAddress) &&
        routeOption.destinationAddress.toLowerCase() !== ZERO_ADDRESS,
      message: 'Destination recipient must be a valid non-zero address.',
    });

    results.push({
      checkId: 'TOKEN_NOT_SUPPORTED',
      severity: 'HARD_BLOCK',
      passed:
        Boolean(destination) &&
        routeOption.destinationTokenAddress.toLowerCase() ===
          destination?.usdc.toLowerCase(),
      message: 'Destination token must be canonical testnet USDC.',
    });

    if (destination) {
      const client = createPublicClient({
        chain: {
          id: routeOption.destinationChainId,
          name: `chain-${routeOption.destinationChainId}`,
          nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
          rpcUrls: { default: { http: [destination.rpcUrl] } },
        },
        transport: http(destination.rpcUrl),
      });

      const [transmitterCode, messengerCode] = await Promise.all([
        client
          .getCode({
            address: MANIFEST_CONSTANTS.CCTP_V2_MESSAGE_TRANSMITTER,
          })
          .catch(() => undefined),
        client
          .getCode({
            address: MANIFEST_CONSTANTS.CCTP_V2_TOKEN_MESSENGER,
          })
          .catch(() => undefined),
      ]);

      results.push({
        checkId: 'DESTINATION_TRANSMITTER_MISSING',
        severity: 'HARD_BLOCK',
        passed: Boolean(transmitterCode && transmitterCode !== '0x'),
        message:
          transmitterCode && transmitterCode !== '0x'
            ? 'Destination CCTP MessageTransmitterV2 is deployed.'
            : 'Destination CCTP MessageTransmitterV2 could not be verified.',
      });

      results.push({
        checkId: 'DESTINATION_MESSENGER_MISSING',
        severity: 'HARD_BLOCK',
        passed: Boolean(messengerCode && messengerCode !== '0x'),
        message:
          messengerCode && messengerCode !== '0x'
            ? 'Destination CCTP TokenMessengerV2 is deployed.'
            : 'Destination CCTP TokenMessengerV2 could not be verified.',
      });
    }

    try {
      const response = await fetch('/api/cctp/health');
      results.push({
        checkId: 'ATTESTATION_SERVICE_DOWN',
        severity: 'HARD_BLOCK',
        passed: response.ok,
        message: response.ok
          ? 'Circle CCTP attestation service is reachable through Veyra.'
          : 'Circle CCTP attestation service is not reachable.',
      });
    } catch {
      results.push({
        checkId: 'ATTESTATION_SERVICE_DOWN',
        severity: 'HARD_BLOCK',
        passed: false,
        message: 'Circle CCTP attestation service is not reachable.',
      });
    }

    results.push({
      checkId: 'RELAYER_AVAILABLE',
      severity: 'INFO',
      passed: true,
      message:
        'Veyra can use the authenticated destination relay when configured; otherwise it falls back to user-signed receive.',
    });

    results.push({
      checkId: 'ESTIMATED_ARRIVAL',
      severity: 'INFO',
      passed: true,
      message: 'Standard CCTP transfer is estimated at about 15 minutes.',
    });

    return results;
  },

  execute(
    _routeOption: RouteOption,
    _signer: TransactionSigner,
    _onProgress: (trace: ActivityTrace) => void,
  ): Promise<ExecutionResult> {
    return Promise.reject(
      new Error(
        '[cctpBridgeProvider] Execution requires the production bridge execution runtime. Route adapters never bypass useBridgeExecution.',
      ),
    );
  },

  resume(
    _resumePayload: ResumePayload,
    _signer: TransactionSigner,
    _onProgress: (trace: ActivityTrace) => void,
  ): Promise<ExecutionResult> {
    return Promise.reject(
      new Error(
        '[cctpBridgeProvider] Resume requires the production bridge recovery runtime. Route adapters never bypass persisted checkpoint reconciliation.',
      ),
    );
  },
};
