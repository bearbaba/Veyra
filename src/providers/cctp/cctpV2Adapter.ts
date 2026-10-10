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
  if (msg.status === 'complete' && msg.attestation) {
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
