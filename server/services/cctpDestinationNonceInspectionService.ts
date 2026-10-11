/**
 * Canonical CCTP V2 destination usedNonces(bytes32) inspection.
 *
 * This is strictly an OBSERVATION, not permission to claim/broadcast another
 * receive. Another broadcaster can consume the nonce immediately afterwards.
 * The first reverted destination receive and original Arc/Circle source proof
 * must be rechecked independently by the authenticated BFF caller.
 *
 * MessageV2 layout (Circle official):
 *   version[0..4], sourceDomain[4..8], destinationDomain[8..12],
 *   nonce[12..44], sender[44..76], recipient[76..108],
 *   destinationCaller[108..140], thresholds[140..148], body[148..].
 *
 * MessageTransmitterV2 `usedNonces(bytes32)` returns 0 when unused and 1
 * once successfully received. The nonce must never be inferred from a
 * locally generated integer or the destination transaction hash.
 */
import { createPublicClient, http, parseAbi, type Hash, type Hex } from 'viem';
import { baseSepolia, sepolia } from 'viem/chains';
import { MANIFEST_CONSTANTS } from '../../src/providers/registry/providerManifest.js';
import type { BridgeRecoveryInput } from '../db/repositories/bridgeRecoveryRepository.js';
import { BridgeRecoveryConflictError } from '../db/repositories/bridgeRecoveryRepository.js';

import { assertCctpDestinationRpcIdentity } from './cctpDestinationRpcIdentity.js';

const TRANSMITTER_ABI = parseAbi([
  'function usedNonces(bytes32 nonce) view returns (uint256)',
]);
const HEX_RE = /^0x(?:[0-9a-fA-F]{2})+$/;
const HASH_RE = /^0x[0-9a-fA-F]{64}$/;
const ZERO_BYTES32 = `0x${'0'.repeat(64)}`;
const MIN_CCTP_V2_HEADER_BYTES = 148;

export interface CctpMessageV2NonceIdentity {
  nonce: Hex;
  version: number;
  sourceDomain: number;
  destinationDomain: number;
}

export interface CctpDestinationNonceObservation {
  nonce: Hex;
  destinationChainId: number;
  destinationDomain: number;
  observedBlockNumber: number;
  observedBlockHash: Hash;
  usage: 'UNUSED_AT_OBSERVED_BLOCK' | 'ALREADY_CONSUMED';
  retryAuthorized: false;
}

/**
 * Does not accept a browser-supplied nonce. Requires exact Circle attested
 * V2 message and the reviewed Arc → Sepolia/Base Sepolia domains.
 */
export function parseReviewedCctpV2Nonce(
  checkpoint: BridgeRecoveryInput,
): CctpMessageV2NonceIdentity {
  const destinationDomain = checkpoint.destinationChainId ===
    MANIFEST_CONSTANTS.ETH_SEPOLIA_CHAIN_ID
    ? MANIFEST_CONSTANTS.ETH_SEPOLIA_CCTP_DOMAIN
    : checkpoint.destinationChainId === MANIFEST_CONSTANTS.BASE_SEPOLIA_CHAIN_ID
      ? MANIFEST_CONSTANTS.BASE_SEPOLIA_CCTP_DOMAIN
      : null;

  const message = checkpoint.attestationMessage;
  if (
    checkpoint.stage !== 'DESTINATION_BROADCAST' ||
    checkpoint.sourceChainId !== MANIFEST_CONSTANTS.ARC_TESTNET_CHAIN_ID ||
    destinationDomain === null ||
    !checkpoint.receiveTxHash ||
    !HASH_RE.test(checkpoint.receiveTxHash) ||
    !message ||
    !HEX_RE.test(message) ||
    (message.length - 2) / 2 < MIN_CCTP_V2_HEADER_BYTES
  ) {
    throw new BridgeRecoveryConflictError(
      'CCTP nonce inspection requires a recorded destination attempt and a complete attested V2 message.',
    );
  }

  const readU32 = (offsetBytes: number): number =>
    Number.parseInt(message.slice(2 + offsetBytes * 2, 2 + (offsetBytes + 4) * 2), 16);
  const version = readU32(0);
  const sourceDomain = readU32(4);
  const parsedDestinationDomain = readU32(8);
  const nonce = `0x${message.slice(2 + 12 * 2, 2 + 44 * 2)}` as Hex;
  const destinationCaller = `0x${message.slice(2 + 108 * 2, 2 + 140 * 2)}`;

  if (
    version !== 1 ||
    sourceDomain !== MANIFEST_CONSTANTS.ARC_TESTNET_CCTP_DOMAIN ||
    parsedDestinationDomain !== destinationDomain ||
    nonce.toLowerCase() === ZERO_BYTES32 ||
    destinationCaller.toLowerCase() !== ZERO_BYTES32
  ) {
    throw new BridgeRecoveryConflictError(
      'CCTP V2 nonce header conflicts with reviewed Arc destination domains, version or any-caller relay requirement.',
    );
  }

  return {
    nonce: nonce.toLowerCase() as Hex,
    version,
    sourceDomain,
    destinationDomain,
  };
}

/**
 * Pure inspection. Both block-hash reads bracket usedNonces() at the SAME
 * blockNumber. This prevents mixing a stale nonce read with a newer block or
 * an observed reorg, but does not give a transaction-time atomic guarantee.
 */
export async function inspectCctpDestinationNonce(
  checkpoint: BridgeRecoveryInput,
  getBlockNumber: () => Promise<bigint>,
  getBlockHash: (blockNumber: bigint) => Promise<Hash | null>,
  readUsedNonceAtBlock: (nonce: Hex, blockNumber: bigint) => Promise<bigint>,
): Promise<CctpDestinationNonceObservation> {
  const identity = parseReviewedCctpV2Nonce(checkpoint);
  let blockNumber: bigint;
  let firstBlockHash: Hash | null;
  let secondBlockHash: Hash | null;
  let usageValue: bigint;
  let head: bigint;

  try {
    blockNumber = await getBlockNumber();
    firstBlockHash = await getBlockHash(blockNumber);
    usageValue = await readUsedNonceAtBlock(identity.nonce, blockNumber);
    [secondBlockHash, head] = await Promise.all([
      getBlockHash(blockNumber),
      getBlockNumber(),
    ]);
  } catch {
    throw new BridgeRecoveryConflictError(
      'CCTP destination nonce state unavailable; never infer unused from RPC failure.',
    );
  }

  if (
    blockNumber < 0n ||
    !Number.isSafeInteger(Number(blockNumber)) ||
    !firstBlockHash ||
    !HASH_RE.test(firstBlockHash) ||
    !secondBlockHash ||
    firstBlockHash.toLowerCase() !== secondBlockHash.toLowerCase() ||
    head < blockNumber ||
    (usageValue !== 0n && usageValue !== 1n)
  ) {
    throw new BridgeRecoveryConflictError(
      'CCTP destination nonce inspection is inconsistent, non-canonical or invalid.',
    );
  }

  return {
    nonce: identity.nonce,
    destinationChainId: checkpoint.destinationChainId,
    destinationDomain: identity.destinationDomain,
    observedBlockNumber: Number(blockNumber),
    observedBlockHash: firstBlockHash.toLowerCase() as Hash,
    usage: usageValue === 0n ? 'UNUSED_AT_OBSERVED_BLOCK' : 'ALREADY_CONSUMED',
    retryAuthorized: false,
  };
}

/** Read-only viem RPC boundary. Never imports wallet/signer modules. */
export async function inspectCctpDestinationNonceFromNetwork(
  checkpoint: BridgeRecoveryInput,
): Promise<CctpDestinationNonceObservation> {
  // Validate supported chain BEFORE choosing a configured RPC URL.
  parseReviewedCctpV2Nonce(checkpoint);
  const isSepolia = checkpoint.destinationChainId === MANIFEST_CONSTANTS.ETH_SEPOLIA_CHAIN_ID;
  const client = createPublicClient({
    chain: isSepolia ? sepolia : baseSepolia,
    transport: http(isSepolia
      ? (process.env.ETH_SEPOLIA_RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com')
      : (process.env.BASE_SEPOLIA_RPC_URL ?? 'https://sepolia.base.org')),
  });
  const transmitter = MANIFEST_CONSTANTS.CCTP_V2_MESSAGE_TRANSMITTER as `0x${string}`;

  // A correctly configured chain object does not guarantee that a custom
  // RPC URL serves that chain. Wrong-network nonce reads must fail closed.
  let actualChainId: number;
  try {
    actualChainId = await client.getChainId();
  } catch {
    throw new BridgeRecoveryConflictError(
      'Destination nonce RPC chain identity unavailable; do not authorize retry.',
    );
  }
  assertCctpDestinationRpcIdentity(checkpoint.destinationChainId, actualChainId);

  return inspectCctpDestinationNonce(
    checkpoint,
    () => client.getBlockNumber(),
    async (blockNumber) => (await client.getBlock({ blockNumber })).hash,
    (nonce, blockNumber) =>
      client.readContract({
        address: transmitter,
        abi: TRANSMITTER_ABI,
        functionName: 'usedNonces',
        args: [nonce],
        blockNumber,
      }),
  );
}
