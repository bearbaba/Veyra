/**
 * Independent read-only proof that the FIRST destination receiveMessage
 * transaction reverted in a canonical, sufficiently confirmed block.
 * This proof does NOT authorize a second receive submission.
 */
import {
  createPublicClient,
  decodeFunctionData,
  http,
  parseAbi,
  type Hash,
  type TransactionReceipt,
} from 'viem';
import { baseSepolia, sepolia } from 'viem/chains';
import { MANIFEST_CONSTANTS } from '../../src/providers/registry/providerManifest.js';
import type { BridgeRecoveryInput } from '../db/repositories/bridgeRecoveryRepository.js';
import { BridgeRecoveryConflictError } from '../db/repositories/bridgeRecoveryRepository.js';

import { assertCctpDestinationRpcIdentity } from './cctpDestinationRpcIdentity.js';

const RECEIVE_ABI = parseAbi([
  'function receiveMessage(bytes message, bytes attestation) returns (bool success)',
]);
const HASH_RE = /^0x[0-9a-fA-F]{64}$/;
const MIN_CONFIRMATIONS = 12;

export interface VerifiedDestinationRevert {
  receiveTxHash: string;
  destinationChainId: number;
  destinationBlockNumber: number;
  destinationBlockHash: string;
  confirmations: number;
}

export interface DestinationReceiveTransaction {
  to: string | null;
  input: `0x${string}`;
}

/**
 * Pure evidence verifier. Injected chain fetches make it possible to test
 * source/destination substitution, RPC failures and reorg-like block changes.
 */
export async function verifyRevertedCctpDestinationReceive(
  checkpoint: BridgeRecoveryInput,
  receiveTxHash: string,
  getReceipt: (txHash: Hash) => Promise<TransactionReceipt>,
  getTransaction: (txHash: Hash) => Promise<DestinationReceiveTransaction>,
  getCanonicalBlockHash: (blockNumber: bigint) => Promise<Hash | null>,
  getHeadBlockNumber: () => Promise<bigint>,
): Promise<VerifiedDestinationRevert> {
  if (
    checkpoint.stage !== 'DESTINATION_BROADCAST' ||
    (checkpoint.destinationChainId !== MANIFEST_CONSTANTS.ETH_SEPOLIA_CHAIN_ID &&
      checkpoint.destinationChainId !== MANIFEST_CONSTANTS.BASE_SEPOLIA_CHAIN_ID) ||
    !HASH_RE.test(receiveTxHash) ||
    checkpoint.receiveTxHash?.toLowerCase() !== receiveTxHash.toLowerCase() ||
    !checkpoint.attestationMessage ||
    !checkpoint.attestationSignature
  ) {
    throw new BridgeRecoveryConflictError(
      'Only the first recorded destination receive for an owned CCTP checkpoint may be resolved as reverted.',
    );
  }

  let receipt: TransactionReceipt;
  let transaction: DestinationReceiveTransaction;
  try {
    [receipt, transaction] = await Promise.all([
      getReceipt(receiveTxHash as Hash),
      getTransaction(receiveTxHash as Hash),
    ]);
  } catch {
    throw new BridgeRecoveryConflictError(
      'Destination receipt or calldata cannot be checked. Keep original receive locked.',
    );
  }

  if (
    receipt.status !== 'reverted' ||
    receipt.transactionHash.toLowerCase() !== receiveTxHash.toLowerCase() ||
    !HASH_RE.test(receipt.blockHash) ||
    receipt.blockNumber < 0n ||
    !Number.isSafeInteger(Number(receipt.blockNumber))
  ) {
    throw new BridgeRecoveryConflictError(
      'Destination transaction is not proven reverted at the original recorded hash.',
    );
  }

  if (
    !transaction.to ||
    transaction.to.toLowerCase() !==
      MANIFEST_CONSTANTS.CCTP_V2_MESSAGE_TRANSMITTER.toLowerCase()
  ) {
    throw new BridgeRecoveryConflictError(
      'Reverted destination transaction did not target canonical CCTP MessageTransmitterV2.',
    );
  }

  let decoded;
  try {
    decoded = decodeFunctionData({
      abi: RECEIVE_ABI,
      data: transaction.input,
    });
  } catch {
    throw new BridgeRecoveryConflictError(
      'Reverted destination transaction did not call valid CCTP receiveMessage.',
    );
  }

  if (
    decoded.functionName !== 'receiveMessage' ||
    decoded.args[0].toLowerCase() !== checkpoint.attestationMessage.toLowerCase() ||
    decoded.args[1].toLowerCase() !== checkpoint.attestationSignature.toLowerCase()
  ) {
    throw new BridgeRecoveryConflictError(
      'Destination revert calldata does not match the reviewed persisted CCTP attestation.',
    );
  }

  let canonicalHash: Hash | null;
  let head: bigint;
  try {
    [canonicalHash, head] = await Promise.all([
      getCanonicalBlockHash(receipt.blockNumber),
      getHeadBlockNumber(),
    ]);
  } catch {
    throw new BridgeRecoveryConflictError(
      'Destination canonical block or finality is not available for verification.',
    );
  }

  if (
    !canonicalHash ||
    canonicalHash.toLowerCase() !== receipt.blockHash.toLowerCase() ||
    head < receipt.blockNumber ||
    head - receipt.blockNumber + 1n < BigInt(MIN_CONFIRMATIONS)
  ) {
    throw new BridgeRecoveryConflictError(
      'Destination revert is not in a canonical block with 12 confirmations.',
    );
  }

  return {
    receiveTxHash: receiveTxHash.toLowerCase(),
    destinationChainId: checkpoint.destinationChainId,
    destinationBlockNumber: Number(receipt.blockNumber),
    destinationBlockHash: receipt.blockHash.toLowerCase(),
    confirmations: Number(head - receipt.blockNumber + 1n),
  };
}

/** Network boundary: never treats RPC timeout or missing receipt as failure. */
export async function verifyRevertedCctpDestinationReceiveFromNetwork(
  checkpoint: BridgeRecoveryInput,
  receiveTxHash: string,
): Promise<VerifiedDestinationRevert> {
  const destination = checkpoint.destinationChainId ===
    MANIFEST_CONSTANTS.ETH_SEPOLIA_CHAIN_ID
    ? sepolia : baseSepolia;
  const rpcUrl = checkpoint.destinationChainId ===
    MANIFEST_CONSTANTS.ETH_SEPOLIA_CHAIN_ID
    ? (process.env.ETH_SEPOLIA_RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com')
    : (process.env.BASE_SEPOLIA_RPC_URL ?? 'https://sepolia.base.org');
  const client = createPublicClient({
    chain: destination,
    transport: http(rpcUrl),
  });

  // A configured viem Chain object does not authenticate a user-provided
  // RPC URL. Prove the actual network identity before accepting any receipt.
  let actualChainId: number;
  try {
    actualChainId = await client.getChainId();
  } catch {
    throw new BridgeRecoveryConflictError(
      'Destination revert RPC network identity unavailable; original attempt stays locked.',
    );
  }
  assertCctpDestinationRpcIdentity(checkpoint.destinationChainId, actualChainId);

  return verifyRevertedCctpDestinationReceive(
    checkpoint,
    receiveTxHash,
    (hash) => client.getTransactionReceipt({ hash }),
    async (hash) => {
      const tx = await client.getTransaction({ hash });
      return { to: tx.to, input: tx.input };
    },
    async (blockNumber) => (await client.getBlock({ blockNumber })).hash,
    () => client.getBlockNumber(),
  );
}
