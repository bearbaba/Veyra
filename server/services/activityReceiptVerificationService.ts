import {
  createPublicClient,
  getAddress,
  http,
  type Hash,
  type TransactionReceipt,
} from 'viem';
import { baseSepolia, sepolia } from 'viem/chains';
import type { DbClient } from '../db/client.js';
import {
  getReceiptForUser,
  type ReceiptStatus,
  type ReceiptSyncInput,
} from '../db/repositories/receiptRepository.js';
import { MANIFEST_CONSTANTS } from '../../src/providers/registry/providerManifest.js';
import {
  verifyCctpDestinationReceiptEvidence,
  verifyCctpSourceReceiptEvidence,
} from '../../src/providers/cctp/cctpV2Adapter.js';

export class ActivityReceiptEvidenceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly httpStatus = 409,
  ) {
    super(message);
    this.name = 'ActivityReceiptEvidenceError';
  }
}

export interface ActivityReceiptEvidenceContext {
  providerId: string;
  action: string;
  senderAddress: string;
  senderChainId: number;
  recipientAddress: string;
  recipientChainId: number;
  amountRaw: string;
  tokenAddress: string;
  burnTxHash: string | null;
  burnChainId: number | null;
  burnBlockNumber: number | null;
  receiveTxHash: string | null;
  receiveChainId: number | null;
  receiveBlockNumber: number | null;
}

export type ActivityReceiptChainReceiptFetcher = (
  chainId: number,
  txHash: Hash,
) => Promise<TransactionReceipt>;

function destinationUsdc(chainId: number): string | null {
  if (chainId === MANIFEST_CONSTANTS.ETH_SEPOLIA_CHAIN_ID) {
    return MANIFEST_CONSTANTS.ETH_SEPOLIA_USDC;
  }
  if (chainId === MANIFEST_CONSTANTS.BASE_SEPOLIA_CHAIN_ID) {
    return MANIFEST_CONSTANTS.BASE_SEPOLIA_USDC;
  }
  return null;
}

function currentOrIncoming<T>(
  incoming: T | null | undefined,
  current: T | null,
): T | null {
  return incoming ?? current;
}

function requireHash(
  value: string | null,
  field: string,
): Hash {
  if (!value || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new ActivityReceiptEvidenceError(
      'MISSING_CHAIN_EVIDENCE',
      `${field} is required before authoritative receipt verification.`,
    );
  }
  return value as Hash;
}

function requireBlockNumber(
  value: number | null,
  field: string,
): number {
  if (!Number.isSafeInteger(value) || (value ?? -1) < 0) {
    throw new ActivityReceiptEvidenceError(
      'MISSING_CHAIN_EVIDENCE',
      `${field} is required before authoritative receipt verification.`,
    );
  }
  return value as number;
}

function requireAmount(value: string): bigint {
  if (!/^[1-9][0-9]*$/.test(value)) {
    throw new ActivityReceiptEvidenceError(
      'INVALID_RECEIPT_AMOUNT',
      'ActivityReceipt amountRaw is invalid.',
    );
  }
  return BigInt(value);
}

function isCctpBridge(context: ActivityReceiptEvidenceContext): boolean {
  return (
    context.providerId === 'cctp-v2-bridge' &&
    context.action === 'BRIDGE'
  );
}

/**
 * Independently verifies the chain evidence needed for authoritative CCTP
 * ActivityReceipt lifecycle transitions.
 *
 * Browser state may suggest hashes/blocks, but SOURCE_CONFIRMED and CONFIRMED
 * are accepted only after the BFF reads the corresponding chain receipt and
 * validates exact reviewed CCTP evidence.
 */
export async function verifyActivityReceiptTransitionEvidence(
  current: ActivityReceiptEvidenceContext,
  input: Pick<
    ReceiptSyncInput,
    | 'status'
    | 'burnTxHash'
    | 'burnChainId'
    | 'burnBlockNumber'
    | 'receiveTxHash'
    | 'receiveChainId'
    | 'receiveBlockNumber'
  >,
  fetchReceipt: ActivityReceiptChainReceiptFetcher,
): Promise<void> {
  if (!isCctpBridge(current)) return;

  if (
    input.status !== 'SOURCE_CONFIRMED' &&
    input.status !== 'CONFIRMED'
  ) {
    return;
  }

  const amount = requireAmount(current.amountRaw);

  if (input.status === 'SOURCE_CONFIRMED') {
    const burnTxHash = requireHash(
      currentOrIncoming(input.burnTxHash, current.burnTxHash),
      'burnTxHash',
    );
    const burnChainId = currentOrIncoming(
      input.burnChainId,
      current.burnChainId,
    );
    const claimedBlock = requireBlockNumber(
      currentOrIncoming(input.burnBlockNumber, current.burnBlockNumber),
      'burnBlockNumber',
    );

    if (burnChainId !== current.senderChainId) {
      throw new ActivityReceiptEvidenceError(
        'SOURCE_CHAIN_MISMATCH',
        'Source confirmation chain does not match the reviewed ActivityReceipt.',
      );
    }

    const receipt = await fetchReceipt(current.senderChainId, burnTxHash);
    if (Number(receipt.blockNumber) !== claimedBlock) {
      throw new ActivityReceiptEvidenceError(
        'SOURCE_BLOCK_MISMATCH',
        'Source receipt block does not match the claimed burnBlockNumber.',
      );
    }

    const verification = verifyCctpSourceReceiptEvidence(receipt, {
      burnToken: getAddress(current.tokenAddress),
      amount,
      depositor: getAddress(current.senderAddress),
      mintRecipient: getAddress(current.recipientAddress),
      destinationChainId: current.recipientChainId,
    });
    if (!verification.verified) {
      throw new ActivityReceiptEvidenceError(
        'SOURCE_RECEIPT_UNVERIFIED',
        verification.detail,
      );
    }

    return;
  }

  const receiveTxHash = requireHash(
    currentOrIncoming(input.receiveTxHash, current.receiveTxHash),
    'receiveTxHash',
  );
  const receiveChainId = currentOrIncoming(
    input.receiveChainId,
    current.receiveChainId,
  );
  const claimedBlock = requireBlockNumber(
    currentOrIncoming(
      input.receiveBlockNumber,
      current.receiveBlockNumber,
    ),
    'receiveBlockNumber',
  );

  if (receiveChainId !== current.recipientChainId) {
    throw new ActivityReceiptEvidenceError(
      'DESTINATION_CHAIN_MISMATCH',
      'Destination confirmation chain does not match the reviewed ActivityReceipt.',
    );
  }

  const tokenAddress = destinationUsdc(current.recipientChainId);
  if (!tokenAddress) {
    throw new ActivityReceiptEvidenceError(
      'DESTINATION_ASSET_UNKNOWN',
      'No canonical destination USDC deployment is registered for this receipt.',
    );
  }

  const receipt = await fetchReceipt(current.recipientChainId, receiveTxHash);
  if (Number(receipt.blockNumber) !== claimedBlock) {
    throw new ActivityReceiptEvidenceError(
      'DESTINATION_BLOCK_MISMATCH',
      'Destination receipt block does not match the claimed receiveBlockNumber.',
    );
  }

  const verification = verifyCctpDestinationReceiptEvidence(
    receipt,
    getAddress(current.recipientAddress),
    getAddress(tokenAddress),
    amount,
  );
  if (!verification.verified) {
    throw new ActivityReceiptEvidenceError(
      'DESTINATION_RECEIPT_UNVERIFIED',
      verification.detail,
    );
  }
}

function arcTestnetClient() {
  const rpcUrl =
    process.env.ARC_TESTNET_RPC_URL ?? 'https://rpc.testnet.arc.io';
  return createPublicClient({
    chain: {
      id: MANIFEST_CONSTANTS.ARC_TESTNET_CHAIN_ID,
      name: 'Arc Testnet',
      nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
      rpcUrls: { default: { http: [rpcUrl] } },
    },
    transport: http(rpcUrl),
  });
}

function defaultReceiptFetcher(): ActivityReceiptChainReceiptFetcher {
  const source = arcTestnetClient();
  const eth = createPublicClient({
    chain: sepolia,
    transport: http(
      process.env.ETH_SEPOLIA_RPC_URL ??
        'https://ethereum-sepolia-rpc.publicnode.com',
    ),
  });
  const base = createPublicClient({
    chain: baseSepolia,
    transport: http(
      process.env.BASE_SEPOLIA_RPC_URL ?? 'https://sepolia.base.org',
    ),
  });

  return async (chainId, txHash) => {
    if (chainId === MANIFEST_CONSTANTS.ARC_TESTNET_CHAIN_ID) {
      return source.getTransactionReceipt({ hash: txHash });
    }
    if (chainId === MANIFEST_CONSTANTS.ETH_SEPOLIA_CHAIN_ID) {
      return eth.getTransactionReceipt({ hash: txHash });
    }
    if (chainId === MANIFEST_CONSTANTS.BASE_SEPOLIA_CHAIN_ID) {
      return base.getTransactionReceipt({ hash: txHash });
    }
    throw new ActivityReceiptEvidenceError(
      'UNSUPPORTED_EVIDENCE_CHAIN',
      `No receipt verifier is configured for chain ${chainId}.`,
    );
  };
}

export async function verifyOwnedActivityReceiptTransitionEvidence(
  db: DbClient,
  userId: string,
  input: ReceiptSyncInput,
  fetchReceipt: ActivityReceiptChainReceiptFetcher = defaultReceiptFetcher(),
): Promise<void> {
  const current = await getReceiptForUser(db, userId, input.receiptId);
  if (!current) {
    throw new ActivityReceiptEvidenceError(
      'RECEIPT_NOT_FOUND',
      'ActivityReceipt was not found for the authenticated user.',
      404,
    );
  }

  try {
    await verifyActivityReceiptTransitionEvidence(
      current,
      input,
      fetchReceipt,
    );
  } catch (error) {
    if (error instanceof ActivityReceiptEvidenceError) throw error;

    throw new ActivityReceiptEvidenceError(
      'CHAIN_EVIDENCE_UNAVAILABLE',
      error instanceof Error
        ? error.message
        : 'Authoritative chain evidence could not be loaded.',
      503,
    );
  }
}
