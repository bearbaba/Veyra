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
  type Hex,
  decodeFunctionData,
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

// ── Attestation polling (via BFF) ────────────────────────────────────────────

export async function fetchCctpAttestation(sourceDomain: number, txHash: Hash): Promise<CctpAttestation> {
  const url = `/api/cctp/attestation?sourceDomain=${sourceDomain}&txHash=${txHash}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Attestation poll failed: ${res.status}`);
  }
  const data = await res.json() as { ok: boolean; data: { messages?: Array<{ status: string; message?: string; attestation?: string }> } };
  const messages = data.data.messages;
  if (!messages || messages.length === 0) {
    return { status: 'pending' };
  }
  const msg = messages[0];
  if (msg.status === 'complete' && msg.message && msg.attestation) {
    return {
      status: 'complete',
      message: msg.message,
      attestation: msg.attestation,
    };
  }
  return { status: 'pending' };
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

  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

// ── Step 2: depositForBurn ────────────────────────────────────────────────────

export async function broadcastDepositForBurn(
  walletClient: WalletClient,
  action: BridgeAction,
): Promise<Hash> {
  const destinationDomain = chainIdToCctpDomain(action.destinationChainId);
  const mintRecipient = addressToBytes32(getAddress(action.to));
  const burnToken = getAddress(action.tokenAddress);
  const messengerAddress = getAddress(MANIFEST_CONSTANTS.CCTP_V2_TOKEN_MESSENGER);
  const from = getAddress(action.from);

  // destinationCaller = zero bytes32 (anyone can relay)
  const destinationCaller = ('0x' + '00'.repeat(32)) as `0x${string}`;
  // maxFee = 0 for standard transfer (no upfront fee)
  const maxFee = 0n;
  // minFinalityThreshold = 2000 for standard (safe) transfer
  const minFinalityThreshold = MANIFEST_CONSTANTS.CCTP_STANDARD_FINALITY;

  return walletClient.writeContract({
    address: messengerAddress,
    abi: TOKEN_MESSENGER_V2_ABI,
    functionName: 'depositForBurn',
    args: [
      action.amount,
      destinationDomain,
      mintRecipient,
      burnToken,
      destinationCaller,
      maxFee,
      minFinalityThreshold,
    ],
    account: from,
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
  await publicClient.waitForTransactionReceipt({ hash });
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
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

// ── Receipt evidence verification ────────────────────────────────────────────

function addressToTopic(address: Address): string {
  return `0x${'0'.repeat(24)}${address.slice(2).toLowerCase()}`;
}

export interface CctpSourceTransactionLike {
  from: Address;
  to: Address | null;
  input: Hex;
}

export interface CctpSourceBindingExpectation {
  sender: Address;
  recipient: Address;
  tokenAddress: Address;
  amount: bigint;
  destinationChainId: number;
}

export function verifyCctpSourceTransactionBinding(
  transaction: CctpSourceTransactionLike,
  expected: CctpSourceBindingExpectation,
): { verified: boolean; detail: string } {
  const messenger = getAddress(
    MANIFEST_CONSTANTS.CCTP_V2_TOKEN_MESSENGER,
  ).toLowerCase();
  const sender = getAddress(expected.sender).toLowerCase();
  const recipient = addressToBytes32(getAddress(expected.recipient)).toLowerCase();
  const token = getAddress(expected.tokenAddress).toLowerCase();
  const destinationDomain = chainIdToCctpDomain(expected.destinationChainId);
  const zeroBytes32 = `0x${'00'.repeat(32)}`.toLowerCase();

  if (expected.amount <= 0n) {
    return { verified: false, detail: 'CCTP source amount must be positive.' };
  }
  if (transaction.from.toLowerCase() !== sender) {
    return {
      verified: false,
      detail: 'CCTP source transaction sender does not match the reviewed wallet.',
    };
  }
  if (!transaction.to || transaction.to.toLowerCase() !== messenger) {
    return {
      verified: false,
      detail:
        'CCTP source transaction was not sent to the configured TokenMessengerV2.',
    };
  }

  try {
    const decoded = decodeFunctionData({
      abi: TOKEN_MESSENGER_V2_ABI,
      data: transaction.input,
    });
    if (decoded.functionName !== 'depositForBurn') {
      return {
        verified: false,
        detail: 'CCTP source transaction is not depositForBurn.',
      };
    }

    const [
      amount,
      decodedDestinationDomain,
      mintRecipient,
      burnToken,
      destinationCaller,
      maxFee,
      minFinalityThreshold,
    ] = decoded.args;

    if (
      amount !== expected.amount ||
      decodedDestinationDomain !== destinationDomain ||
      mintRecipient.toLowerCase() !== recipient ||
      burnToken.toLowerCase() !== token ||
      destinationCaller.toLowerCase() !== zeroBytes32 ||
      maxFee !== 0n ||
      minFinalityThreshold !== MANIFEST_CONSTANTS.CCTP_STANDARD_FINALITY
    ) {
      return {
        verified: false,
        detail:
          'CCTP source transaction calldata does not match the reviewed burn route.',
      };
    }
  } catch {
    return {
      verified: false,
      detail: 'CCTP source transaction calldata could not be decoded safely.',
    };
  }

  return {
    verified: true,
    detail:
      'CCTP source transaction exactly matches the reviewed depositForBurn route.',
  };
}

export function verifyCctpSourceReceiptEvidence(
  receipt: Pick<TransactionReceipt, 'status' | 'logs'>,
): { verified: boolean; detail: string } {
  if (receipt.status !== 'success') {
    return { verified: false, detail: 'Source CCTP transaction did not succeed.' };
  }

  const transmitter =
    MANIFEST_CONSTANTS.CCTP_V2_MESSAGE_TRANSMITTER.toLowerCase();
  const hasMessageSent = receipt.logs.some(
    (log) =>
      log.address.toLowerCase() === transmitter &&
      log.topics[0]?.toLowerCase() === MESSAGE_SENT_TOPIC,
  );

  if (!hasMessageSent) {
    return {
      verified: false,
      detail:
        'Source CCTP receipt is missing MessageSent from MessageTransmitterV2.',
    };
  }

  return {
    verified: true,
    detail:
      'Source CCTP receipt succeeded and contains MessageSent from MessageTransmitterV2.',
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
