import { AppKit } from '@circle-fin/app-kit';
import { createViemAdapterFromProvider } from '@circle-fin/adapter-viem-v2';
import type { EIP1193Provider } from 'viem';
import { assertRetryBridgeAllowed } from '../../core/router/bridgeRecovery';
import {
  assertCircleAppKitChain,
  type CircleAppKitChain,
} from './appKitChains';

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
  ensureSourceChain?: EnsureSourceChain;
}): Promise<BridgeResult> {
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
}): Promise<BridgeResult> {
  assertRetryBridgeAllowed(input.result);
  const adapter = await adapterFromProvider(input.provider);
  return appKit.retryBridge(input.result, { from: adapter, to: adapter });
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

export async function depositUnifiedUsdc(input: {
  provider: EIP1193Provider;
  sourceChain: string;
  amount: string;
  allowanceStrategy?: 'authorize' | 'permit' | 'approve';
  ensureSourceChain?: EnsureSourceChain;
}): Promise<UnifiedDepositResult> {
  const chain = assertCircleAppKitChain(input.sourceChain);
  const amount = normalizeAmount(input.amount);
  await input.ensureSourceChain?.();
  const adapter = await adapterFromProvider(input.provider);
  const params = {
    from: { adapter, chain },
    amount,
    token: 'USDC',
    ...(input.allowanceStrategy
      ? { allowanceStrategy: input.allowanceStrategy }
      : {}),
  } as unknown as UnifiedDepositParams;
  return appKit.unifiedBalance.deposit(params);
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
  ensureSourceChain?: EnsureSourceChain;
}): Promise<UnifiedSpendResult> {
  const sourceChain = assertCircleAppKitChain(input.sourceChain);
  const destinationChain = assertCircleAppKitChain(input.destinationChain);
  const recipientAddress = assertAddress(input.recipientAddress);
  const amount = normalizeAmount(input.amount);
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
}

export interface ReviewedAppKitSwap {
  request: AppKitSwapReviewRequest;
  estimate: SwapEstimate;
}

/** Estimate-only. Execution requires a later explicit user action. */
export async function reviewAppKitSwap(input: {
  provider: EIP1193Provider;
  chain: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  slippageBps?: number;
  ensureSourceChain?: EnsureSourceChain;
}): Promise<ReviewedAppKitSwap> {
  const chain = assertCircleAppKitChain(input.chain);
  const amountIn = normalizeAmount(input.amountIn);
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
  const params = {
    from: { adapter, chain },
    tokenIn: input.tokenIn,
    tokenOut: input.tokenOut,
    amountIn,
    ...(input.slippageBps !== undefined
      ? { config: { slippageBps: input.slippageBps } }
      : {}),
  } as unknown as SwapParams;
  const estimate = await appKit.estimateSwap(params);
  return {
    request: {
      chain,
      tokenIn: input.tokenIn,
      tokenOut: input.tokenOut,
      amountIn,
      ...(input.slippageBps !== undefined ? { slippageBps: input.slippageBps } : {}),
    },
    estimate,
  };
}

export async function executeReviewedAppKitSwap(input: {
  provider: EIP1193Provider;
  reviewed: ReviewedAppKitSwap;
  ensureSourceChain?: EnsureSourceChain;
}): Promise<SwapResult> {
  await input.ensureSourceChain?.();
  const adapter = await adapterFromProvider(input.provider);
  const request = input.reviewed.request;
  const params = {
    from: { adapter, chain: request.chain },
    tokenIn: request.tokenIn,
    tokenOut: request.tokenOut,
    amountIn: request.amountIn,
    ...(request.slippageBps !== undefined
      ? { config: { slippageBps: request.slippageBps } }
      : {}),
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

export async function reviewEarnDeposit(input: {
  provider: EIP1193Provider;
  chain: string;
  vaultAddress: string;
  amount: string;
  ensureSourceChain?: EnsureSourceChain;
}): Promise<EarnDepositQuote> {
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
  return appKit.earn.getDepositQuote(params);
}

export async function executeEarnDeposit(input: {
  provider: EIP1193Provider;
  chain: string;
  vaultAddress: string;
  amount: string;
  ensureSourceChain?: EnsureSourceChain;
}): Promise<EarnDepositResult> {
  const chain = assertCircleAppKitChain(input.chain);
  const amount = normalizeAmount(input.amount);
  const vaultAddress = assertAddress(input.vaultAddress);
  await input.ensureSourceChain?.();
  const adapter = await adapterFromProvider(input.provider);
  const params = {
    from: { adapter, chain },
    vaultAddress,
    amount,
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
}): Promise<EarnWithdrawalQuote> {
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
  return appKit.earn.getWithdrawalQuote(params);
}

export async function executeEarnWithdrawal(input: {
  provider: EIP1193Provider;
  chain: string;
  vaultAddress: string;
  amount: string;
  ensureSourceChain?: EnsureSourceChain;
}): Promise<EarnWithdrawResult> {
  const chain = assertCircleAppKitChain(input.chain);
  const amount = normalizeAmount(input.amount);
  const vaultAddress = assertAddress(input.vaultAddress);
  await input.ensureSourceChain?.();
  const adapter = await adapterFromProvider(input.provider);
  const params = {
    from: { adapter, chain },
    vaultAddress,
    amount,
  } as unknown as EarnWithdrawParams;
  return appKit.earn.withdraw(params);
}

export { appKit };
