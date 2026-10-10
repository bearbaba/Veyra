import { describe, expect, it, vi } from 'vitest';
import type {
  PublicClient,
  WalletClient,
  Hash,
  TransactionReceipt,
} from 'viem';
import { encodeFunctionData } from 'viem';
import type { BridgeAction } from '../core/actions/actionSchema';
import {
  broadcastDepositForBurn,
  broadcastReceiveMessage,
  depositForBurn,
  receiveMessage,
  verifyCctpDestinationReceiptEvidence,
  verifyCctpSourceReceiptEvidence,
  verifyCctpSourceTransactionBinding,
  verifyDestinationBalance,
} from '../providers/cctp/cctpV2Adapter';
import { MANIFEST_CONSTANTS } from '../providers/registry/providerManifest';

const BURN_HASH =
  '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as Hash;
const RECEIVE_HASH =
  '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as Hash;
const WALLET = '0x1111111111111111111111111111111111111111';
const RECIPIENT = '0x2222222222222222222222222222222222222222';

const MESSAGE_SENT_TOPIC =
  '0x8c5261668696ce22758910d05bab8f186d6eb247ceac2af2e82c7dc17669b036';
const TRANSFER_TOPIC =
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

const DEPOSIT_FOR_BURN_ABI = [
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

function addressTopic(address: string): `0x${string}` {
  return `0x${'0'.repeat(24)}${address.slice(2).toLowerCase()}`;
}

function uint256Data(value: bigint): `0x${string}` {
  return `0x${value.toString(16).padStart(64, '0')}`;
}


function action(): BridgeAction {
  const now = Date.now();
  return {
    actionType: 'BRIDGE',
    actionId: 'phase4f-cctp-broadcast',
    createdAt: now,
    chainId: MANIFEST_CONSTANTS.ARC_TESTNET_CHAIN_ID,
    provenance: {
      source: 'PROVIDER_QUOTE',
      fetchedAt: now,
      providerId: 'cctp-v2-bridge',
    },
    sourceChainId: MANIFEST_CONSTANTS.ARC_TESTNET_CHAIN_ID,
    destinationChainId: MANIFEST_CONSTANTS.ETH_SEPOLIA_CHAIN_ID,
    tokenAddress: MANIFEST_CONSTANTS.ARC_TESTNET_USDC.toLowerCase(),
    tokenDecimals: 6,
    amount: 1_000_000n,
    from: WALLET,
    to: RECIPIENT,
    providerId: 'cctp-v2-bridge',
    quoteExpiresAt: now + 120_000,
  };
}

describe('Phase 4F CCTP broadcast safety', () => {
  it('returns the source burn hash immediately from the wallet broadcast boundary', async () => {
    const writeContract = vi.fn().mockResolvedValue(BURN_HASH);
    const walletClient = { writeContract } as unknown as WalletClient;

    await expect(
      broadcastDepositForBurn(walletClient, action()),
    ).resolves.toBe(BURN_HASH);

    expect(writeContract).toHaveBeenCalledTimes(1);
  });

  it('keeps the legacy confirmed helper layered on top of broadcast', async () => {
    const order: string[] = [];
    const walletClient = {
      writeContract: vi.fn().mockImplementation(() => {
        order.push('broadcast');
        return Promise.resolve(BURN_HASH);
      }),
    } as unknown as WalletClient;
    const publicClient = {
      waitForTransactionReceipt: vi.fn().mockImplementation(() => {
        order.push('confirm');
        return Promise.resolve({ status: 'success' });
      }),
    } as unknown as PublicClient;

    await expect(
      depositForBurn(walletClient, publicClient, action()),
    ).resolves.toBe(BURN_HASH);

    expect(order).toEqual(['broadcast', 'confirm']);
  });

  it('returns destination receive hash before any receipt wait is required', async () => {
    const writeContract = vi.fn().mockResolvedValue(RECEIVE_HASH);
    const walletClient = { writeContract } as unknown as WalletClient;

    await expect(
      broadcastReceiveMessage(
        walletClient,
        MANIFEST_CONSTANTS.ETH_SEPOLIA_CHAIN_ID,
        RECIPIENT,
        '0x1234',
        '0xabcd',
      ),
    ).resolves.toBe(RECEIVE_HASH);

    expect(writeContract).toHaveBeenCalledTimes(1);
  });

  it('rejects unknown destination chains before broadcasting receiveMessage', async () => {
    const writeContract = vi.fn().mockResolvedValue(RECEIVE_HASH);
    const walletClient = { writeContract } as unknown as WalletClient;

    await expect(
      broadcastReceiveMessage(
        walletClient,
        999999,
        RECIPIENT,
        '0x1234',
        '0xabcd',
      ),
    ).rejects.toThrow(/No CCTP domain/i);

    expect(writeContract).not.toHaveBeenCalled();
  });

  it('binds source transaction calldata to the exact reviewed CCTP route', () => {
    const reviewed = action();
    const mintRecipient =
      `0x000000000000000000000000${RECIPIENT.slice(2).toLowerCase()}` as `0x${string}`;
    const input = encodeFunctionData({
      abi: DEPOSIT_FOR_BURN_ABI,
      functionName: 'depositForBurn',
      args: [
        reviewed.amount,
        MANIFEST_CONSTANTS.ETH_SEPOLIA_CCTP_DOMAIN,
        mintRecipient,
        MANIFEST_CONSTANTS.ARC_TESTNET_USDC,
        `0x${'00'.repeat(32)}`,
        0n,
        MANIFEST_CONSTANTS.CCTP_STANDARD_FINALITY,
      ],
    });

    expect(
      verifyCctpSourceTransactionBinding(
        {
          from: WALLET,
          to: MANIFEST_CONSTANTS.CCTP_V2_TOKEN_MESSENGER,
          input,
        },
        {
          sender: WALLET,
          recipient: RECIPIENT,
          tokenAddress: MANIFEST_CONSTANTS.ARC_TESTNET_USDC,
          amount: reviewed.amount,
          destinationChainId: reviewed.destinationChainId,
        },
      ),
    ).toMatchObject({ verified: true });
  });

  it('rejects a source burn whose calldata amount differs from recovery metadata', () => {
    const reviewed = action();
    const mintRecipient =
      `0x000000000000000000000000${RECIPIENT.slice(2).toLowerCase()}` as `0x${string}`;
    const input = encodeFunctionData({
      abi: DEPOSIT_FOR_BURN_ABI,
      functionName: 'depositForBurn',
      args: [
        reviewed.amount + 1n,
        MANIFEST_CONSTANTS.ETH_SEPOLIA_CCTP_DOMAIN,
        mintRecipient,
        MANIFEST_CONSTANTS.ARC_TESTNET_USDC,
        `0x${'00'.repeat(32)}`,
        0n,
        MANIFEST_CONSTANTS.CCTP_STANDARD_FINALITY,
      ],
    });

    expect(
      verifyCctpSourceTransactionBinding(
        {
          from: WALLET,
          to: MANIFEST_CONSTANTS.CCTP_V2_TOKEN_MESSENGER,
          input,
        },
        {
          sender: WALLET,
          recipient: RECIPIENT,
          tokenAddress: MANIFEST_CONSTANTS.ARC_TESTNET_USDC,
          amount: reviewed.amount,
          destinationChainId: reviewed.destinationChainId,
        },
      ),
    ).toMatchObject({ verified: false });
  });

  it('requires MessageSent from the canonical transmitter before source confirmation', () => {
    const receipt = {
      status: 'success',
      logs: [
        {
          address: MANIFEST_CONSTANTS.CCTP_V2_MESSAGE_TRANSMITTER,
          topics: [MESSAGE_SENT_TOPIC],
          data: '0x1234',
        },
      ],
    } as unknown as Pick<TransactionReceipt, 'status' | 'logs'>;

    expect(verifyCctpSourceReceiptEvidence(receipt)).toMatchObject({
      verified: true,
    });

    const wrongEmitter = {
      ...receipt,
      logs: [
        {
          ...receipt.logs[0],
          address: MANIFEST_CONSTANTS.CCTP_V2_TOKEN_MESSENGER,
        },
      ],
    } as unknown as Pick<TransactionReceipt, 'status' | 'logs'>;

    expect(verifyCctpSourceReceiptEvidence(wrongEmitter)).toMatchObject({
      verified: false,
    });
  });

  it('requires an exact USDC mint event to the reviewed destination recipient', () => {
    const receipt = {
      status: 'success',
      logs: [
        {
          address: MANIFEST_CONSTANTS.ETH_SEPOLIA_USDC,
          topics: [
            TRANSFER_TOPIC,
            `0x${'0'.repeat(64)}`,
            addressTopic(RECIPIENT),
          ],
          data: uint256Data(1_000_000n),
        },
      ],
    } as unknown as Pick<TransactionReceipt, 'status' | 'logs'>;

    expect(
      verifyCctpDestinationReceiptEvidence(
        receipt,
        RECIPIENT,
        MANIFEST_CONSTANTS.ETH_SEPOLIA_USDC,
        1_000_000n,
      ),
    ).toMatchObject({
      verified: true,
      transferAmount: 1_000_000n,
    });

    expect(
      verifyCctpDestinationReceiptEvidence(
        receipt,
        WALLET,
        MANIFEST_CONSTANTS.ETH_SEPOLIA_USDC,
        1_000_000n,
      ),
    ).toMatchObject({
      verified: false,
    });
  });

  it('requires the destination balance delta to equal the reviewed CCTP amount exactly', async () => {
    const exactClient = {
      readContract: vi.fn().mockResolvedValue(11_000_000n),
    } as unknown as PublicClient;

    await expect(
      verifyDestinationBalance(
        exactClient,
        RECIPIENT,
        MANIFEST_CONSTANTS.ETH_SEPOLIA_USDC,
        1_000_000n,
        10_000_000n,
      ),
    ).resolves.toMatchObject({
      verified: true,
      actualDelta: 1_000_000n,
    });

    const unrelatedExtraTransfer = {
      readContract: vi.fn().mockResolvedValue(11_000_001n),
    } as unknown as PublicClient;

    await expect(
      verifyDestinationBalance(
        unrelatedExtraTransfer,
        RECIPIENT,
        MANIFEST_CONSTANTS.ETH_SEPOLIA_USDC,
        1_000_000n,
        10_000_000n,
      ),
    ).resolves.toMatchObject({
      verified: false,
      actualDelta: 1_000_001n,
    });
  });

  it('keeps the legacy receive helper broadcast-then-confirm ordered', async () => {
    const order: string[] = [];
    const walletClient = {
      writeContract: vi.fn().mockImplementation(() => {
        order.push('broadcast');
        return Promise.resolve(RECEIVE_HASH);
      }),
    } as unknown as WalletClient;
    const publicClient = {
      waitForTransactionReceipt: vi.fn().mockImplementation(() => {
        order.push('confirm');
        return Promise.resolve({ status: 'success' });
      }),
    } as unknown as PublicClient;

    await expect(
      receiveMessage(
        walletClient,
        publicClient,
        MANIFEST_CONSTANTS.ETH_SEPOLIA_CHAIN_ID,
        RECIPIENT,
        '0x1234',
        '0xabcd',
      ),
    ).resolves.toBe(RECEIVE_HASH);

    expect(order).toEqual(['broadcast', 'confirm']);
  });
});
