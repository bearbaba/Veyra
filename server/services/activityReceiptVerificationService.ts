import {
  createPublicClient,
  http,
  type Address,
  type Hash,
  type Hex,
  type PublicClient,
} from 'viem';
import { baseSepolia, sepolia } from 'viem/chains';
import type { ActivityReceiptSyncInput } from '../db/repositories/receiptRepository.js';
import { MANIFEST_CONSTANTS } from '../../src/providers/registry/providerManifest.js';
import {
  verifyErc20TransferReceiptEvidence,
  verifyErc20TransferTransactionBinding,
} from '../../src/core/execution/receiptVerification.js';
import {
  verifyCctpDestinationReceiptEvidence,
  verifyCctpSourceReceiptEvidence,
  verifyCctpSourceTransactionBinding,
} from '../../src/providers/cctp/cctpV2Adapter.js';

export class ActivityReceiptVerificationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly httpStatus = 409,
  ) {
    super(message);
    this.name = 'ActivityReceiptVerificationError';
  }
}

function isTerminalClaim(input: ActivityReceiptSyncInput): boolean {
  return input.status === 'COMPLETE' || input.status === 'FAILED';
}

function arcClient(): PublicClient {
  const rpc = process.env.ARC_TESTNET_RPC_URL ?? 'https://rpc.testnet.arc.io';
  return createPublicClient({
    chain: {
      id: MANIFEST_CONSTANTS.ARC_TESTNET_CHAIN_ID,
      name: 'Arc Testnet',
      nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
      rpcUrls: { default: { http: [rpc] } },
    },
    transport: http(rpc),
  });
}

function destinationClient(chainId: number): PublicClient {
  if (chainId === MANIFEST_CONSTANTS.ETH_SEPOLIA_CHAIN_ID) {
    return createPublicClient({
      chain: sepolia,
      transport: http(
        process.env.ETH_SEPOLIA_RPC_URL ??
          'https://ethereum-sepolia-rpc.publicnode.com',
      ),
    });
  }
  if (chainId === MANIFEST_CONSTANTS.BASE_SEPOLIA_CHAIN_ID) {
    return createPublicClient({
      chain: baseSepolia,
      transport: http(
        process.env.BASE_SEPOLIA_RPC_URL ?? 'https://sepolia.base.org',
      ),
    });
  }
  throw new ActivityReceiptVerificationError(
    'UNSUPPORTED_RECEIPT_CHAIN',
    `Unsupported receipt destination chain ${chainId}`,
  );
}

export interface ReceiptVerificationClient {
  getTransaction(input: { hash: Hash }): Promise<{
    from: Address;
    to: Address | null;
    input: Hex;
  }>;
  getTransactionReceipt(input: { hash: Hash }): Promise<{
    status: 'success' | 'reverted';
    blockNumber: bigint;
    logs: readonly Array<{
      address: Address;
      topics: readonly Hex[];
      data: Hex;
    }>;
  }>;
}

function asVerificationClient(client: PublicClient): ReceiptVerificationClient {
  return client as unknown as ReceiptVerificationClient;
}

async function requireTransactionAndReceipt(
  client: ReceiptVerificationClient,
  hash: string,
) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) {
    throw new ActivityReceiptVerificationError(
      'INVALID_EXECUTION_HASH',
      'Receipt execution hash is invalid',
    );
  }

  try {
    return await Promise.all([
      client.getTransaction({ hash: hash as Hash }),
      client.getTransactionReceipt({ hash: hash as Hash }),
    ]);
  } catch {
    throw new ActivityReceiptVerificationError(
      'RECEIPT_CHAIN_VERIFICATION_UNAVAILABLE',
      'Authoritative transaction evidence is not available yet',
      503,
    );
  }
}

export async function verifyTransferReceiptSync(
  input: ActivityReceiptSyncInput,
  client: ReceiptVerificationClient = asVerificationClient(arcClient()),
): Promise<ActivityReceiptSyncInput> {
  if (!isTerminalClaim(input)) return input;

  if (
    input.providerId !== 'arc-erc20-transfer' ||
    input.senderChainId !== MANIFEST_CONSTANTS.ARC_TESTNET_CHAIN_ID ||
    input.recipientChainId !== MANIFEST_CONSTANTS.ARC_TESTNET_CHAIN_ID ||
    input.tokenAddress.toLowerCase() !==
      MANIFEST_CONSTANTS.ARC_TESTNET_USDC.toLowerCase() ||
    !input.executionTxHash
  ) {
    throw new ActivityReceiptVerificationError(
      'TRANSFER_RECEIPT_SCOPE_MISMATCH',
      'Transfer receipt is outside the enabled Arc Testnet USDC execution scope',
    );
  }

  const [transaction, receipt] = await requireTransactionAndReceipt(
    client,
    input.executionTxHash,
  );

  const binding = verifyErc20TransferTransactionBinding({
    transaction,
    tokenAddress: input.tokenAddress,
    from: input.senderAddress,
    to: input.recipientAddress,
    amount: BigInt(input.amountRaw),
  });
  if (!binding.verified) {
    throw new ActivityReceiptVerificationError(
      'TRANSFER_RECEIPT_BINDING_MISMATCH',
      binding.detail,
    );
  }

  if (receipt.status === 'reverted') {
    return {
      ...input,
      status: 'FAILED',
      executionBlock: Number(receipt.blockNumber),
      actualAmountRaw: null,
      failureReason: 'Authoritative transaction receipt reverted.',
    };
  }

  const evidence = verifyErc20TransferReceiptEvidence({
    receipt,
    tokenAddress: input.tokenAddress,
    from: input.senderAddress,
    to: input.recipientAddress,
    amount: BigInt(input.amountRaw),
  });
  if (!evidence.verified || evidence.transferAmount === null) {
    throw new ActivityReceiptVerificationError(
      'TRANSFER_RECEIPT_EVIDENCE_MISMATCH',
      evidence.detail,
    );
  }

  return {
    ...input,
    status: 'COMPLETE',
    executionBlock: Number(receipt.blockNumber),
    actualAmountRaw: evidence.transferAmount.toString(),
    failureReason: null,
  };
}

export async function verifyBridgeReceiptSync(
  input: ActivityReceiptSyncInput,
  sourceClient: ReceiptVerificationClient = asVerificationClient(arcClient()),
  destinationOverride?: ReceiptVerificationClient,
): Promise<ActivityReceiptSyncInput> {
  if (!isTerminalClaim(input)) return input;

  if (
    input.providerId !== 'cctp-v2-bridge' ||
    input.senderChainId !== MANIFEST_CONSTANTS.ARC_TESTNET_CHAIN_ID ||
    input.tokenAddress.toLowerCase() !==
      MANIFEST_CONSTANTS.ARC_TESTNET_USDC.toLowerCase() ||
    (input.recipientChainId !== MANIFEST_CONSTANTS.ETH_SEPOLIA_CHAIN_ID &&
      input.recipientChainId !== MANIFEST_CONSTANTS.BASE_SEPOLIA_CHAIN_ID) ||
    !input.burnTxHash ||
    !input.receiveTxHash
  ) {
    throw new ActivityReceiptVerificationError(
      'BRIDGE_RECEIPT_SCOPE_MISMATCH',
      'Bridge receipt is outside the enabled CCTP V2 testnet execution scope',
    );
  }

  const [sourceTransaction, sourceReceipt] =
    await requireTransactionAndReceipt(sourceClient, input.burnTxHash);

  const sourceBinding = verifyCctpSourceTransactionBinding(
    sourceTransaction,
    {
      sender: input.senderAddress as Address,
      recipient: input.recipientAddress as Address,
      tokenAddress: input.tokenAddress as Address,
      amount: BigInt(input.amountRaw),
      destinationChainId: input.recipientChainId,
    },
  );
  if (!sourceBinding.verified) {
    throw new ActivityReceiptVerificationError(
      'BRIDGE_SOURCE_BINDING_MISMATCH',
      sourceBinding.detail,
    );
  }

  if (sourceReceipt.status === 'reverted') {
    return {
      ...input,
      status: 'FAILED',
      executionTxHash: input.burnTxHash,
      executionBlock: Number(sourceReceipt.blockNumber),
      burnBlockNumber: Number(sourceReceipt.blockNumber),
      actualAmountRaw: null,
      failureReason: 'Authoritative CCTP source transaction reverted.',
    };
  }

  const sourceEvidence = verifyCctpSourceReceiptEvidence(sourceReceipt);
  if (!sourceEvidence.verified) {
    throw new ActivityReceiptVerificationError(
      'BRIDGE_SOURCE_EVIDENCE_MISMATCH',
      sourceEvidence.detail,
    );
  }

  const destination = destinationOverride ??
    asVerificationClient(destinationClient(input.recipientChainId));

  let destinationReceipt;
  try {
    destinationReceipt = await destination.getTransactionReceipt({
      hash: input.receiveTxHash as Hash,
    });
  } catch {
    throw new ActivityReceiptVerificationError(
      'RECEIPT_CHAIN_VERIFICATION_UNAVAILABLE',
      'Authoritative destination transaction evidence is not available yet',
      503,
    );
  }

  if (destinationReceipt.status === 'reverted') {
    return {
      ...input,
      status: 'FAILED',
      executionTxHash: input.burnTxHash,
      executionBlock: Number(sourceReceipt.blockNumber),
      burnBlockNumber: Number(sourceReceipt.blockNumber),
      receiveBlockNumber: Number(destinationReceipt.blockNumber),
      actualAmountRaw: null,
      failureReason: 'Authoritative CCTP destination transaction reverted.',
    };
  }

  const destinationToken =
    input.recipientChainId === MANIFEST_CONSTANTS.ETH_SEPOLIA_CHAIN_ID
      ? MANIFEST_CONSTANTS.ETH_SEPOLIA_USDC
      : MANIFEST_CONSTANTS.BASE_SEPOLIA_USDC;
  const destinationEvidence = verifyCctpDestinationReceiptEvidence(
    destinationReceipt,
    input.recipientAddress as Address,
    destinationToken,
    BigInt(input.amountRaw),
  );
  if (!destinationEvidence.verified) {
    throw new ActivityReceiptVerificationError(
      'BRIDGE_DESTINATION_EVIDENCE_MISMATCH',
      destinationEvidence.detail,
    );
  }

  return {
    ...input,
    status: 'COMPLETE',
    executionTxHash: input.burnTxHash,
    executionBlock: Number(sourceReceipt.blockNumber),
    burnBlockNumber: Number(sourceReceipt.blockNumber),
    receiveBlockNumber: Number(destinationReceipt.blockNumber),
    actualAmountRaw: input.amountRaw,
    failureReason: null,
  };
}

export async function verifyTerminalActivityReceiptSync(
  input: ActivityReceiptSyncInput,
): Promise<ActivityReceiptSyncInput> {
  if (!isTerminalClaim(input)) return input;

  if (input.actionType === 'TRANSFER') {
    return verifyTransferReceiptSync(input);
  }
  if (input.actionType === 'BRIDGE') {
    return verifyBridgeReceiptSync(input);
  }

  throw new ActivityReceiptVerificationError(
    'TERMINAL_RECEIPT_VERIFICATION_UNSUPPORTED',
    `Authoritative terminal verification is not implemented for ${input.actionType}`,
  );
}
