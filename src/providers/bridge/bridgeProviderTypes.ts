import type { ProviderLifecycleStage } from '../registry/providerTypes';

export interface SupportedRoute {
  sourceChainId: number;
  destinationChainId: number;
  sourceTokenAddress: string;
  destinationTokenAddress: string;
  minAmountIn: bigint | null;
  maxAmountIn: bigint | null;
}

export interface CapabilityMatrix {
  providerId: string;
  version: string;
  lifecycleStage: ProviderLifecycleStage;
  supportedRoutes: SupportedRoute[];
  relaySupported: boolean;
  resumeSupported: boolean;
  multiHopSupported: boolean;
  swapSupported: boolean;
  destinationGasRequired: boolean;
  minDestinationGasWei: bigint | null;
  quoteTtlMs: number;
  supportsLiveQuotes: boolean;
}

export interface RouteFee {
  label: string;
  amountRaw: bigint;
  tokenAddress: string;
  chainId: number;
  amountUsdEstimate: number;
  paidBy: 'sender' | 'receiver' | 'relayer';
}

export interface RouteHop {
  hopIndex: number;
  provider: string;
  sourceChainId: number;
  destinationChainId: number;
  sourceTokenAddress: string;
  destinationTokenAddress: string;
  estimatedTimeMs: number;
}

export interface RouteOption {
  routeId: string;
  provider: string;
  providerVersion: string;
  sourceChainId: number;
  sourceTokenAddress: string;
  destinationChainId: number;
  destinationTokenAddress: string;
  destinationAddress: string;
  amountIn: bigint;
  amountOut: bigint;
  fees: RouteFee[];
  estimatedTimeMs: number;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  quotedAt: number;
  expiresAt: number;
  ttlMs: number;
  hops: RouteHop[];
  multiHopEnabled: boolean;
  providerMetadata: Record<string, unknown>;
}

export interface RouteQuoteParams {
  clientIntentId: string;
  senderAddress: string;
  recipientSnapshotId: string;
  destinationAddress: string;
  sourceChainId: number;
  destinationChainId: number;
  sourceTokenAddress: string;
  amountIn: bigint;
}

export interface PreflightResult {
  checkId: string;
  severity: 'HARD_BLOCK' | 'WARNING' | 'INFO';
  passed: boolean;
  message: string;
  detail?: string;
}

export interface ResumePayload {
  provider: string;
  version: number;
  payload: Record<string, unknown>;
}

export interface ActivityTrace {
  step: string;
  txHash?: string;
  chainId?: number;
  timestamp: number;
  data?: Record<string, unknown>;
}

export interface ExecutionResult {
  status: 'PENDING' | 'CONFIRMED' | 'FAILED';
  txHash?: `0x${string}`;
  resumePayload?: ResumePayload;
  detail?: string;
}

export interface PreparedTransaction {
  chainId: number;
  to: `0x${string}`;
  data: `0x${string}`;
  value?: bigint;
}

export interface TransactionSigner {
  signAndSend(tx: PreparedTransaction): Promise<`0x${string}`>;
  signTypedData(
    domain: unknown,
    types: unknown,
    value: unknown,
  ): Promise<`0x${string}`>;
  address: string;
  chainId: number;
}

export interface BridgeProviderExecutionRuntime {
  readonly providerId: string;

  execute(
    routeOption: RouteOption,
    onProgress: (trace: ActivityTrace) => void,
  ): Promise<void>;

  resume(
    resumePayload: ResumePayload,
    onProgress: (trace: ActivityTrace) => void,
  ): Promise<void>;
}

export interface BridgeProviderAdapter {
  readonly providerId: string;
  readonly version: string;
  readonly capabilities: CapabilityMatrix;

  canRoute(
    sourceChainId: number,
    destinationChainId: number,
    tokenAddress: string,
  ): boolean;

  quoteRoute(params: RouteQuoteParams): Promise<RouteOption | null>;

  preflight(routeOption: RouteOption): Promise<PreflightResult[]>;

  execute(
    routeOption: RouteOption,
    runtime: BridgeProviderExecutionRuntime,
    onProgress: (trace: ActivityTrace) => void,
  ): Promise<void>;

  resume(
    resumePayload: ResumePayload,
    runtime: BridgeProviderExecutionRuntime,
    onProgress: (trace: ActivityTrace) => void,
  ): Promise<void>;
}
