/**
 * Server-authoritative proof of successful SECOND CCTP destination receive.
 *
 * No signing is performed. The original receive hash is immutable; this
 * verifier is only allowed to inspect attempt #2's recorded transaction and
 * its destination-chain mint/finality evidence. BFF also revalidates the
 * original Arc source burn and Circle attestation independently.
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
import {
  verifyCctpDestinationReceiptEvidence,
} from '../../src/providers/cctp/cctpV2Adapter.js';
import type { BridgeRecoveryInput } from '../db/repositories/bridgeRecoveryRepository.js';
import { BridgeRecoveryConflictError } from '../db/repositories/bridgeRecoveryRepository.js';

const RECEIVE_ABI = parseAbi([
  'function receiveMessage(bytes message, bytes attestation) returns (bool success)',
]);
const HASH_RE = /^0x[0-9a-fA-F]{64}$/;
const ERC20_TRANSFER_TOPIC =
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const ZERO_TOPIC = `0x${'0'.repeat(64)}`;
const MIN_CONFIRMATIONS = 12;

export interface SecondDestinationMintProof {
  receiveTxHash: string;
  destinationChainId: number;
  destinationBlockNumber: number;
  destinationBlockHash: string;
  mintToken: string;
  mintRecipient: string;
  mintAmountRaw: string;
  confirmations: number;
}

export interface SecondReceiveTransaction {
  to: string | null;
  input: `0x${string}`;
}

/**
 * Pure proof gate: canonical successful receipt + exact MessageTransmitter
 * calldata + exactly one canonical mint to the reviewed recipient + finality.
 */
export async function verifySecondCctpDestinationMint(
  checkpoint: BridgeRecoveryInput,
  secondTxHash: string,
  getReceipt: (txHash: Hash) => Promise<TransactionReceipt>,
  getTransaction: (txHash: Hash) => Promise<SecondReceiveTransaction>,
  getCanonicalBlockHash: (blockNumber: bigint) => Promise<Hash | null>,
  getHeadBlockNumber: () => Promise<bigint>,
): Promise<SecondDestinationMintProof> {
  if (
    checkpoint.stage !== 'DESTINATION_BROADCAST' ||
    (checkpoint.destinationChainId !== MANIFEST_CONSTANTS.ETH_SEPOLIA_CHAIN_ID &&
      checkpoint.destinationChainId !== MANIFEST_CONSTANTS.BASE_SEPOLIA_CHAIN_ID) ||
    !HASH_RE.test(secondTxHash) ||
    !HASH_RE.test(checkpoint.receiveTxHash ?? '') ||
    secondTxHash.toLowerCase() === checkpoint.receiveTxHash?.toLowerCase() ||
    !checkpoint.attestationMessage ||
    !checkpoint.attestationSignature ||
    !/^[1-9][0-9]*$/.test(checkpoint.amount)
  ) {
    throw new BridgeRecoveryConflictError(
      'Second destination mint proof requires a distinct recorded retry hash and original attestation.',
    );
  }

  let receipt: TransactionReceipt;
  let transaction: SecondReceiveTransaction;
  try {
    [receipt, transaction] = await Promise.all([
      getReceipt(secondTxHash as Hash),
      getTransaction(secondTxHash as Hash),
    ]);
  } catch {
    throw new BridgeRecoveryConflictError(
      'Second destination transaction cannot be fetched. Preserve original attempts.',
    );
  }

  if (
    receipt.status !== 'success' ||
    receipt.transactionHash.toLowerCase() !== secondTxHash.toLowerCase() ||
    !HASH_RE.test(receipt.blockHash) ||
    receipt.blockNumber < 0n ||
    !Number.isSafeInteger(Number(receipt.blockNumber))
  ) {
    throw new BridgeRecoveryConflictError(
      'Second receive is not proven successful at the immutable retry hash.',
    );
  }

  if (
    !transaction.to ||
    transaction.to.toLowerCase() !==
      MANIFEST_CONSTANTS.CCTP_V2_MESSAGE_TRANSMITTER.toLowerCase()
  ) {
    throw new BridgeRecoveryConflictError(
      'Second receive did not target canonical CCTP MessageTransmitterV2.',
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
      'Second destination transaction is not valid CCTP receiveMessage calldata.',
    );
  }

  if (
    decoded.functionName !== 'receiveMessage' ||
    decoded.args[0].toLowerCase() !== checkpoint.attestationMessage.toLowerCase() ||
    decoded.args[1].toLowerCase() !== checkpoint.attestationSignature.toLowerCase()
  ) {
    throw new BridgeRecoveryConflictError(
      'Second receive does not contain the exact original message and Circle attestation.',
    );
  }

  const token = checkpoint.destinationChainId ===
    MANIFEST_CONSTANTS.ETH_SEPOLIA_CHAIN_ID
    ? MANIFEST_CONSTANTS.ETH_SEPOLIA_USDC
    : MANIFEST_CONSTANTS.BASE_SEPOLIA_USDC;
  const expectedAmount = BigInt(checkpoint.amount);
  const mintEvidence = verifyCctpDestinationReceiptEvidence(
    receipt,
    checkpoint.recipientAddress as `0x${string}`,
    token,
    expectedAmount,
  );
  if (!mintEvidence.verified) {
    throw new BridgeRecoveryConflictError(
      'Second receive has no canonical USDC mint of the exact reviewed amount and recipient.',
    );
  }

  // Require a unique mint to the reviewed recipient; a matching mint in a
  // receipt with additional unexplained mints is not sufficient proof.
  const expectedRecipientTopic =
    `0x${'0'.repeat(24)}${checkpoint.recipientAddress.slice(2)}`.toLowerCase();
  const matchingMints = receipt.logs.filter((log) =>
    log.address.toLowerCase() === token.toLowerCase() &&
    log.topics[0]?.toLowerCase() === ERC20_TRANSFER_TOPIC &&
    log.topics[1]?.toLowerCase() === ZERO_TOPIC &&
    log.topics[2]?.toLowerCase() === expectedRecipientTopic
  );
  if (matchingMints.length !== 1) {
    throw new BridgeRecoveryConflictError(
      'Second receive must emit exactly one reviewed USDC mint to its recipient.',
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
      'Second destination canonical block or finality cannot be verified.',
    );
  }

  if (
    !canonicalHash ||
    canonicalHash.toLowerCase() !== receipt.blockHash.toLowerCase() ||
    head < receipt.blockNumber ||
    head - receipt.blockNumber + 1n < BigInt(MIN_CONFIRMATIONS) ||
    !Number.isSafeInteger(Number(head - receipt.blockNumber + 1n))
  ) {
    throw new BridgeRecoveryConflictError(
      'Second receive mint is not in a canonical block with 12 confirmations.',
    );
  }

  return {
    receiveTxHash: secondTxHash.toLowerCase(),
    destinationChainId: checkpoint.destinationChainId,
    destinationBlockNumber: Number(receipt.blockNumber),
    destinationBlockHash: receipt.blockHash.toLowerCase(),
    mintToken: token.toLowerCase(),
    mintRecipient: checkpoint.recipientAddress.toLowerCase(),
    mintAmountRaw: checkpoint.amount,
    confirmations: Number(head - receipt.blockNumber + 1n),
  };
}

/** Independent RPC read boundary, no destination wallet/signer. */
export async function verifySecondCctpDestinationMintFromNetwork(
  checkpoint: BridgeRecoveryInput,
  secondTxHash: string,
): Promise<SecondDestinationMintProof> {
  if (
    checkpoint.destinationChainId !== MANIFEST_CONSTANTS.ETH_SEPOLIA_CHAIN_ID &&
    checkpoint.destinationChainId !== MANIFEST_CONSTANTS.BASE_SEPOLIA_CHAIN_ID
  ) {
    throw new BridgeRecoveryConflictError('Unsupported second receive destination chain.');
  }
  const network = checkpoint.destinationChainId ===
    MANIFEST_CONSTANTS.ETH_SEPOLIA_CHAIN_ID ? sepolia : baseSepolia;
  const rpcUrl = checkpoint.destinationChainId ===
    MANIFEST_CONSTANTS.ETH_SEPOLIA_CHAIN_ID
    ? (process.env.ETH_SEPOLIA_RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com')
    : (process.env.BASE_SEPOLIA_RPC_URL ?? 'https://sepolia.base.org');
  const client = createPublicClient({
    chain: network,
    transport: http(rpcUrl),
  });

  return verifySecondCctpDestinationMint(
    checkpoint,
    secondTxHash,
    (hash) => client.getTransactionReceipt({ hash }),
    async (hash) => {
      const tx = await client.getTransaction({ hash });
      return { to: tx.to, input: tx.input };
    },
    async (blockNumber) => (await client.getBlock({ blockNumber })).hash,
    () => client.getBlockNumber(),
  );
}
