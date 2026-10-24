import { describe, expect, it } from 'vitest';
import {
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  parseAbi,
  type TransactionReceipt,
} from 'viem';
import { MANIFEST_CONSTANTS } from '../providers/registry/providerManifest';
import {
  assertCctpSourceCheckpointAttestation,
  type SourceTransactionEvidence,
} from '../../server/services/cctpBridgeSourceAttestationService.js';
import type { BridgeRecoveryInput } from '../../server/db/repositories/bridgeRecoveryRepository.js';

const SENDER = '0x1111111111111111111111111111111111111111';
const RECIPIENT = '0x2222222222222222222222222222222222222222';
const SOURCE_HASH = `0x${'a'.repeat(64)}` as const;
const MESSAGE = '0x11223344' as const;
const ATTESTATION = '0xaabbccdd' as const;
const MESSAGE_SENT_TOPIC =
  '0x8c5261668696ce22758910d05bab8f186d6eb247ceac2af2e82c7dc17669b036';

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
    { name: 'destinationTokenMessenger', type: 'bytes32', indexed: false },
    { name: 'destinationCaller', type: 'bytes32', indexed: false },
    { name: 'maxFee', type: 'uint256', indexed: false },
    { name: 'minFinalityThreshold', type: 'uint32', indexed: true },
    { name: 'hookData', type: 'bytes', indexed: false },
  ],
} as const;

const DEPOSIT_ABI = parseAbi([
  'function depositForBurn(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken, bytes32 destinationCaller, uint256 maxFee, uint32 minFinalityThreshold)',
]);
const bytes32Address = (address: string) =>
  `0x${'0'.repeat(24)}${address.slice(2)}` as `0x${string}`;

function checkpoint(
  override: Partial<BridgeRecoveryInput> = {},
): BridgeRecoveryInput {
  return {
    planId: 'reviewed-self-relay',
    stage: 'ATTESTATION_READY',
    burnTxHash: SOURCE_HASH,
    sourceChainId: MANIFEST_CONSTANTS.ARC_TESTNET_CHAIN_ID,
    destinationChainId: MANIFEST_CONSTANTS.ETH_SEPOLIA_CHAIN_ID,
    walletAddress: SENDER,
    recipientAddress: RECIPIENT,
    amount: '1000000',
    tokenAddress: MANIFEST_CONSTANTS.ARC_TESTNET_USDC,
    balanceBefore: '0',
    attestationMessage: MESSAGE,
    attestationSignature: ATTESTATION,
    createdAt: 1000,
    updatedAt: 2000,
    ...override,
  };
}

function sourceReceipt(
  override: Partial<TransactionReceipt> = {},
): TransactionReceipt {
  return {
    status: 'success',
    transactionHash: SOURCE_HASH,
    logs: [
      {
        address: MANIFEST_CONSTANTS.CCTP_V2_TOKEN_MESSENGER,
        topics: encodeEventTopics({
          abi: [DEPOSIT_EVENT],
          eventName: 'DepositForBurn',
          args: {
            burnToken: MANIFEST_CONSTANTS.ARC_TESTNET_USDC,
            depositor: SENDER,
            minFinalityThreshold: MANIFEST_CONSTANTS.CCTP_STANDARD_FINALITY,
          },
        }),
        data: encodeAbiParameters(
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
            1_000_000n,
            bytes32Address(RECIPIENT),
            MANIFEST_CONSTANTS.ETH_SEPOLIA_CCTP_DOMAIN,
            bytes32Address(MANIFEST_CONSTANTS.CCTP_V2_TOKEN_MESSENGER),
            `0x${'0'.repeat(64)}`,
            0n,
            '0x',
          ],
        ),
      },
      {
        address: MANIFEST_CONSTANTS.CCTP_V2_MESSAGE_TRANSMITTER,
        topics: [MESSAGE_SENT_TOPIC],
        data: encodeAbiParameters([{ type: 'bytes' }], [MESSAGE]),
      },
    ],
    ...override,
  } as unknown as TransactionReceipt;
}

function sourceTransaction(
  override: Partial<SourceTransactionEvidence> = {},
): SourceTransactionEvidence {
  return {
    from: SENDER,
    to: MANIFEST_CONSTANTS.CCTP_V2_TOKEN_MESSENGER,
    input: encodeFunctionData({
      abi: DEPOSIT_ABI,
      functionName: 'depositForBurn',
      args: [
        1_000_000n,
        MANIFEST_CONSTANTS.ETH_SEPOLIA_CCTP_DOMAIN,
        bytes32Address(RECIPIENT),
        MANIFEST_CONSTANTS.ARC_TESTNET_USDC,
        `0x${'0'.repeat(64)}`,
        0n,
        MANIFEST_CONSTANTS.CCTP_STANDARD_FINALITY,
      ],
    }),
    ...override,
  };
}

const circle = {
  messages: [{ status: 'complete', message: MESSAGE, attestation: ATTESTATION }],
};

describe('Phase 5 source attestation evidence before destination self-relay signature', () => {
  it('accepts only the exact successful burn and unique Circle message', () => {
    expect(() =>
      assertCctpSourceCheckpointAttestation(
        checkpoint(), sourceReceipt(), sourceTransaction(), circle,
      ),
    ).not.toThrow();
  });

  it('rejects forged tx hashes, reverted burns and substituted senders/contracts', () => {
    for (const receipt of [
      sourceReceipt({ status: 'reverted' }),
      sourceReceipt({ transactionHash: `0x${'c'.repeat(64)}` }),
    ]) {
      expect(() =>
        assertCctpSourceCheckpointAttestation(checkpoint(), receipt, sourceTransaction(), circle),
      ).toThrow(/owned source burn hash, sender, status/i);
    }
    for (const tx of [
      sourceTransaction({ from: RECIPIENT }),
      sourceTransaction({ to: RECIPIENT }),
    ]) {
      expect(() =>
        assertCctpSourceCheckpointAttestation(checkpoint(), sourceReceipt(), tx, circle),
      ).toThrow(/owned source burn hash, sender, status/i);
    }
  });

  it('rejects noncanonical route metadata and source calldata substitutions', () => {
    for (const state of [
      checkpoint({ sourceChainId: 11155111 }),
      checkpoint({ destinationChainId: 8453 }),
      checkpoint({ stage: 'SOURCE_CONFIRMED' }),
      checkpoint({ tokenAddress: SENDER }),
    ]) {
      expect(() =>
        assertCctpSourceCheckpointAttestation(state, sourceReceipt(), sourceTransaction(), circle),
      ).toThrow(/attestation-ready canonical Arc/i);
    }
    const badCall = sourceTransaction({
      input: encodeFunctionData({
        abi: DEPOSIT_ABI,
        functionName: 'depositForBurn',
        args: [
          2_000_000n,
          MANIFEST_CONSTANTS.ETH_SEPOLIA_CCTP_DOMAIN,
          bytes32Address(RECIPIENT),
          MANIFEST_CONSTANTS.ARC_TESTNET_USDC,
          `0x${'0'.repeat(64)}`,
          0n,
          MANIFEST_CONSTANTS.CCTP_STANDARD_FINALITY,
        ],
      }),
    });
    expect(() =>
      assertCctpSourceCheckpointAttestation(
        checkpoint(), sourceReceipt(), badCall, circle,
      ),
    ).toThrow(/calldata is not bound/i);
  });

  it('rejects Circle/source message mismatches and multiple Circle messages', () => {
    for (const response of [
      { messages: [{ status: 'complete', message: '0x55667788', attestation: ATTESTATION }] },
      { messages: [{ status: 'complete', message: MESSAGE, attestation: '0xbbcc' }] },
      { messages: [circle.messages[0], circle.messages[0]] },
      { messages: [{ status: 'pending' }] },
    ]) {
      expect(() =>
        assertCctpSourceCheckpointAttestation(
          checkpoint(), sourceReceipt(), sourceTransaction(), response,
        ),
      ).toThrow(/Circle|attestation/i);
    }
  });

  it('rejects multiple canonical source MessageSent logs', () => {
    const receipt = sourceReceipt();
    const multiple = {
      ...receipt,
      logs: [...receipt.logs, receipt.logs[1]],
    };
    expect(() =>
      assertCctpSourceCheckpointAttestation(
        checkpoint(), multiple, sourceTransaction(), circle,
      ),
    ).toThrow(/exactly one valid MessageSent/i);
  });
});
