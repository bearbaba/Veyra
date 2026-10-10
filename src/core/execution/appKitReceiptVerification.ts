import { parseUnits } from 'viem';
import type { ConvertAction } from '../actions/actionSchema';
import { verifyMinimumOutput } from './receiptVerification';
import { generateExecutionReceiptId } from '../receipt/receiptId';
import type { VeyraReceipt } from '../receipt/receiptTypes';
import { MANIFEST_CONSTANTS } from '../../providers/registry/providerManifest';

const EVM_TX_HASH = /^0x[0-9a-fA-F]{64}$/;

export interface AppKitSwapChainReceiptEvidence {
  txHash: string;
  status: 'success' | 'reverted';
  blockNumber: number;
  /**
   * Output amount decoded from authoritative chain receipt/log evidence.
   * Do not pass the SDK-reported amount here.
   */
  outputAmount: bigint;
}

export interface AppKitSwapExecutionVerification {
  verified: boolean;
  detail: string;
  txHash: string | null;
  providerOutputAmount: bigint | null;
  authoritativeOutputAmount: bigint;
  minimumOutputAmount: bigint;
  executionBlock: number | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : null;
}


function isEvmAddress(value: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(value);
}

function actionIsVerifiedArcStablePair(action: ConvertAction): boolean {
  if (action.chainId !== MANIFEST_CONSTANTS.ARC_TESTNET_CHAIN_ID) return false;

  const pair = new Set([
    action.fromTokenAddress.toLowerCase(),
    action.toTokenAddress.toLowerCase(),
  ]);

  return (
    pair.size === 2 &&
    pair.has(MANIFEST_CONSTANTS.ARC_TESTNET_USDC.toLowerCase()) &&
    pair.has(MANIFEST_CONSTANTS.ARC_TESTNET_EURC.toLowerCase())
  );
}

function arcAssetMatches(value: unknown, tokenAddress: string): boolean {
  if (typeof value !== 'string') return false;
  const normalized = value.trim().toLowerCase();
  const address = tokenAddress.toLowerCase();

  if (address === MANIFEST_CONSTANTS.ARC_TESTNET_USDC.toLowerCase()) {
    return (
      normalized === 'usdc' ||
      normalized === MANIFEST_CONSTANTS.ARC_TESTNET_USDC.toLowerCase()
    );
  }

  if (address === MANIFEST_CONSTANTS.ARC_TESTNET_EURC.toLowerCase()) {
    return (
      normalized === 'eurc' ||
      normalized === MANIFEST_CONSTANTS.ARC_TESTNET_EURC.toLowerCase()
    );
  }

  return normalized === address;
}

/**
 * Verify an App Kit same-chain swap result against authoritative chain evidence.
 *
 * Provider result state alone is never enough for a VERIFIED Veyra receipt.
 * The caller must independently decode the output token amount from the
 * successful chain receipt/logs and pass it as receipt.outputAmount.
 */
export function verifyAppKitSwapExecution(input: {
  result: unknown;
  action: ConvertAction;
  expectedRecipientAddress: string;
  receipt: AppKitSwapChainReceiptEvidence;
}): AppKitSwapExecutionVerification {
  const fail = (
    detail: string,
    txHash: string | null = null,
    providerOutputAmount: bigint | null = null,
  ): AppKitSwapExecutionVerification => ({
    verified: false,
    detail,
    txHash,
    providerOutputAmount,
    authoritativeOutputAmount: input.receipt.outputAmount,
    minimumOutputAmount: input.action.minAmountOut,
    executionBlock: null,
  });

  if (input.action.providerId !== 'circle-appkit-swap') {
    return fail('ConvertAction provider is not circle-appkit-swap.');
  }

  if (
    input.action.provenance.providerId !== undefined &&
    input.action.provenance.providerId !== 'circle-appkit-swap'
  ) {
    return fail('ConvertAction provenance provider is not circle-appkit-swap.');
  }

  if (!actionIsVerifiedArcStablePair(input.action)) {
    return fail(
      'ConvertAction is outside the verified Arc Testnet USDC/EURC swap scope.',
    );
  }

  if (!isEvmAddress(input.expectedRecipientAddress)) {
    return fail('Expected swap recipient is not a valid EVM address.');
  }

  const result = asRecord(input.result);
  if (!result) return fail('App Kit swap result is not an object.');

  const progress = asRecord(result.progress);
  if (!progress || progress.status !== 'DONE') {
    return fail('App Kit swap result is not terminal DONE.');
  }
  if (
    progress.substatus !== undefined &&
    progress.substatus !== 'COMPLETED'
  ) {
    return fail('App Kit swap terminal substatus is not COMPLETED.');
  }

  if (result.chainIn !== 'Arc_Testnet' || result.chainOut !== 'Arc_Testnet') {
    return fail('App Kit swap result is outside the verified Arc Testnet scope.');
  }

  if (!arcAssetMatches(result.tokenIn, input.action.fromTokenAddress)) {
    return fail('App Kit swap input asset does not match the reviewed action.');
  }
  if (!arcAssetMatches(result.tokenOut, input.action.toTokenAddress)) {
    return fail('App Kit swap output asset does not match the reviewed action.');
  }

  if (
    typeof result.fromAddress !== 'string' ||
    typeof result.toAddress !== 'string' ||
    result.fromAddress.toLowerCase() !== input.expectedRecipientAddress.toLowerCase() ||
    result.toAddress.toLowerCase() !== input.expectedRecipientAddress.toLowerCase()
  ) {
    return fail('App Kit swap result wallet does not match the reviewed recipient.');
  }

  if (typeof result.amountIn !== 'string') {
    return fail('App Kit swap result is missing amountIn.');
  }

  let providerAmountIn: bigint;
  try {
    providerAmountIn = parseUnits(
      result.amountIn,
      input.action.fromTokenDecimals,
    );
  } catch {
    return fail('App Kit swap result amountIn is invalid.');
  }

  if (providerAmountIn !== input.action.amountIn) {
    return fail('App Kit swap result amountIn does not match the reviewed action.');
  }

  if (typeof result.amountOut !== 'string') {
    return fail('App Kit swap result is missing terminal amountOut.');
  }

  let providerOutputAmount: bigint;
  try {
    providerOutputAmount = parseUnits(
      result.amountOut,
      input.action.toTokenDecimals,
    );
  } catch {
    return fail('App Kit swap result amountOut is invalid.');
  }

  const txHash = typeof result.txHash === 'string' ? result.txHash : null;
  if (!txHash || !EVM_TX_HASH.test(txHash)) {
    return fail('App Kit swap result has no valid EVM transaction hash.', null, providerOutputAmount);
  }

  if (
    !EVM_TX_HASH.test(input.receipt.txHash) ||
    input.receipt.txHash.toLowerCase() !== txHash.toLowerCase()
  ) {
    return fail(
      'Authoritative chain receipt hash does not match the App Kit result.',
      txHash,
      providerOutputAmount,
    );
  }

  if (input.receipt.status !== 'success') {
    return fail(
      'Authoritative chain receipt did not succeed.',
      txHash,
      providerOutputAmount,
    );
  }

  if (!Number.isSafeInteger(input.receipt.blockNumber) || input.receipt.blockNumber < 0) {
    return fail(
      'Authoritative chain receipt block number is invalid.',
      txHash,
      providerOutputAmount,
    );
  }

  if (input.receipt.outputAmount !== providerOutputAmount) {
    return fail(
      'Authoritative output amount does not match the provider-reported terminal output.',
      txHash,
      providerOutputAmount,
    );
  }

  const minimum = verifyMinimumOutput(
    input.receipt.outputAmount,
    input.action.minAmountOut,
  );
  if (!minimum.verified) {
    return fail(minimum.detail, txHash, providerOutputAmount);
  }

  return {
    verified: true,
    detail:
      'App Kit swap terminal result matches successful authoritative chain receipt and reviewed minimum output.',
    txHash,
    providerOutputAmount,
    authoritativeOutputAmount: input.receipt.outputAmount,
    minimumOutputAmount: input.action.minAmountOut,
    executionBlock: input.receipt.blockNumber,
  };
}

export function buildVerifiedAppKitSwapReceipt(input: {
  result: unknown;
  action: ConvertAction;
  expectedRecipientAddress: string;
  receipt: AppKitSwapChainReceiptEvidence;
}): VeyraReceipt {
  const verification = verifyAppKitSwapExecution(input);

  if (
    !verification.verified ||
    !verification.txHash ||
    verification.executionBlock === null
  ) {
    throw new Error(
      `[appKitReceipt] Swap cannot produce VERIFIED receipt: ${verification.detail}`,
    );
  }

  return {
    receiptId: generateExecutionReceiptId(
      input.action.chainId,
      verification.txHash,
    ),
    planId: input.action.actionId,
    actionType: 'CONVERT',
    status: 'VERIFIED',
    chainId: input.action.chainId,
    executionTxHash: verification.txHash,
    executionBlock: verification.executionBlock,
    createdAt: input.action.createdAt,
    completedAt: Date.now(),
    actualAmountDelta: verification.authoritativeOutputAmount,
    expectedAmountDelta: input.action.minAmountOut,
    riskScore: null,
    policyDecision: null,
    displaySummary:
      'App Kit swap verified against the successful chain receipt and decoded output amount.',
  };
}
