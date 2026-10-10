import { describe, expect, it, vi } from 'vitest';
import {
  encodeAbiParameters,
  encodeEventTopics,
  type TransactionReceipt,
} from 'viem';
import { MANIFEST_CONSTANTS } from '../providers/registry/providerManifest';
import {
  ActivityReceiptEvidenceError,
  verifyActivityReceiptTransitionEvidence,
  type ActivityReceiptEvidenceContext,
} from '../../server/services/activityReceiptVerificationService.js';

const SENDER = '0x1111111111111111111111111111111111111111';
const RECIPIENT = '0x2222222222222222222222222222222222222222';
const SOURCE_TX =
  '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const DEST_TX =
  '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const MESSAGE_SENT_TOPIC =
  '0x8c5261668696ce22758910d05bab8f186d6eb247ceac2af2e82c7dc17669b036';
const TRANSFER_TOPIC =
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

const DEPOSIT_EVENT = {
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
} as const;

function addressTopic(address: string): `0x${string}` {
  return `0x${'0'.repeat(24)}${address.slice(2).toLowerCase()}`;
}

function bytes32Address(address: string): `0x${string}` {
  return `0x${'0'.repeat(24)}${address.slice(2).toLowerCase()}`;
}

function sourceReceipt(
  amount = 1_000_000n,
): TransactionReceipt {
  const topics = encodeEventTopics({
    abi: [DEPOSIT_EVENT],
    eventName: 'DepositForBurn',
    args: {
      burnToken: MANIFEST_CONSTANTS.ARC_TESTNET_USDC,
      depositor: SENDER,
      minFinalityThreshold: MANIFEST_CONSTANTS.CCTP_STANDARD_FINALITY,
    },
  });

  const data = encodeAbiParameters(
    [
      { type: 'uint256' },
      { type: 'bytes32' },
      { type: 'uint32' },
      { type: 'bytes32' },
      { type: 'bytes32' },
      { type: 'uint256' },
      { type: 'bytes' },
    ],
    [
      amount,
      bytes32Address(RECIPIENT),
      MANIFEST_CONSTANTS.ETH_SEPOLIA_CCTP_DOMAIN,
      `0x${'11'.repeat(32)}`,
      `0x${'00'.repeat(32)}`,
      0n,
      '0x',
    ],
  );

  return {
    status: 'success',
    blockNumber: 100n,
    logs: [
      {
        address: MANIFEST_CONSTANTS.CCTP_V2_TOKEN_MESSENGER,
        topics,
        data,
      },
      {
        address: MANIFEST_CONSTANTS.CCTP_V2_MESSAGE_TRANSMITTER,
        topics: [MESSAGE_SENT_TOPIC],
        data: '0x1234',
      },
    ],
  } as unknown as TransactionReceipt;
}

function destinationReceipt(
  recipient = RECIPIENT,
): TransactionReceipt {
  return {
    status: 'success',
    blockNumber: 200n,
    logs: [
      {
        address: MANIFEST_CONSTANTS.ETH_SEPOLIA_USDC,
        topics: [
          TRANSFER_TOPIC,
          `0x${'0'.repeat(64)}`,
          addressTopic(recipient),
        ],
        data: `0x${1_000_000n.toString(16).padStart(64, '0')}`,
      },
    ],
  } as unknown as TransactionReceipt;
}

function context(
  overrides: Partial<ActivityReceiptEvidenceContext> = {},
): ActivityReceiptEvidenceContext {
  return {
    providerId: 'cctp-v2-bridge',
    action: 'BRIDGE',
    senderAddress: SENDER,
    senderChainId: MANIFEST_CONSTANTS.ARC_TESTNET_CHAIN_ID,
    recipientAddress: RECIPIENT,
    recipientChainId: MANIFEST_CONSTANTS.ETH_SEPOLIA_CHAIN_ID,
    amountRaw: '1000000',
    tokenAddress: MANIFEST_CONSTANTS.ARC_TESTNET_USDC,
    burnTxHash: SOURCE_TX,
    burnChainId: MANIFEST_CONSTANTS.ARC_TESTNET_CHAIN_ID,
    burnBlockNumber: null,
    receiveTxHash: DEST_TX,
    receiveChainId: MANIFEST_CONSTANTS.ETH_SEPOLIA_CHAIN_ID,
    receiveBlockNumber: null,
    ...overrides,
  };
}

describe('Phase 5 authoritative ActivityReceipt evidence', () => {
  it('accepts SOURCE_CONFIRMED only after exact source CCTP receipt verification', async () => {
    const fetchReceipt = vi.fn().mockResolvedValue(sourceReceipt());

    await expect(
      verifyActivityReceiptTransitionEvidence(
        context(),
        {
          status: 'SOURCE_CONFIRMED',
          burnBlockNumber: 100,
        },
        fetchReceipt,
      ),
    ).resolves.toBeUndefined();

    expect(fetchReceipt).toHaveBeenCalledWith(
      MANIFEST_CONSTANTS.ARC_TESTNET_CHAIN_ID,
      SOURCE_TX,
    );
  });

  it('rejects a source receipt whose DepositForBurn amount differs from review', async () => {
    const fetchReceipt = vi.fn().mockResolvedValue(sourceReceipt(999_999n));

    await expect(
      verifyActivityReceiptTransitionEvidence(
        context(),
        {
          status: 'SOURCE_CONFIRMED',
          burnBlockNumber: 100,
        },
        fetchReceipt,
      ),
    ).rejects.toMatchObject({
      code: 'SOURCE_RECEIPT_UNVERIFIED',
    });
  });

  it('rejects a claimed source block that differs from authoritative receipt', async () => {
    const fetchReceipt = vi.fn().mockResolvedValue(sourceReceipt());

    await expect(
      verifyActivityReceiptTransitionEvidence(
        context(),
        {
          status: 'SOURCE_CONFIRMED',
          burnBlockNumber: 101,
        },
        fetchReceipt,
      ),
    ).rejects.toBeInstanceOf(ActivityReceiptEvidenceError);
  });

  it('accepts CONFIRMED only after the exact destination USDC mint is present', async () => {
    const fetchReceipt = vi.fn().mockResolvedValue(destinationReceipt());

    await expect(
      verifyActivityReceiptTransitionEvidence(
        context(),
        {
          status: 'CONFIRMED',
          receiveBlockNumber: 200,
        },
        fetchReceipt,
      ),
    ).resolves.toBeUndefined();

    expect(fetchReceipt).toHaveBeenCalledWith(
      MANIFEST_CONSTANTS.ETH_SEPOLIA_CHAIN_ID,
      DEST_TX,
    );
  });

  it('rejects a destination receipt minting to a different recipient', async () => {
    const fetchReceipt = vi
      .fn()
      .mockResolvedValue(
        destinationReceipt(
          '0x3333333333333333333333333333333333333333',
        ),
      );

    await expect(
      verifyActivityReceiptTransitionEvidence(
        context(),
        {
          status: 'CONFIRMED',
          receiveBlockNumber: 200,
        },
        fetchReceipt,
      ),
    ).rejects.toMatchObject({
      code: 'DESTINATION_RECEIPT_UNVERIFIED',
    });
  });

  it('does not perform chain reads for non-authoritative lifecycle hints', async () => {
    const fetchReceipt = vi.fn();

    await expect(
      verifyActivityReceiptTransitionEvidence(
        context(),
        { status: 'BROADCAST' },
        fetchReceipt,
      ),
    ).resolves.toBeUndefined();

    expect(fetchReceipt).not.toHaveBeenCalled();
  });
});
