import type {
  BridgeAction,
  SupplyAction,
  WithdrawAction,
} from '../actions/actionSchema';
import { verifyExactTokenDelta } from './receiptVerification';
import { generateExecutionReceiptId } from '../receipt/receiptId';
import type { VeyraReceipt } from '../receipt/receiptTypes';
import { MANIFEST_CONSTANTS } from '../../providers/registry/providerManifest';

const EVM_TX_HASH = /^0x[0-9a-fA-F]{64}$/;
const MAX_RESULT_SCAN_NODES = 256;
const MAX_RESULT_SCAN_DEPTH = 8;

export interface AppKitAuthoritativeEvmReceipt {
  txHash: string;
  status: 'success' | 'reverted';
  blockNumber: number;
}

export interface AppKitCrossChainFinalStateEvidence {
  sourceReceipt: AppKitAuthoritativeEvmReceipt;
  destinationReceipt?: AppKitAuthoritativeEvmReceipt;
  destinationAccount: string;
  destinationTokenAddress: string;
  destinationBalanceBefore: bigint;
  destinationBalanceAfter: bigint;
}

export interface AppKitEarnFinalStateEvidence {
  receipt: AppKitAuthoritativeEvmReceipt;
  tokenAddress: string;
  vaultAddress: string;
  /**
   * Exact asset movement decoded from authoritative chain receipt/logs.
   * This must not be copied from the provider SDK result.
   */
  assetTransferAmount: bigint;
  /**
   * True only after an independent post-transaction position read confirms
   * the expected position transition.
   */
  positionVerified: boolean;
}

export interface AppKitFundMovementVerification {
  verified: boolean;
  detail: string;
  primaryTxHash: string | null;
  primaryBlock: number | null;
  destinationTxHash?: string;
  destinationBlock?: number;
  actualAmount: bigint;
  expectedAmount: bigint;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : null;
}

function validReceipt(
  receipt: AppKitAuthoritativeEvmReceipt,
): boolean {
  return (
    EVM_TX_HASH.test(receipt.txHash) &&
    receipt.status === 'success' &&
    Number.isSafeInteger(receipt.blockNumber) &&
    receipt.blockNumber >= 0
  );
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

/**
 * Collect EVM transaction hashes from an opaque SDK result without trusting its
 * schema. The scan is cycle-safe and bounded because provider responses are
 * external input.
 */
export function collectAppKitResultTxHashes(result: unknown): string[] {
  const hashes = new Set<string>();
  const seen = new WeakSet<object>();
  const queue: Array<{ value: unknown; depth: number }> = [
    { value: result, depth: 0 },
  ];
  let visited = 0;

  while (queue.length > 0 && visited < MAX_RESULT_SCAN_NODES) {
    const current = queue.shift()!;
    visited++;

    if (
      typeof current.value === 'string' &&
      EVM_TX_HASH.test(current.value)
    ) {
      hashes.add(current.value.toLowerCase());
      continue;
    }

    if (
      current.depth >= MAX_RESULT_SCAN_DEPTH ||
      !current.value ||
      typeof current.value !== 'object'
    ) {
      continue;
    }

    const object = current.value;
    if (seen.has(object)) continue;
    seen.add(object);

    if (Array.isArray(current.value)) {
      for (const value of current.value) {
        queue.push({ value, depth: current.depth + 1 });
      }
      continue;
    }

    for (const value of Object.values(
      current.value as Record<string, unknown>,
    )) {
      queue.push({ value, depth: current.depth + 1 });
    }
  }

  return [...hashes].sort();
}

function resultContainsTxHash(result: unknown, txHash: string): boolean {
  const normalized = txHash.toLowerCase();
  return collectAppKitResultTxHashes(result).includes(normalized);
}

function verifyCrossChainFinalState(input: {
  result: unknown;
  action: BridgeAction;
  providerId: string;
  evidence: AppKitCrossChainFinalStateEvidence;
  requireBridgeSuccessState: boolean;
}): AppKitFundMovementVerification {
  const fail = (detail: string): AppKitFundMovementVerification => ({
    verified: false,
    detail,
    primaryTxHash: null,
    primaryBlock: null,
    actualAmount:
      input.evidence.destinationBalanceAfter -
      input.evidence.destinationBalanceBefore,
    expectedAmount: input.action.amount,
  });

  if (input.action.providerId !== input.providerId) {
    return fail(`BridgeAction provider is not ${input.providerId}.`);
  }

  if (input.action.chainId !== input.action.sourceChainId) {
    return fail('BridgeAction primary chain does not match source chain.');
  }

  if (
    input.evidence.destinationAccount.toLowerCase() !==
    input.action.to.toLowerCase()
  ) {
    return fail('Destination evidence account does not match reviewed recipient.');
  }

  const destinationUsdc = expectedTestnetUsdc(
    input.action.destinationChainId,
  );
  if (
    !destinationUsdc ||
    input.evidence.destinationTokenAddress.toLowerCase() !==
      destinationUsdc.toLowerCase()
  ) {
    return fail(
      'Destination evidence token does not match the verified destination-chain USDC deployment.',
    );
  }

  if (!validReceipt(input.evidence.sourceReceipt)) {
    return fail('Authoritative source transaction receipt is not successful/valid.');
  }

  if (
    input.evidence.destinationReceipt &&
    !validReceipt(input.evidence.destinationReceipt)
  ) {
    return fail(
      'Authoritative destination transaction receipt is not successful/valid.',
    );
  }

  if (input.requireBridgeSuccessState) {
    const record = asRecord(input.result);
    if (!record || record.state !== 'success') {
      return fail('App Kit bridge result is not terminal success.');
    }
  }

  if (
    !resultContainsTxHash(
      input.result,
      input.evidence.sourceReceipt.txHash,
    )
  ) {
    return fail(
      'App Kit result does not contain the authoritative source transaction hash.',
    );
  }

  if (
    input.evidence.destinationReceipt &&
    !resultContainsTxHash(
      input.result,
      input.evidence.destinationReceipt.txHash,
    )
  ) {
    return fail(
      'App Kit result does not contain the authoritative destination transaction hash.',
    );
  }

  const delta = verifyExactTokenDelta(
    input.evidence.destinationBalanceBefore,
    input.evidence.destinationBalanceAfter,
    input.action.amount,
  );
  if (!delta.verified) {
    return fail(delta.detail);
  }

  return {
    verified: true,
    detail:
      'App Kit cross-chain result matches successful authoritative receipts and exact destination USDC delta.',
    primaryTxHash: input.evidence.sourceReceipt.txHash,
    primaryBlock: input.evidence.sourceReceipt.blockNumber,
    ...(input.evidence.destinationReceipt
      ? {
          destinationTxHash: input.evidence.destinationReceipt.txHash,
          destinationBlock: input.evidence.destinationReceipt.blockNumber,
        }
      : {}),
    actualAmount: delta.actualDelta,
    expectedAmount: input.action.amount,
  };
}

export function verifyAppKitBridgeExecution(input: {
  result: unknown;
  action: BridgeAction;
  evidence: AppKitCrossChainFinalStateEvidence;
}): AppKitFundMovementVerification {
  return verifyCrossChainFinalState({
    ...input,
    providerId: 'circle-appkit-bridge',
    requireBridgeSuccessState: true,
  });
}

export function verifyAppKitUnifiedSpendExecution(input: {
  result: unknown;
  action: BridgeAction;
  evidence: AppKitCrossChainFinalStateEvidence;
}): AppKitFundMovementVerification {
  return verifyCrossChainFinalState({
    ...input,
    providerId: 'circle-appkit-unified-balance',
    // Unified result shape is kept opaque here. Chain receipts/state are the
    // authority; matching SDK transaction hashes bind the result to them.
    requireBridgeSuccessState: false,
  });
}

function buildVerifiedCrossChainReceipt(input: {
  verification: AppKitFundMovementVerification;
  action: BridgeAction;
  summary: string;
}): VeyraReceipt {
  if (
    !input.verification.verified ||
    !input.verification.primaryTxHash ||
    input.verification.primaryBlock === null
  ) {
    throw new Error(
      `[appKitReceipt] Cross-chain action cannot produce VERIFIED receipt: ${input.verification.detail}`,
    );
  }

  const now = Date.now();

  return {
    receiptId: generateExecutionReceiptId(
      input.action.sourceChainId,
      input.verification.primaryTxHash,
    ),
    planId: input.action.actionId,
    actionType: 'BRIDGE',
    status: 'VERIFIED',
    chainId: input.action.sourceChainId,
    executionTxHash: input.verification.primaryTxHash,
    executionBlock: input.verification.primaryBlock,
    createdAt: input.action.createdAt,
    completedAt: now,
    actualAmountDelta: input.verification.actualAmount,
    expectedAmountDelta: input.verification.expectedAmount,
    riskScore: null,
    policyDecision: 'PASS',
    displaySummary: input.summary,
    bridgeTrace: {
      sourceChainId: input.action.sourceChainId,
      destinationChainId: input.action.destinationChainId,
      sourceTxHash: input.verification.primaryTxHash,
      ...(input.verification.destinationTxHash
        ? { destinationTxHash: input.verification.destinationTxHash }
        : {}),
      sourceBlock: input.verification.primaryBlock,
      ...(input.verification.destinationBlock !== undefined
        ? { destinationBlock: input.verification.destinationBlock }
        : {}),
      bridgeStatus: 'VERIFIED',
      sourceTimestamp: input.action.createdAt,
      destinationTimestamp: now,
    },
  };
}

export function buildVerifiedAppKitBridgeReceipt(input: {
  result: unknown;
  action: BridgeAction;
  evidence: AppKitCrossChainFinalStateEvidence;
}): VeyraReceipt {
  return buildVerifiedCrossChainReceipt({
    verification: verifyAppKitBridgeExecution(input),
    action: input.action,
    summary:
      'App Kit bridge verified against authoritative source/destination chain evidence and exact recipient USDC delta.',
  });
}

export function buildVerifiedAppKitUnifiedSpendReceipt(input: {
  result: unknown;
  action: BridgeAction;
  evidence: AppKitCrossChainFinalStateEvidence;
}): VeyraReceipt {
  return buildVerifiedCrossChainReceipt({
    verification: verifyAppKitUnifiedSpendExecution(input),
    action: input.action,
    summary:
      'App Kit Unified spend verified against authoritative chain evidence and exact recipient USDC delta.',
  });
}

function verifyEarnMovement(input: {
  result: unknown;
  action: SupplyAction | WithdrawAction;
  evidence: AppKitEarnFinalStateEvidence;
  kind: 'deposit' | 'withdrawal';
}): AppKitFundMovementVerification {
  const fail = (detail: string): AppKitFundMovementVerification => ({
    verified: false,
    detail,
    primaryTxHash: null,
    primaryBlock: null,
    actualAmount: input.evidence.assetTransferAmount,
    expectedAmount: input.action.amount,
  });

  if (input.action.providerId !== 'circle-appkit-earn') {
    return fail('Earn action provider is not circle-appkit-earn.');
  }

  if (
    input.action.chainId !== MANIFEST_CONSTANTS.ARC_TESTNET_CHAIN_ID ||
    input.action.tokenAddress.toLowerCase() !==
      MANIFEST_CONSTANTS.ARC_TESTNET_USDC.toLowerCase()
  ) {
    return fail('Earn verification is outside the current Arc Testnet USDC scope.');
  }

  if (
    input.evidence.tokenAddress.toLowerCase() !==
    input.action.tokenAddress.toLowerCase()
  ) {
    return fail('Earn evidence token does not match the reviewed action.');
  }

  if (
    input.evidence.vaultAddress.toLowerCase() !==
    input.action.protocolAddress.toLowerCase()
  ) {
    return fail('Earn evidence vault does not match the reviewed action.');
  }

  if (!validReceipt(input.evidence.receipt)) {
    return fail('Authoritative Earn transaction receipt is not successful/valid.');
  }

  if (!resultContainsTxHash(input.result, input.evidence.receipt.txHash)) {
    return fail(
      'App Kit Earn result does not contain the authoritative transaction hash.',
    );
  }

  if (input.evidence.assetTransferAmount !== input.action.amount) {
    return fail(
      `Authoritative Earn ${input.kind} asset movement does not match the reviewed amount.`,
    );
  }

  if (!input.evidence.positionVerified) {
    return fail(
      `Independent post-transaction Earn ${input.kind} position verification has not passed.`,
    );
  }

  return {
    verified: true,
    detail:
      `App Kit Earn ${input.kind} matches successful authoritative chain evidence and verified position state.`,
    primaryTxHash: input.evidence.receipt.txHash,
    primaryBlock: input.evidence.receipt.blockNumber,
    actualAmount: input.evidence.assetTransferAmount,
    expectedAmount: input.action.amount,
  };
}

export function verifyAppKitEarnDepositExecution(input: {
  result: unknown;
  action: SupplyAction;
  evidence: AppKitEarnFinalStateEvidence;
}): AppKitFundMovementVerification {
  return verifyEarnMovement({ ...input, kind: 'deposit' });
}

export function verifyAppKitEarnWithdrawalExecution(input: {
  result: unknown;
  action: WithdrawAction;
  evidence: AppKitEarnFinalStateEvidence;
}): AppKitFundMovementVerification {
  return verifyEarnMovement({ ...input, kind: 'withdrawal' });
}

function buildVerifiedEarnReceipt(input: {
  verification: AppKitFundMovementVerification;
  action: SupplyAction | WithdrawAction;
  summary: string;
}): VeyraReceipt {
  if (
    !input.verification.verified ||
    !input.verification.primaryTxHash ||
    input.verification.primaryBlock === null
  ) {
    throw new Error(
      `[appKitReceipt] Earn action cannot produce VERIFIED receipt: ${input.verification.detail}`,
    );
  }

  return {
    receiptId: generateExecutionReceiptId(
      input.action.chainId,
      input.verification.primaryTxHash,
    ),
    planId: input.action.actionId,
    actionType: input.action.actionType,
    status: 'VERIFIED',
    chainId: input.action.chainId,
    executionTxHash: input.verification.primaryTxHash,
    executionBlock: input.verification.primaryBlock,
    createdAt: input.action.createdAt,
    completedAt: Date.now(),
    actualAmountDelta: input.verification.actualAmount,
    expectedAmountDelta: input.verification.expectedAmount,
    riskScore: null,
    policyDecision: 'PASS',
    displaySummary: input.summary,
  };
}

export function buildVerifiedAppKitEarnDepositReceipt(input: {
  result: unknown;
  action: SupplyAction;
  evidence: AppKitEarnFinalStateEvidence;
}): VeyraReceipt {
  return buildVerifiedEarnReceipt({
    verification: verifyAppKitEarnDepositExecution(input),
    action: input.action,
    summary:
      'App Kit Earn deposit verified against authoritative transaction evidence and independent position state.',
  });
}

export function buildVerifiedAppKitEarnWithdrawalReceipt(input: {
  result: unknown;
  action: WithdrawAction;
  evidence: AppKitEarnFinalStateEvidence;
}): VeyraReceipt {
  return buildVerifiedEarnReceipt({
    verification: verifyAppKitEarnWithdrawalExecution(input),
    action: input.action,
    summary:
      'App Kit Earn withdrawal verified against authoritative transaction evidence and independent position state.',
  });
}
