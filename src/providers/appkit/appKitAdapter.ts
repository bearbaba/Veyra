import { AppKit } from '@circle-fin/app-kit';
import { createViemAdapterFromProvider } from '@circle-fin/adapter-viem-v2';
import { parseUnits, type EIP1193Provider } from 'viem';
import type {
  BridgeAction,
  ConvertAction,
  SupplyAction,
  WithdrawAction,
} from '../../core/actions/actionSchema';
import {
  assertExecutionReady,
  type ExecutionRuntimeEnvironment,
} from '../../core/execution/executionReadiness';
import { SECURITY_CONFIG } from '../../lib/securityConfig';
import { assertRetryBridgeAllowed } from '../../core/router/bridgeRecovery';
import { quoteVeyraFee, type VeyraFeeQuote } from '../../core/fees/feeEngine';
import { configuredVeyraTreasuryAddress } from '../../core/fees/treasuryConfig';
import {
  assertEarnExplainabilityComplete,
  type EarnExplainabilityInput,
} from '../../core/earn/earnExplainability';
import {
  assertCircleAppKitChain,
  type CircleAppKitChain,
} from './appKitChains';
import { MANIFEST_CONSTANTS } from '../registry/providerManifest';

const appKit = new AppKit();

type ViemAppKitAdapter = Awaited<ReturnType<typeof createViemAdapterFromProvider>>;
type BridgeParams = Parameters<AppKit['bridge']>[0];
type BridgeResult = Awaited<ReturnType<AppKit['bridge']>>;
type BridgeEstimate = Awaited<ReturnType<AppKit['estimateBridge']>>;
type SwapParams = Parameters<AppKit['swap']>[0];
type SwapResult = Awaited<ReturnType<AppKit['swap']>>;
type SwapEstimate = Awaited<ReturnType<AppKit['estimateSwap']>>;
type UnifiedBalanceApi = AppKit['unifiedBalance'];
type UnifiedBalancesParams = Parameters<UnifiedBalanceApi['getBalances']>[0];
type UnifiedBalancesResult = Awaited<ReturnType<UnifiedBalanceApi['getBalances']>>;
type UnifiedSpendParams = Parameters<UnifiedBalanceApi['spend']>[0];
type UnifiedSpendResult = Awaited<ReturnType<UnifiedBalanceApi['spend']>>;
type UnifiedDepositParams = Parameters<UnifiedBalanceApi['deposit']>[0];
type UnifiedDepositResult = Awaited<ReturnType<UnifiedBalanceApi['deposit']>>;
type EarnApi = AppKit['earn'];
type EarnExploreParams = Parameters<EarnApi['exploreVaults']>[0];
type EarnExploreResult = Awaited<ReturnType<EarnApi['exploreVaults']>>;
type EarnDepositQuoteParams = Parameters<EarnApi['getDepositQuote']>[0];
type EarnDepositQuote = Awaited<ReturnType<EarnApi['getDepositQuote']>>;
type EarnDepositParams = Parameters<EarnApi['deposit']>[0];
type EarnDepositResult = Awaited<ReturnType<EarnApi['deposit']>>;
type EarnPositionParams = Parameters<EarnApi['getPosition']>[0];
type EarnPositionResult = Awaited<ReturnType<EarnApi['getPosition']>>;
type EarnWithdrawalQuoteParams = Parameters<EarnApi['getWithdrawalQuote']>[0];
type EarnWithdrawalQuote = Awaited<ReturnType<EarnApi['getWithdrawalQuote']>>;
type EarnWithdrawParams = Parameters<EarnApi['withdraw']>[0];
type EarnWithdrawResult = Awaited<ReturnType<EarnApi['withdraw']>>;

export type AppKitTransferSpeed = 'FAST' | 'SLOW';

export interface BrowserAdapterInput {
  provider: EIP1193Provider;
}

/**
 * Wallet network switching is transport state, not product state.
 *
 * Read-only calls never receive this callback. Fund-moving calls invoke it
 * immediately before the source-chain signature when the caller determines a
 * switch is required. Veyra never asks for a destination-chain switch when
 * Forwarding Service can complete the destination leg.
 */
export type EnsureSourceChain = () => Promise<void>;

async function adapterFromProvider(provider: EIP1193Provider): Promise<ViemAppKitAdapter> {
  return createViemAdapterFromProvider({ provider });
}

function normalizeAmount(amount: string): string {
  const normalized = amount.trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(normalized)) {
    throw new Error('Amount must be a positive decimal string');
  }
  if (Number(normalized) <= 0) throw new Error('Amount must be greater than zero');
  return normalized;
}

function assertAddress(address: string): string {
  const value = address.trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) throw new Error('Invalid EVM recipient address');
  return value;
}

export interface AppKitBridgeReviewRequest {
  sourceChain: CircleAppKitChain;
  destinationChain: CircleAppKitChain;
  amount: string;
  token?: string;
  recipientAddress: string;
  useForwarder: boolean;
  transferSpeed?: AppKitTransferSpeed;
}

export interface ReviewedAppKitBridge {
  request: AppKitBridgeReviewRequest;
  estimate: BridgeEstimate;
}


function appKitTestnetChainId(chain: CircleAppKitChain): number | null {
  switch (chain) {
    case 'Arc_Testnet':
      return MANIFEST_CONSTANTS.ARC_TESTNET_CHAIN_ID;
    case 'Ethereum_Sepolia':
      return MANIFEST_CONSTANTS.ETH_SEPOLIA_CHAIN_ID;
    case 'Base_Sepolia':
      return MANIFEST_CONSTANTS.BASE_SEPOLIA_CHAIN_ID;
    default:
      return null;
  }
}

function expectedTestnetUsdc(chainId: number): string | null {
  switch (chainId) {
    case MANIFEST_CONSTANTS.ARC_TESTNET_CHAIN_ID:
      return MANIFEST_CONSTANTS.ARC_TESTNET_USDC;
    case MANIFEST_CONSTANTS.ETH_SEPOLIA_CHAIN_ID:
      return MANIFEST_CONSTANTS.ETH_SEPOLIA_USDC;
    case MANIFEST_CONSTANTS.BASE_SEPOLIA_CHAIN_ID:
      return MANIFEST_CONSTANTS.BASE_SEPOLIA_USDC;
    default:
      return null;
  }
}


function arcTestnetAssetAddress(asset: string): string | null {
  const normalized = asset.trim().toLowerCase();
  if (
    normalized === 'usdc' ||
    normalized === MANIFEST_CONSTANTS.ARC_TESTNET_USDC.toLowerCase()
  ) {
    return MANIFEST_CONSTANTS.ARC_TESTNET_USDC;
  }
  if (
    normalized === 'eurc' ||
    normalized === MANIFEST_CONSTANTS.ARC_TESTNET_EURC.toLowerCase()
  ) {
    return MANIFEST_CONSTANTS.ARC_TESTNET_EURC;
  }
  return null;
}

async function assertWalletAccountMatchesAddress(
  provider: EIP1193Provider,
  expectedAddress: string,
  context: string,
): Promise<void> {
  const accounts = await provider.request({ method: 'eth_accounts' });
  if (!Array.isArray(accounts)) {
    throw new Error('[appKit] Wallet account response is invalid.');
  }

  const normalizedExpected = expectedAddress.toLowerCase();
  const matches = accounts.some(
    (account) =>
      typeof account === 'string' &&
      account.toLowerCase() === normalizedExpected,
  );
  if (!matches) {
    throw new Error(`[appKit] Connected wallet does not match the reviewed ${context} account.`);
  }
}

/**
 * Bind an App Kit bridge review to the exact deterministic BridgeAction that
 * passed Veyra review. This runs again at execution time before any wallet
 * account read, network switch, signature, allowance or bridge call.
 */
export function assertReviewedAppKitBridgeMatchesAction(
  reviewed: ReviewedAppKitBridge,
  action: BridgeAction,
): void {
  if (action.providerId !== 'circle-appkit-bridge') {
    throw new Error('[appKit] Bridge action provider does not match circle-appkit-bridge.');
  }

  if (
    action.provenance.providerId !== undefined &&
    action.provenance.providerId !== 'circle-appkit-bridge'
  ) {
    throw new Error('[appKit] Bridge action provenance provider does not match circle-appkit-bridge.');
  }

  const sourceChainId = appKitTestnetChainId(reviewed.request.sourceChain);
  const destinationChainId = appKitTestnetChainId(reviewed.request.destinationChain);
  if (sourceChainId === null || destinationChainId === null) {
    throw new Error('[appKit] Reviewed bridge chain is outside the verified App Kit testnet execution scope.');
  }

  if (action.chainId !== action.sourceChainId || action.sourceChainId !== sourceChainId) {
    throw new Error('[appKit] Reviewed bridge source chain does not match the deterministic action.');
  }
  if (action.destinationChainId !== destinationChainId) {
    throw new Error('[appKit] Reviewed bridge destination chain does not match the deterministic action.');
  }

  if (action.to.toLowerCase() !== reviewed.request.recipientAddress.toLowerCase()) {
    throw new Error('[appKit] Reviewed bridge recipient does not match the deterministic action.');
  }

  const reviewedAmount = parseUnits(reviewed.request.amount, action.tokenDecimals);
  if (reviewedAmount !== action.amount) {
    throw new Error('[appKit] Reviewed bridge amount does not match the deterministic action.');
  }

  const expectedUsdc = expectedTestnetUsdc(sourceChainId);
  if (!expectedUsdc || action.tokenAddress.toLowerCase() !== expectedUsdc.toLowerCase()) {
    throw new Error('[appKit] Bridge action asset does not match the verified source-chain USDC deployment.');
  }

  if (reviewed.request.token) {
    const reviewedToken = reviewed.request.token.trim();
    const tokenMatches =
      reviewedToken.toUpperCase() === 'USDC' ||
      reviewedToken.toLowerCase() === expectedUsdc.toLowerCase();
    if (!tokenMatches) {
      throw new Error('[appKit] Reviewed bridge token does not match the deterministic action asset.');
    }
  }
}

async function assertWalletAccountMatchesBridgeAction(
  provider: EIP1193Provider,
  action: BridgeAction,
): Promise<void> {
  await assertWalletAccountMatchesAddress(provider, action.from, 'bridge sender');
}

/** Quote-only bridge review. Never moves funds. */
export async function reviewAppKitBridge(input: {
  provider: EIP1193Provider;
  sourceChain: string;
  destinationChain: string;
  amount: string;
  token?: string;
  recipientAddress: string;
  useForwarder?: boolean;
  transferSpeed?: AppKitTransferSpeed;
}): Promise<ReviewedAppKitBridge> {
  const sourceChain = assertCircleAppKitChain(input.sourceChain);
  const destinationChain = assertCircleAppKitChain(input.destinationChain);
  const amount = normalizeAmount(input.amount);
  const recipientAddress = assertAddress(input.recipientAddress);
  const adapter = await adapterFromProvider(input.provider);
  const useForwarder = input.useForwarder !== false;

  const to = useForwarder
    ? { chain: destinationChain, recipientAddress, useForwarder: true }
    : { adapter, chain: destinationChain, recipientAddress };

  const params = {
    from: { adapter, chain: sourceChain },
    to,
    amount,
    ...(input.token ? { token: input.token } : {}),
    ...(input.transferSpeed
      ? { config: { transferSpeed: input.transferSpeed } }
      : {}),
  } as unknown as BridgeParams;

  const estimate = await appKit.estimateBridge(params);
  return {
    request: {
      sourceChain,
      destinationChain,
      amount,
      ...(input.token ? { token: input.token } : {}),
      recipientAddress,
      useForwarder,
      ...(input.transferSpeed ? { transferSpeed: input.transferSpeed } : {}),
    },
    estimate,
  };
}

/**
 * Moves funds. Call only from the user's explicit Review & Continue action.
 * The reviewed request is immutable input; policy/risk/account checks belong
 * immediately before this function at the canonical Veyra execution boundary.
 */
export async function executeReviewedAppKitBridge(input: {
  provider: EIP1193Provider;
  reviewed: ReviewedAppKitBridge;
  action: BridgeAction;
  runtimeEnvironment: ExecutionRuntimeEnvironment;
  degradedProviderConfirmed?: boolean;
  ensureSourceChain?: EnsureSourceChain;
}): Promise<BridgeResult> {
  assertReviewedAppKitBridgeMatchesAction(input.reviewed, input.action);

  // Final canonical Veyra boundary. The App Kit provider is currently disabled,
  // so this fails closed today. If it is later promoted to ENABLED, the same
  // guard continues to re-check schema/provenance/quote/provider health here.
  assertExecutionReady({
    action: input.action,
    providerId: 'circle-appkit-bridge',
    providerCapability: 'BRIDGE',
    assetAddress: input.action.tokenAddress,
    runtimeEnvironment: input.runtimeEnvironment,
    degradedProviderConfirmed: input.degradedProviderConfirmed,
  });

  await assertWalletAccountMatchesBridgeAction(input.provider, input.action);
  await input.ensureSourceChain?.();
  const adapter = await adapterFromProvider(input.provider);
  const request = input.reviewed.request;

  const to = request.useForwarder
    ? {
        chain: request.destinationChain,
        recipientAddress: request.recipientAddress,
        useForwarder: true,
      }
    : {
        adapter,
        chain: request.destinationChain,
        recipientAddress: request.recipientAddress,
      };

  const quote = (input.reviewed.estimate as { quote?: unknown }).quote;
  const params = {
    from: { adapter, chain: request.sourceChain },
    to,
    amount: request.amount,
    ...(request.token ? { token: request.token } : {}),
    ...(request.transferSpeed
      ? { config: { transferSpeed: request.transferSpeed } }
      : {}),
    ...(quote ? { quote } : {}),
  } as unknown as BridgeParams;

  return appKit.bridge(params);
}

export async function retryAppKitBridge(input: {
  provider: EIP1193Provider;
  result: BridgeResult;
  useForwarder: boolean;
}): Promise<BridgeResult> {
  assertRetryBridgeAllowed(input.result);
  const adapter = await adapterFromProvider(input.provider);
  return appKit.retryBridge(input.result, {
    from: adapter,
    to: input.useForwarder ? undefined : adapter,
  });
}

export function assertUnifiedSpendMatchesAction(input: {
  sourceChain: CircleAppKitChain;
  destinationChain: CircleAppKitChain;
  recipientAddress: string;
  amount: string;
  action: BridgeAction;
}): void {
  const sourceChainId = appKitTestnetChainId(input.sourceChain);
  const destinationChainId = appKitTestnetChainId(input.destinationChain);

  if (input.action.providerId !== 'circle-appkit-unified-balance') {
    throw new Error('[appKit] Unified spend action provider does not match circle-appkit-unified-balance.');
  }
  if (
    input.action.provenance.providerId !== undefined &&
    input.action.provenance.providerId !== 'circle-appkit-unified-balance'
  ) {
    throw new Error('[appKit] Unified spend provenance provider does not match circle-appkit-unified-balance.');
  }
  if (sourceChainId === null || destinationChainId === null) {
    throw new Error('[appKit] Unified spend chain is outside the verified App Kit testnet scope.');
  }
  if (
    input.action.chainId !== input.action.sourceChainId ||
    input.action.sourceChainId !== sourceChainId ||
    input.action.destinationChainId !== destinationChainId
  ) {
    throw new Error('[appKit] Unified spend chains do not match the deterministic action.');
  }
  if (input.action.to.toLowerCase() !== input.recipientAddress.toLowerCase()) {
    throw new Error('[appKit] Unified spend recipient does not match the deterministic action.');
  }

  const reviewedAmount = parseUnits(input.amount, input.action.tokenDecimals);
  if (reviewedAmount !== input.action.amount) {
    throw new Error('[appKit] Unified spend amount does not match the deterministic action.');
  }

  const expectedUsdc = expectedTestnetUsdc(sourceChainId);
  if (
    !expectedUsdc ||
    input.action.tokenAddress.toLowerCase() !== expectedUsdc.toLowerCase()
  ) {
    throw new Error('[appKit] Unified spend asset does not match the verified source-chain USDC deployment.');
  }
}

/** Read-only unified balance. No wallet network switch is required. */
export async function readUnifiedUsdcBalance(input: {
  provider: EIP1193Provider;
  networkType: 'testnet' | 'mainnet';
  includePending?: boolean;
}): Promise<UnifiedBalancesResult> {
  const adapter = await adapterFromProvider(input.provider);
  const params = {
    sources: { adapter },
    networkType: input.networkType,
    includePending: input.includePending ?? true,
  } as unknown as UnifiedBalancesParams;
  return appKit.unifiedBalance.getBalances(params);
}

export async function depositUnifiedUsdc(_input: {
  provider: EIP1193Provider;
  sourceChain: string;
  amount: string;
  allowanceStrategy?: 'authorize' | 'permit' | 'approve';
  ensureSourceChain?: EnsureSourceChain;
}): Promise<UnifiedDepositResult> {
  // Fail closed until Veyra has a canonical deterministic action schema that
  // can bind a Unified deposit to its exact provider-controlled destination.
  // A raw App Kit deposit call must never bypass assertExecutionReady().
  throw new Error(
    '[appKit] Unified deposit is blocked until a canonical Veyra Unified-deposit action is implemented and execution-bound.',
  );
}

/**
 * Forwarded unified spend: one source-side signing context and no destination
 * wallet switch. Circle's Forwarding Service completes the destination mint.
 */
export async function spendUnifiedUsdcForwarded(input: {
  provider: EIP1193Provider;
  sourceChain: string;
  destinationChain: string;
  recipientAddress: string;
  amount: string;
  action: BridgeAction;
  runtimeEnvironment: ExecutionRuntimeEnvironment;
  degradedProviderConfirmed?: boolean;
  ensureSourceChain?: EnsureSourceChain;
}): Promise<UnifiedSpendResult> {
  const sourceChain = assertCircleAppKitChain(input.sourceChain);
  const destinationChain = assertCircleAppKitChain(input.destinationChain);
  const recipientAddress = assertAddress(input.recipientAddress);
  const amount = normalizeAmount(input.amount);

  assertUnifiedSpendMatchesAction({
    sourceChain,
    destinationChain,
    recipientAddress,
    amount,
    action: input.action,
  });

  assertExecutionReady({
    action: input.action,
    providerId: 'circle-appkit-unified-balance',
    providerCapability: 'UNIFIED_BALANCE',
    assetAddress: input.action.tokenAddress,
    runtimeEnvironment: input.runtimeEnvironment,
    degradedProviderConfirmed: input.degradedProviderConfirmed,
  });

  await assertWalletAccountMatchesAddress(
    input.provider,
    input.action.from,
    'Unified spend sender',
  );
  await input.ensureSourceChain?.();
  const adapter = await adapterFromProvider(input.provider);
  const params = {
    from: {
      adapter,
      allocations: { amount, chain: sourceChain },
    },
    to: {
      chain: destinationChain,
      recipientAddress,
      useForwarder: true,
    },
    amount,
    token: 'USDC',
  } as unknown as UnifiedSpendParams;
  return appKit.unifiedBalance.spend(params);
}

export interface AppKitSwapReviewRequest {
  chain: CircleAppKitChain;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  slippageBps?: number;
  veyraFee: VeyraFeeQuote;
}

export interface ReviewedAppKitSwap {
  request: AppKitSwapReviewRequest;
  estimate: SwapEstimate;
}


export function assertReviewedAppKitSwapMatchesAction(
  reviewed: ReviewedAppKitSwap,
  action: ConvertAction,
): void {
  if (action.providerId !== 'circle-appkit-swap') {
    throw new Error('[appKit] Swap action provider does not match circle-appkit-swap.');
  }

  if (
    action.provenance.providerId !== undefined &&
    action.provenance.providerId !== 'circle-appkit-swap'
  ) {
    throw new Error('[appKit] Swap action provenance provider does not match circle-appkit-swap.');
  }

  const chainId = appKitTestnetChainId(reviewed.request.chain);
  if (
    chainId !== MANIFEST_CONSTANTS.ARC_TESTNET_CHAIN_ID ||
    action.chainId !== chainId
  ) {
    throw new Error('[appKit] Reviewed swap chain does not match the deterministic action.');
  }

  const tokenIn = arcTestnetAssetAddress(reviewed.request.tokenIn);
  const tokenOut = arcTestnetAssetAddress(reviewed.request.tokenOut);
  if (!tokenIn || !tokenOut) {
    throw new Error('[appKit] Reviewed swap asset is outside the verified Arc testnet scope.');
  }
  if (action.fromTokenAddress.toLowerCase() !== tokenIn.toLowerCase()) {
    throw new Error('[appKit] Reviewed swap input asset does not match the deterministic action.');
  }
  if (action.toTokenAddress.toLowerCase() !== tokenOut.toLowerCase()) {
    throw new Error('[appKit] Reviewed swap output asset does not match the deterministic action.');
  }

  const reviewedAmount = parseUnits(reviewed.request.amountIn, action.fromTokenDecimals);
  if (reviewedAmount !== action.amountIn) {
    throw new Error('[appKit] Reviewed swap amount does not match the deterministic action.');
  }

  if (reviewed.request.slippageBps !== action.slippageBps) {
    throw new Error('[appKit] Reviewed swap slippage does not match the deterministic action.');
  }
}

/** Estimate-only. Execution requires a later explicit user action. */
export async function reviewAppKitSwap(input: {
  provider: EIP1193Provider;
  chain: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  slippageBps?: number;
  environment?: 'testnet' | 'mainnet';
  treasuryAddress?: string | null;
  ensureSourceChain?: EnsureSourceChain;
}): Promise<ReviewedAppKitSwap> {
  const chain = assertCircleAppKitChain(input.chain);
  const amountIn = normalizeAmount(input.amountIn);
  const slippageBps = input.slippageBps ?? SECURITY_CONFIG.DEFAULT_MAX_SLIPPAGE_BPS;
  if (slippageBps < 0 || slippageBps > SECURITY_CONFIG.HARD_MAX_SLIPPAGE_BPS) {
    throw new Error('Swap slippage is outside Veyra safety bounds');
  }
  if (!input.tokenIn.trim() || !input.tokenOut.trim()) throw new Error('Swap tokens are required');
  if (input.tokenIn.toUpperCase() === input.tokenOut.toUpperCase()) {
    throw new Error('Swap input and output assets must be different');
  }
  if (chain === 'Arc' || chain === 'Arc_Testnet') {
    const pair = new Set([input.tokenIn.toUpperCase(), input.tokenOut.toUpperCase()]);
    if (pair.has('USDC') && pair.has('NATIVE')) {
      throw new Error('USDC and NATIVE are the same asset on Arc');
    }
  }
  await input.ensureSourceChain?.();
  const adapter = await adapterFromProvider(input.provider);
  const environment = input.environment ?? (chain.endsWith('_Testnet') || chain.endsWith('_Sepolia') ? 'testnet' : 'mainnet');
  const treasuryAddress =
    input.treasuryAddress ?? configuredVeyraTreasuryAddress(environment);
  const veyraFee = quoteVeyraFee({
    capability: 'SWAP',
    providerId: 'circle-appkit-swap',
    environment,
    treasuryAddress,
  });
  const config = {
    slippageBps,
    ...(veyraFee.status === 'COLLECTIBLE' && veyraFee.treasuryAddress
      ? {
          customFee: {
            percentageBps: veyraFee.percentageBps,
            recipientAddress: veyraFee.treasuryAddress,
          },
        }
      : {}),
  };
  const params = {
    from: { adapter, chain },
    tokenIn: input.tokenIn,
    tokenOut: input.tokenOut,
    amountIn,
    ...(Object.keys(config).length > 0 ? { config } : {}),
  } as unknown as SwapParams;
  const estimate = await appKit.estimateSwap(params);
  return {
    request: {
      chain,
      tokenIn: input.tokenIn,
      tokenOut: input.tokenOut,
      amountIn,
      slippageBps,
      veyraFee,
    },
    estimate,
  };
}

export async function executeReviewedAppKitSwap(input: {
  provider: EIP1193Provider;
  reviewed: ReviewedAppKitSwap;
  action: ConvertAction;
  walletAddress: string;
  runtimeEnvironment: ExecutionRuntimeEnvironment;
  degradedProviderConfirmed?: boolean;
  ensureSourceChain?: EnsureSourceChain;
}): Promise<SwapResult> {
  assertReviewedAppKitSwapMatchesAction(input.reviewed, input.action);

  assertExecutionReady({
    action: input.action,
    providerId: 'circle-appkit-swap',
    providerCapability: 'SWAP',
    assetAddress: input.action.fromTokenAddress,
    runtimeEnvironment: input.runtimeEnvironment,
    degradedProviderConfirmed: input.degradedProviderConfirmed,
  });

  await assertWalletAccountMatchesAddress(
    input.provider,
    assertAddress(input.walletAddress),
    'swap sender',
  );
  await input.ensureSourceChain?.();
  const adapter = await adapterFromProvider(input.provider);
  const request = input.reviewed.request;
  const config = {
    ...(request.slippageBps !== undefined ? { slippageBps: request.slippageBps } : {}),
    ...(request.veyraFee.status === 'COLLECTIBLE' && request.veyraFee.treasuryAddress
      ? {
          customFee: {
            percentageBps: request.veyraFee.percentageBps,
            recipientAddress: request.veyraFee.treasuryAddress,
          },
        }
      : {}),
  };
  const params = {
    from: { adapter, chain: request.chain },
    tokenIn: request.tokenIn,
    tokenOut: request.tokenOut,
    amountIn: request.amountIn,
    ...(Object.keys(config).length > 0 ? { config } : {}),
  } as unknown as SwapParams;
  return appKit.swap(params);
}

/** Discover is read-only; returned metadata must be surfaced with provenance. */
export async function exploreAppKitEarnVaults(input: {
  chain: string;
  sortBy?: 'apy';
}): Promise<EarnExploreResult> {
  const chain = assertCircleAppKitChain(input.chain);
  const params = { chain, sortBy: input.sortBy ?? 'apy' } as unknown as EarnExploreParams;
  return appKit.earn.exploreVaults(params);
}

export interface AppKitEarnReviewRequest {
  chain: CircleAppKitChain;
  vaultAddress: string;
  amount: string;
}

export interface ReviewedAppKitEarnDeposit {
  request: AppKitEarnReviewRequest;
  quote: EarnDepositQuote;
}

export interface ReviewedAppKitEarnWithdrawal {
  request: AppKitEarnReviewRequest;
  quote: EarnWithdrawalQuote;
}

function assertEarnExplainabilityMatchesAction(
  explainability: EarnExplainabilityInput,
  request: AppKitEarnReviewRequest,
  tokenDecimals: number,
  expectedAmount: bigint,
): void {
  assertEarnExplainabilityComplete(explainability);

  if (explainability.providerId !== 'circle-appkit-earn') {
    throw new Error('[appKit] Earn explainability provider does not match circle-appkit-earn.');
  }
  if (explainability.chain.trim() !== request.chain) {
    throw new Error('[appKit] Earn explainability chain does not match the reviewed request.');
  }
  if (explainability.vaultAddress.toLowerCase() !== request.vaultAddress.toLowerCase()) {
    throw new Error('[appKit] Earn explainability vault does not match the reviewed request.');
  }
  if (explainability.asset.trim().toUpperCase() !== 'USDC') {
    throw new Error('[appKit] Earn explainability asset must be USDC for the current verified scope.');
  }
  if (parseUnits(explainability.amount, tokenDecimals) !== expectedAmount) {
    throw new Error('[appKit] Earn explainability amount does not match the deterministic action.');
  }
}

export function assertReviewedEarnDepositMatchesAction(
  reviewed: ReviewedAppKitEarnDeposit,
  action: SupplyAction,
  explainability: EarnExplainabilityInput,
): void {
  if (action.providerId !== 'circle-appkit-earn') {
    throw new Error('[appKit] Earn deposit action provider does not match circle-appkit-earn.');
  }
  if (
    action.provenance.providerId !== undefined &&
    action.provenance.providerId !== 'circle-appkit-earn'
  ) {
    throw new Error('[appKit] Earn deposit provenance provider does not match circle-appkit-earn.');
  }

  const chainId = appKitTestnetChainId(reviewed.request.chain);
  if (
    chainId !== MANIFEST_CONSTANTS.ARC_TESTNET_CHAIN_ID ||
    action.chainId !== chainId
  ) {
    throw new Error('[appKit] Reviewed Earn deposit chain does not match the deterministic action.');
  }

  if (
    action.protocolAddress.toLowerCase() !==
    reviewed.request.vaultAddress.toLowerCase()
  ) {
    throw new Error('[appKit] Reviewed Earn deposit vault does not match the deterministic action.');
  }

  if (
    action.tokenAddress.toLowerCase() !==
    MANIFEST_CONSTANTS.ARC_TESTNET_USDC.toLowerCase()
  ) {
    throw new Error('[appKit] Earn deposit asset must be Arc Testnet USDC.');
  }

  const reviewedAmount = parseUnits(reviewed.request.amount, action.tokenDecimals);
  if (reviewedAmount !== action.amount) {
    throw new Error('[appKit] Reviewed Earn deposit amount does not match the deterministic action.');
  }

  assertEarnExplainabilityMatchesAction(
    explainability,
    reviewed.request,
    action.tokenDecimals,
    action.amount,
  );
}

export function assertReviewedEarnWithdrawalMatchesAction(
  reviewed: ReviewedAppKitEarnWithdrawal,
  action: WithdrawAction,
  explainability: EarnExplainabilityInput,
): void {
  if (action.providerId !== 'circle-appkit-earn') {
    throw new Error('[appKit] Earn withdrawal action provider does not match circle-appkit-earn.');
  }
  if (
    action.provenance.providerId !== undefined &&
    action.provenance.providerId !== 'circle-appkit-earn'
  ) {
    throw new Error('[appKit] Earn withdrawal provenance provider does not match circle-appkit-earn.');
  }

  const chainId = appKitTestnetChainId(reviewed.request.chain);
  if (
    chainId !== MANIFEST_CONSTANTS.ARC_TESTNET_CHAIN_ID ||
    action.chainId !== chainId
  ) {
    throw new Error('[appKit] Reviewed Earn withdrawal chain does not match the deterministic action.');
  }

  if (
    action.protocolAddress.toLowerCase() !==
    reviewed.request.vaultAddress.toLowerCase()
  ) {
    throw new Error('[appKit] Reviewed Earn withdrawal vault does not match the deterministic action.');
  }

  if (
    action.tokenAddress.toLowerCase() !==
    MANIFEST_CONSTANTS.ARC_TESTNET_USDC.toLowerCase()
  ) {
    throw new Error('[appKit] Earn withdrawal asset must be Arc Testnet USDC.');
  }

  const reviewedAmount = parseUnits(reviewed.request.amount, action.tokenDecimals);
  if (reviewedAmount !== action.amount) {
    throw new Error('[appKit] Reviewed Earn withdrawal amount does not match the deterministic action.');
  }

  assertEarnExplainabilityMatchesAction(
    explainability,
    reviewed.request,
    action.tokenDecimals,
    action.amount,
  );
}

export async function reviewEarnDeposit(input: {
  provider: EIP1193Provider;
  chain: string;
  vaultAddress: string;
  amount: string;
  ensureSourceChain?: EnsureSourceChain;
}): Promise<ReviewedAppKitEarnDeposit> {
  const chain = assertCircleAppKitChain(input.chain);
  const amount = normalizeAmount(input.amount);
  const vaultAddress = assertAddress(input.vaultAddress);
  await input.ensureSourceChain?.();
  const adapter = await adapterFromProvider(input.provider);
  const params = {
    from: { adapter, chain },
    vaultAddress,
    amount,
  } as unknown as EarnDepositQuoteParams;
  const quote = await appKit.earn.getDepositQuote(params);
  return {
    request: { chain, vaultAddress, amount },
    quote,
  };
}

export async function executeEarnDeposit(input: {
  provider: EIP1193Provider;
  reviewed: ReviewedAppKitEarnDeposit;
  action: SupplyAction;
  explainability: EarnExplainabilityInput;
  runtimeEnvironment: ExecutionRuntimeEnvironment;
  degradedProviderConfirmed?: boolean;
  ensureSourceChain?: EnsureSourceChain;
}): Promise<EarnDepositResult> {
  assertReviewedEarnDepositMatchesAction(
    input.reviewed,
    input.action,
    input.explainability,
  );

  assertExecutionReady({
    action: input.action,
    providerId: 'circle-appkit-earn',
    providerCapability: 'EARN_DEPOSIT',
    assetAddress: input.action.tokenAddress,
    runtimeEnvironment: input.runtimeEnvironment,
    degradedProviderConfirmed: input.degradedProviderConfirmed,
  });

  await assertWalletAccountMatchesAddress(
    input.provider,
    input.action.from,
    'Earn deposit sender',
  );
  await input.ensureSourceChain?.();

  const adapter = await adapterFromProvider(input.provider);
  const params = {
    from: { adapter, chain: input.reviewed.request.chain },
    vaultAddress: input.reviewed.request.vaultAddress,
    amount: input.reviewed.request.amount,
  } as unknown as EarnDepositParams;
  return appKit.earn.deposit(params);
}

export async function readEarnPosition(input: {
  provider: EIP1193Provider;
  chain: string;
  vaultAddress: string;
}): Promise<EarnPositionResult> {
  const chain = assertCircleAppKitChain(input.chain);
  const vaultAddress = assertAddress(input.vaultAddress);
  const adapter = await adapterFromProvider(input.provider);
  const params = {
    from: { adapter, chain },
    vaultAddress,
  } as unknown as EarnPositionParams;
  return appKit.earn.getPosition(params);
}

export async function reviewEarnWithdrawal(input: {
  provider: EIP1193Provider;
  chain: string;
  vaultAddress: string;
  amount: string;
  ensureSourceChain?: EnsureSourceChain;
}): Promise<ReviewedAppKitEarnWithdrawal> {
  const chain = assertCircleAppKitChain(input.chain);
  const amount = normalizeAmount(input.amount);
  const vaultAddress = assertAddress(input.vaultAddress);
  await input.ensureSourceChain?.();
  const adapter = await adapterFromProvider(input.provider);
  const params = {
    from: { adapter, chain },
    vaultAddress,
    amount,
  } as unknown as EarnWithdrawalQuoteParams;
  const quote = await appKit.earn.getWithdrawalQuote(params);
  return {
    request: { chain, vaultAddress, amount },
    quote,
  };
}

export async function executeEarnWithdrawal(input: {
  provider: EIP1193Provider;
  reviewed: ReviewedAppKitEarnWithdrawal;
  action: WithdrawAction;
  explainability: EarnExplainabilityInput;
  runtimeEnvironment: ExecutionRuntimeEnvironment;
  degradedProviderConfirmed?: boolean;
  ensureSourceChain?: EnsureSourceChain;
}): Promise<EarnWithdrawResult> {
  assertReviewedEarnWithdrawalMatchesAction(
    input.reviewed,
    input.action,
    input.explainability,
  );

  assertExecutionReady({
    action: input.action,
    providerId: 'circle-appkit-earn',
    providerCapability: 'EARN_WITHDRAW',
    assetAddress: input.action.tokenAddress,
    runtimeEnvironment: input.runtimeEnvironment,
    degradedProviderConfirmed: input.degradedProviderConfirmed,
  });

  await assertWalletAccountMatchesAddress(
    input.provider,
    input.action.to,
    'Earn withdrawal recipient',
  );
  await input.ensureSourceChain?.();

  const adapter = await adapterFromProvider(input.provider);
  const params = {
    from: { adapter, chain: input.reviewed.request.chain },
    vaultAddress: input.reviewed.request.vaultAddress,
    amount: input.reviewed.request.amount,
  } as unknown as EarnWithdrawParams;
  return appKit.earn.withdraw(params);
}

export { appKit };
