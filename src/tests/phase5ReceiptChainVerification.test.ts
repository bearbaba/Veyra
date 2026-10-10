import { describe, expect, it, vi } from 'vitest';
import { encodeFunctionData, type Address, type Hash, type Hex } from 'viem';
import type { ActivityReceiptSyncInput } from '../../server/db/repositories/receiptRepository.js';
import {
  verifyBridgeReceiptSync,
  verifyTransferReceiptSync,
  type ReceiptVerificationClient,
} from '../../server/services/activityReceiptVerificationService.js';
import { MANIFEST_CONSTANTS } from '../providers/registry/providerManifest';

const FROM: Address = '0x1111111111111111111111111111111111111111';
const TO: Address = '0x2222222222222222222222222222222222222222';
const TX: Hash =
  '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const RECEIVE_TX: Hash =
  '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const TRANSFER_TOPIC =
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const MESSAGE_SENT_TOPIC =
  '0x8c5261668696ce22758910d05bab8f186d6eb247ceac2af2e82c7dc17669b036';

const TRANSFER_ABI = [
  {
    name: 'transfer',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

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

function addressTopic(address: Address): Hex {
  return `0x${'0'.repeat(24)}${address.slice(2).toLowerCase()}`;
}

function uint256Data(value: bigint): Hex {
  return `0x${value.toString(16).padStart(64, '0')}`;
}

function transferInput(
  overrides: Partial<ActivityReceiptSyncInput> = {},
): ActivityReceiptSyncInput {
  return {
    receiptId: 'veyra-0123456789abcdef',
    clientIntentId: '550e8400-e29b-41d4-a716-446655440000',
    localRevision: 2,
    actionType: 'TRANSFER',
    surface: 'PAY',
    senderAddress: FROM,
    senderChainId: MANIFEST_CONSTANTS.ARC_TESTNET_CHAIN_ID,
    recipientSnapshotId: null,
    recipientAddress: TO,
    recipientChainId: MANIFEST_CONSTANTS.ARC_TESTNET_CHAIN_ID,
    amountRaw: '1000000',
    amountDecimals: 6,
    assetId: 'usdc',
    tokenAddress: MANIFEST_CONSTANTS.ARC_TESTNET_USDC,
    providerId: 'arc-erc20-transfer',
    routeId: 'transfer:test',
    environment: 'testnet',
    status: 'COMPLETE',
    executionTxHash: TX,
    ...overrides,
  };
}

function bridgeInput(
  overrides: Partial<ActivityReceiptSyncInput> = {},
): ActivityReceiptSyncInput {
  return {
    ...transferInput(),
    actionType: 'BRIDGE',
    surface: 'BRIDGE',
    recipientChainId: MANIFEST_CONSTANTS.ETH_SEPOLIA_CHAIN_ID,
    providerId: 'cctp-v2-bridge',
    routeId: 'bridge:test',
    burnTxHash: TX,
    receiveTxHash: RECEIVE_TX,
    executionTxHash: TX,
    ...overrides,
  };
}

function transferClient(status: 'success' | 'reverted' = 'success'): ReceiptVerificationClient {
  const calldata = encodeFunctionData({
    abi: TRANSFER_ABI,
    functionName: 'transfer',
    args: [TO, 1_000_000n],
  });
  return {
    getTransaction: vi.fn().mockResolvedValue({
      from: FROM,
      to: MANIFEST_CONSTANTS.ARC_TESTNET_USDC,
      input: calldata,
    }),
    getTransactionReceipt: vi.fn().mockResolvedValue({
      status,
      blockNumber: 123n,
      logs:
        status === 'success'
          ? [
              {
                address: MANIFEST_CONSTANTS.ARC_TESTNET_USDC,
                topics: [
                  TRANSFER_TOPIC,
                  addressTopic(FROM),
                  addressTopic(TO),
                ],
                data: uint256Data(1_000_000n),
              },
            ]
          : [],
    }),
  };
}

function cctpSourceClient(): ReceiptVerificationClient {
  const mintRecipient: Hex =
    `0x000000000000000000000000${TO.slice(2).toLowerCase()}`;
  const calldata = encodeFunctionData({
    abi: DEPOSIT_FOR_BURN_ABI,
    functionName: 'depositForBurn',
    args: [
      1_000_000n,
      MANIFEST_CONSTANTS.ETH_SEPOLIA_CCTP_DOMAIN,
      mintRecipient,
      MANIFEST_CONSTANTS.ARC_TESTNET_USDC,
      `0x${'00'.repeat(32)}`,
      0n,
      MANIFEST_CONSTANTS.CCTP_STANDARD_FINALITY,
    ],
  });

  return {
    getTransaction: vi.fn().mockResolvedValue({
      from: FROM,
      to: MANIFEST_CONSTANTS.CCTP_V2_TOKEN_MESSENGER,
      input: calldata,
    }),
    getTransactionReceipt: vi.fn().mockResolvedValue({
      status: 'success',
      blockNumber: 456n,
      logs: [
        {
          address: MANIFEST_CONSTANTS.CCTP_V2_MESSAGE_TRANSMITTER,
          topics: [MESSAGE_SENT_TOPIC],
          data: '0x1234',
        },
      ],
    }),
  };
}

function cctpDestinationClient(): ReceiptVerificationClient {
  return {
    getTransaction: vi.fn(),
    getTransactionReceipt: vi.fn().mockResolvedValue({
      status: 'success',
      blockNumber: 789n,
      logs: [
        {
          address: MANIFEST_CONSTANTS.ETH_SEPOLIA_USDC,
          topics: [
            TRANSFER_TOPIC,
            `0x${'0'.repeat(64)}`,
            addressTopic(TO),
          ],
          data: uint256Data(1_000_000n),
        },
      ],
    }),
  };
}

describe('Phase 5 server-side receipt verification', () => {
  it('overrides a client FAILED claim when the exact transfer is verified', async () => {
    const result = await verifyTransferReceiptSync(
      transferInput({ status: 'FAILED' }),
      transferClient(),
    );

    expect(result.status).toBe('COMPLETE');
    expect(result.executionBlock).toBe(123);
    expect(result.actualAmountRaw).toBe('1000000');
  });

  it('overrides a client COMPLETE claim when the transaction reverted', async () => {
    const result = await verifyTransferReceiptSync(
      transferInput({ status: 'COMPLETE' }),
      transferClient('reverted'),
    );

    expect(result.status).toBe('FAILED');
    expect(result.failureReason).toMatch(/reverted/i);
  });

  it('rejects terminal transfer sync when calldata is not the reviewed amount', async () => {
    const client = transferClient();
    const badCalldata = encodeFunctionData({
      abi: TRANSFER_ABI,
      functionName: 'transfer',
      args: [TO, 2_000_000n],
    });
    client.getTransaction = vi.fn().mockResolvedValue({
      from: FROM,
      to: MANIFEST_CONSTANTS.ARC_TESTNET_USDC,
      input: badCalldata,
    });

    await expect(
      verifyTransferReceiptSync(transferInput(), client),
    ).rejects.toThrow(/calldata does not match/i);
  });

  it('verifies complete CCTP receipts from both source and destination chains', async () => {
    const result = await verifyBridgeReceiptSync(
      bridgeInput(),
      cctpSourceClient(),
      cctpDestinationClient(),
    );

    expect(result.status).toBe('COMPLETE');
    expect(result.burnBlockNumber).toBe(456);
    expect(result.receiveBlockNumber).toBe(789);
    expect(result.actualAmountRaw).toBe('1000000');
  });
});
