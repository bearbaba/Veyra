/**
 * Veyra CCTP V2 Bridge Adapter
 *
 * Supports: Arc Testnet → Ethereum Sepolia / Base Sepolia
 *
 * VERIFIED 2026-10-07
 * Source: https://developers.circle.com/cctp/evm-smart-contracts.md
 *
 * CCTP V2 changes vs V1:
 * - depositForBurn() now takes: destinationCaller, maxFee, minFinalityThreshold
 * - No longer need to extract message from tx receipt — use /v2/messages/{domain}?transactionHash=
 * - V1 contracts are being deprecated (July 2026 — 10 month wind-down)
 *
 * Bridge lifecycle (async cross-chain):
 *   1. Source chain: approve TokenMessengerV2 to burn USDC
 *   2. Source chain: depositForBurn() on TokenMessengerV2
 *   3. Verify source tx receipt and log MessageSent event
 *   4. Poll Circle attestation API until status === 'complete'
 *   5. Destination chain: receiveMessage() on MessageTransmitterV2 with attestation
 *   6. Verify destination receipt and token balance delta
 *   7. Only after step 6: status = VERIFIED
 *
 * BRIDGE_PENDING  = source tx submitted
 * BRIDGE_UNCONFIRMED = source confirmed, waiting for attestation
 * VERIFIED        = destination confirmed + balance verified
 *
 * Contract addresses (all testnet chains, uniform — verified 2026-10-07):
 *   TokenMessengerV2:   0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA
 *   MessageTransmitterV2: 0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275
 *   TokenMinterV2:      0xb43db544E2c27092c107639Ad201b3dEfAbcF192
 */

import {
  type Address,
  type PublicClient,
  type WalletClient,
  type Hash,
  type TransactionReceipt,
  decodeEventLog,
  getAddress,
} from 'viem';
import { MANIFEST_CONSTANTS } from '../registry/providerManifest';
import type { BridgeAction } from '../../core/actions/actionSchema';

// ── ABIs ─────────────────────────────────────────────────────────────────────

const ERC20_APPROVE_ABI = [
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

const ERC20_BALANCE_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

const TOKEN_MESSENGER_V2_ABI = [
  {
    name: 'DepositForBurn',
    type: 'event',
    anonymous: false,
    inputs: [
      { name: 'burnToken', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'depositor', type: 'address', indexed: true },
      { name: 'mintRecipient', type: 'bytes32', indexed: false },
      { name: 'destinationDomain', type: 'uint32', indexed: false },
      {
        name: 'destinationTokenMessenger',
        type: 'bytes32',
        indexed: false,
      },
      { name: 'destinationCaller', type: 'bytes32', indexed: false },
      { name: 'maxFee', type: 'uint256', indexed: false },
      {
        name: 'minFinalityThreshold',
        type: 'uint32',
        indexed: true,
      },
      { name: 'hookData', type: 'bytes', indexed: false },
    ],
  },
  {
    name: 'depositForBurn',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'amount', type: 'uint256' },
      { name: 'destinationDomain', type: 'uint32' },
      { name: 'mintRecipient', type: 'bytes32' },
      { name: 'burnToken', type: 'address' },
      { name: 'destinationCaller', type: 'bytes32' },
      { name: 'maxFee', type: 'uint256' },
      { name: 'minFinalityThreshold', type: 'uint32' },
    ],
    outputs: [],
  },
] as const;

const MESSAGE_SENT_TOPIC =
  '0x8c5261668696ce22758910d05bab8f186d6eb247ceac2af2e82c7dc17669b036';

const MESSAGE_SENT_ABI = [
  {
    name: 'MessageSent',
    type: 'event',
    anonymous: false,
    inputs: [{ name: 'message', type: 'bytes', indexed: false }],
  },
] as const;

/**
 * Fail closed for batched/malformed CCTP sends. Until Veyra binds each
 * DepositForBurn log index to its message index, a source tx emitting multiple
 * MessageSent logs cannot be safely represented by one ActivityReceipt.
 */
export function extractUniqueCctpSourceMessage(
  receipt: Pick<TransactionReceipt, 'status' | 'logs'>,
): `0x${string}` | null {
  if (receipt.status !== 'success') return null;

  const transmitter = MANIFEST_CONSTANTS.CCTP_V2_MESSAGE_TRANSMITTER.toLowerCase();
  let message: `0x${string}` | null = null;

  for (const log of receipt.logs) {
    if (
      log.address.toLowerCase() !== transmitter ||
      log.topics[0]?.toLowerCase() !== MESSAGE_SENT_TOPIC
    ) {
      continue;
    }

    if (message !== null) return null;

    try {
      const decoded = decodeEventLog({
        abi: MESSAGE_SENT_ABI,
        data: log.data,
        topics: log.topics,
        strict: true,
      });
      if (decoded.eventName !== 'MessageSent' || decoded.args.message.length <= 2) {
        return null;
      }
      message = decoded.args.message;
    } catch {
      return null;
    }
  }

  return message;
}
/**
 * Compare the emitted CCTP V2 MessageSent TEMPLATE to Circle's signed relay
 * message. Per Circle MessageV2.sol, the transmitter emits a zero nonce (32
 * bytes at offset 12) and zero finalityThresholdExecuted (uint32 at 144).
 * Circle assigns both before signing. All other bytes, including the source
 * / destination domains, messenger, destination caller and full burn body,
 * must stay byte-for-byte identical.
 *
 * This is NOT a generic 'ignore these bytes' comparison: it requires the
 * on-chain template fields to be zero, Circle nonce to be nonzero, and actual
 * finality >= the reviewed minimum, at least STANDARD (2000) for Veyra.
 * No message substitution, truncation, extra bytes or fast-finality downgrade.
 */
export function matchesCctpV2AttestedSourceMessage(
  sourceTemplate: string,
  attestedMessage: string,
): boolean {
  const hex = /^0x(?:[0-9a-fA-F]{2})+$/;
  if (!hex.test(sourceTemplate) || !hex.test(attestedMessage)) return false;
  const source = sourceTemplate.slice(2).toLowerCase();
  const signed = attestedMessage.slice(2).toLowerCase();
  const HEADER_BYTES = 148;
  const NONCE_START = 12 * 2;
  const NONCE_END = 44 * 2;
  const MIN_FINALITY_START = 140 * 2;
  const ACTUAL_FINALITY_START = 144 * 2;
  const BODY_START = HEADER_BYTES * 2;
  const emptyNonce = '0'.repeat(NONCE_END - NONCE_START);
  if (source.length <= BODY_START || source.length !== signed.length) return false;
  if (source.slice(NONCE_START, NONCE_END) !== emptyNonce ||
      signed.slice(NONCE_START, NONCE_END) === emptyNonce ||
      source.slice(ACTUAL_FINALITY_START, BODY_START) !== '00000000') return false;

  const minimum = Number.parseInt(source.slice(MIN_FINALITY_START, ACTUAL_FINALITY_START), 16);
  const actual = Number.parseInt(signed.slice(ACTUAL_FINALITY_START, BODY_START), 16);
  if (!Number.isSafeInteger(minimum) || !Number.isSafeInteger(actual) ||
      minimum < MANIFEST_CONSTANTS.CCTP_STANDARD_FINALITY ||
      actual < minimum) return false;

  return source.slice(0, NONCE_START) === signed.slice(0, NONCE_START) &&
    source.slice(NONCE_END, ACTUAL_FINALITY_START) ===
      signed.slice(NONCE_END, ACTUAL_FINALITY_START) &&
    source.slice(BODY_START) === signed.slice(BODY_START);
}

const ERC20_TRANSFER_TOPIC =
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const ZERO_ADDRESS_TOPIC = `0x${'0'.repeat(64)}`;

const MESSAGE_TRANSMITTER_V2_ABI = [
  {
    name: 'receiveMessage',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'message', type: 'bytes' },
      { name: 'attestation', type: 'bytes' },
    ],
    outputs: [{ name: 'success', type: 'bool' }],
  },
] as const;

// ── Chain → CCTP domain map ──────────────────────────────────────────────────

const CHAIN_ID_TO_CCTP_DOMAIN: Record<number, number> = {
  [MANIFEST_CONSTANTS.ARC_TESTNET_CHAIN_ID]: MANIFEST_CONSTANTS.ARC_TESTNET_CCTP_DOMAIN,
  [MANIFEST_CONSTANTS.ETH_SEPOLIA_CHAIN_ID]: MANIFEST_CONSTANTS.ETH_SEPOLIA_CCTP_DOMAIN,
  [MANIFEST_CONSTANTS.BASE_SEPOLIA_CHAIN_ID]: MANIFEST_CONSTANTS.BASE_SEPOLIA_CCTP_DOMAIN,
};

export function chainIdToCctpDomain(chainId: number): number {
  const domain = CHAIN_ID_TO_CCTP_DOMAIN[chainId];
  if (domain === undefined) throw new Error(`[cctpV2] No CCTP domain for chainId ${chainId}`);
  return domain;
}

// ── Address → bytes32 ────────────────────────────────────────────────────────

function addressToBytes32(addr: Address): `0x${string}` {
  // Left-pad the 20-byte address to 32 bytes (bytes32 representation)
  return `0x000000000000000000000000${addr.slice(2)}` as `0x${string}`;
}

// ── Bridge operation result types ────────────────────────────────────────────

export type BridgeOpStatus = 'APPROVED' | 'BURNED' | 'BRIDGE_PENDING' | 'BRIDGE_UNCONFIRMED' | 'VERIFIED' | 'FAILED';

export interface BridgeOpResult {
  status: BridgeOpStatus;
  approveTxHash?: Hash;
  burnTxHash?: Hash;
  messageHash?: string;
  attestation?: string;
  receiveTxHash?: Hash;
  error?: string;
}

export interface CctpAttestation {
  status: 'pending' | 'complete';
  message?: string;      // hex-encoded message bytes
  attestation?: string;  // hex-encoded attestation bytes
}

const NONEMPTY_HEX_BYTES = /^0x(?:[0-9a-fA-F]{2})+$/;

/**
 * Circle's transaction-hash endpoint is a *collection*. Selecting [0] is
 * unsafe if a transaction emits more than one CCTP message. This single-bridge
 * implementation supports exactly one message; reject ambiguous responses
 * rather than guessing which attestation to use for the reviewed burn.
 */
export function parseUniqueCctpAttestationResponse(payload: unknown): CctpAttestation {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('[cctpV2] Invalid Circle attestation response.');
  }
  const messages = (payload as { messages?: unknown }).messages;
  if (messages === undefined) {
    throw new Error('[cctpV2] Circle attestation response has no messages field.');
  }
  if (!Array.isArray(messages)) {
    throw new Error('[cctpV2] Circle messages must be an array.');
  }
  if (messages.length === 0) return { status: 'pending' };
  if (messages.length !== 1) {
    throw new Error('[cctpV2] Ambiguous Circle attestation: multiple messages for one source tx.');
  }

  const record: unknown = messages[0];
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new Error('[cctpV2] Invalid Circle message record.');
  }
  const row = record as Record<string, unknown>;
  if (row.status !== 'complete') return { status: 'pending' };
  if (
    typeof row.message !== 'string' ||
    typeof row.attestation !== 'string' ||
    !NONEMPTY_HEX_BYTES.test(row.message) ||
    !NONEMPTY_HEX_BYTES.test(row.attestation)
  ) {
    throw new Error('[cctpV2] Complete Circle attestation has invalid message bytes.');
  }

  return { status: 'complete', message: row.message, attestation: row.attestation };
}

// ── Attestation polling (via BFF) ────────────────────────────────────────────

export async function fetchCctpAttestation(sourceDomain: number, txHash: Hash): Promise<CctpAttestation> {
  const url = `/api/cctp/attestation?sourceDomain=${sourceDomain}&txHash=${txHash}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Attestation poll failed: ${res.status}`);
  }
  const data = await res.json() as { ok?: boolean; data?: unknown };
  if (data.ok !== true) {
    throw new Error('[cctpV2] Invalid Circle attestation proxy response.');
  }
  return parseUniqueCctpAttestationResponse(data.data);
}

// ── Step 1: Approve ──────────────────────────────────────────────────────────

export async function approveTokenMessenger(
  walletClient: WalletClient,
  publicClient: PublicClient,
  action: BridgeAction,
): Promise<Hash> {
  const spender = getAddress(MANIFEST_CONSTANTS.CCTP_V2_TOKEN_MESSENGER);
  const from = getAddress(action.from);
  const token = getAddress(action.tokenAddress);

  const hash = await walletClient.writeContract({
    address: token,
    abi: ERC20_APPROVE_ABI,
    functionName: 'approve',
    args: [spender, action.amount],
    account: from,
    chain: null,
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') {
    throw new Error(`[cctpV2] approve transaction reverted: ${hash}`);
  }
  return hash;
}

// ── Step 2: depositForBurn ────────────────────────────────────────────────────

/** Identical parameters for eth_call simulation and signed on-chain burn. */
export function cctpDepositForBurnCall(action: BridgeAction) {
  return {
    address: getAddress(MANIFEST_CONSTANTS.CCTP_V2_TOKEN_MESSENGER),
    abi: TOKEN_MESSENGER_V2_ABI,
    functionName: 'depositForBurn' as const,
    args: [
      action.amount,
      chainIdToCctpDomain(action.destinationChainId),
      addressToBytes32(getAddress(action.to)),
      getAddress(action.tokenAddress),
      ('0x' + '00'.repeat(32)) as `0x${string}`,
      0n,
      MANIFEST_CONSTANTS.CCTP_STANDARD_FINALITY,
    ] as const,
    account: getAddress(action.from),
  };
}

export async function broadcastDepositForBurn(
  walletClient: WalletClient,
  action: BridgeAction,
): Promise<Hash> {
  return walletClient.writeContract({
    ...cctpDepositForBurnCall(action),
    chain: null,
  });
}

/**
 * Compatibility helper for callers that need a confirmed source burn.
 * Crash-safe product flows should use broadcastDepositForBurn(), persist the
 * returned hash immediately, then wait for the receipt separately.
 */
export async function depositForBurn(
  walletClient: WalletClient,
  publicClient: PublicClient,
  action: BridgeAction,
): Promise<Hash> {
  const hash = await broadcastDepositForBurn(walletClient, action);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') {
    throw new Error(`[cctpV2] depositForBurn transaction reverted: ${hash}`);
  }
  return hash;
}

// ── Step 5: receiveMessage ────────────────────────────────────────────────────

export async function broadcastReceiveMessage(
  walletClient: WalletClient,
  destinationChainId: number,
  to: Address,
  messageHex: string,
  attestationHex: string,
): Promise<Hash> {
  // destinationChainId is intentionally retained in the boundary even though
  // the current wallet adapter selects the chain externally. Validate that
  // Veyra only broadcasts to a known CCTP destination.
  chainIdToCctpDomain(destinationChainId);

  const transmitter = getAddress(MANIFEST_CONSTANTS.CCTP_V2_MESSAGE_TRANSMITTER);

  return walletClient.writeContract({
    address: transmitter,
    abi: MESSAGE_TRANSMITTER_V2_ABI,
    functionName: 'receiveMessage',
    args: [messageHex as `0x${string}`, attestationHex as `0x${string}`],
    account: to,
    chain: null,
  });
}

/**
 * Compatibility helper for callers that need a confirmed destination receive.
 * Crash-safe product flows should use broadcastReceiveMessage(), persist the
 * returned hash immediately, then wait for the receipt separately.
 */
export async function receiveMessage(
  walletClient: WalletClient,
  publicClient: PublicClient,
  destinationChainId: number,
  to: Address,
  messageHex: string,
  attestationHex: string,
): Promise<Hash> {
  const hash = await broadcastReceiveMessage(
    walletClient,
    destinationChainId,
    to,
    messageHex,
    attestationHex,
  );
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') {
    throw new Error(`[cctpV2] receiveMessage transaction reverted: ${hash}`);
  }
  return hash;
}

// ── Receipt evidence verification ────────────────────────────────────────────

function addressToTopic(address: Address): string {
  return `0x${'0'.repeat(24)}${address.slice(2).toLowerCase()}`;
}

export interface CctpSourceReceiptExpectation {
  burnToken: Address;
  amount: bigint;
  depositor: Address;
  mintRecipient: Address;
  destinationChainId: number;
}

export function verifyCctpSourceReceiptEvidence(
  receipt: Pick<TransactionReceipt, 'status' | 'logs'>,
  expected?: CctpSourceReceiptExpectation,
): { verified: boolean; detail: string } {
  if (receipt.status !== 'success') {
    return {
      verified: false,
      detail: 'Source CCTP transaction did not succeed.',
    };
  }

  if (!extractUniqueCctpSourceMessage(receipt)) {
    return {
      verified: false,
      detail:
        'Source CCTP receipt must contain exactly one valid MessageSent from MessageTransmitterV2; batched or malformed messages are not supported.',
    };
  }

  if (!expected) {
    return {
      verified: true,
      detail:
        'Source CCTP receipt succeeded and contains MessageSent from MessageTransmitterV2.',
    };
  }

  const messenger =
    MANIFEST_CONSTANTS.CCTP_V2_TOKEN_MESSENGER.toLowerCase();
  const expectedRecipient = addressToBytes32(
    getAddress(expected.mintRecipient),
  ).toLowerCase();
  const expectedDomain = chainIdToCctpDomain(
    expected.destinationChainId,
  );
  const expectedDestinationMessenger = addressToBytes32(
    getAddress(MANIFEST_CONSTANTS.CCTP_V2_TOKEN_MESSENGER),
  ).toLowerCase();
  const zeroCaller = `0x${'0'.repeat(64)}`;

  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== messenger) continue;

    try {
      const decoded = decodeEventLog({
        abi: TOKEN_MESSENGER_V2_ABI,
        data: log.data,
        topics: log.topics,
        strict: true,
      });
      if (decoded.eventName !== 'DepositForBurn') continue;

      const args = decoded.args;

      if (
        args.burnToken.toLowerCase() ===
          getAddress(expected.burnToken).toLowerCase() &&
        args.amount === expected.amount &&
        args.depositor.toLowerCase() ===
          getAddress(expected.depositor).toLowerCase() &&
        args.mintRecipient.toLowerCase() === expectedRecipient &&
        Number(args.destinationDomain) === expectedDomain &&
        args.destinationTokenMessenger.toLowerCase() ===
          expectedDestinationMessenger &&
        args.destinationCaller.toLowerCase() === zeroCaller &&
        args.maxFee === 0n &&
        Number(args.minFinalityThreshold) ===
          MANIFEST_CONSTANTS.CCTP_STANDARD_FINALITY &&
        args.hookData === '0x'
      ) {
        return {
          verified: true,
          detail:
            'Source receipt contains exact CCTP DepositForBurn and MessageSent evidence for the reviewed bridge.',
        };
      }
    } catch {
      // Ignore unrelated/un-decodable TokenMessenger logs.
    }
  }

  return {
    verified: false,
    detail:
      'Source CCTP receipt does not contain the exact reviewed DepositForBurn event.',
  };
}

export function verifyCctpDestinationReceiptEvidence(
  receipt: Pick<TransactionReceipt, 'status' | 'logs'>,
  recipientAddress: Address,
  tokenAddress: Address,
  expectedAmount: bigint,
): { verified: boolean; detail: string; transferAmount: bigint | null } {
  if (receipt.status !== 'success') {
    return {
      verified: false,
      detail: 'Destination CCTP receive transaction did not succeed.',
      transferAmount: null,
    };
  }

  const token = getAddress(tokenAddress).toLowerCase();
  const recipientTopic = addressToTopic(getAddress(recipientAddress));

  for (const log of receipt.logs) {
    if (
      log.address.toLowerCase() !== token ||
      log.topics[0]?.toLowerCase() !== ERC20_TRANSFER_TOPIC ||
      log.topics[1]?.toLowerCase() !== ZERO_ADDRESS_TOPIC ||
      log.topics[2]?.toLowerCase() !== recipientTopic ||
      !/^0x[0-9a-fA-F]{64}$/.test(log.data)
    ) {
      continue;
    }

    const transferAmount = BigInt(log.data);
    if (transferAmount === expectedAmount) {
      return {
        verified: true,
        detail:
          'Destination receipt contains the exact USDC mint to the reviewed recipient.',
        transferAmount,
      };
    }
  }

  return {
    verified: false,
    detail:
      'Destination receipt does not contain the exact expected USDC mint to the reviewed recipient.',
    transferAmount: null,
  };
}

// ── Step 6: Post-receive balance verification ────────────────────────────────

export async function verifyDestinationBalance(
  publicClient: PublicClient,
  recipientAddress: Address,
  tokenAddress: Address,
  expectedMinAmount: bigint,
  balanceBefore: bigint,
): Promise<{ verified: boolean; actualDelta: bigint; detail: string }> {
  const balanceAfter = await publicClient.readContract({
    address: tokenAddress,
    abi: ERC20_BALANCE_ABI,
    functionName: 'balanceOf',
    args: [recipientAddress],
  });

  const delta = balanceAfter - balanceBefore;
  if (delta === expectedMinAmount) {
    return {
      verified: true,
      actualDelta: delta,
      detail: `Balance increased by exactly ${delta} as expected`,
    };
  }
  return {
    verified: false,
    actualDelta: delta,
    detail: `Balance delta ${delta} does not equal expected ${expectedMinAmount}`,
  };
}

// ── Balance snapshot before bridge ──────────────────────────────────────────

export async function readBalance(
  publicClient: PublicClient,
  tokenAddress: Address,
  walletAddress: Address,
): Promise<bigint> {
  return publicClient.readContract({
    address: tokenAddress,
    abi: ERC20_BALANCE_ABI,
    functionName: 'balanceOf',
    args: [walletAddress],
  });
}
