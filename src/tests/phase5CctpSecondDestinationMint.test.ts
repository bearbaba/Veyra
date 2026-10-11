import { describe, expect, it, vi } from 'vitest';
import {
  encodeFunctionData,
  parseAbi,
  type TransactionReceipt,
} from 'viem';
import {
  verifySecondCctpDestinationMint,
} from '../../server/services/cctpSecondDestinationVerificationService.js';
import type { BridgeRecoveryInput } from '../../server/db/repositories/bridgeRecoveryRepository.js';
import { MANIFEST_CONSTANTS } from '../providers/registry/providerManifest';

const FIRST_TX = `0x${'1'.repeat(64)}` as const;
const SECOND_TX = `0x${'2'.repeat(64)}` as const;
const BLOCK = `0x${'b'.repeat(64)}` as const;
const SENDER = '0x1111111111111111111111111111111111111111';
const RECIPIENT = '0x2222222222222222222222222222222222222222';
const TRANSFER_TOPIC =
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const RECEIVE_ABI = parseAbi([
  'function receiveMessage(bytes message, bytes attestation) returns (bool success)',
]);

function checkpoint(changes: Partial<BridgeRecoveryInput> = {}): BridgeRecoveryInput {
  return {
    planId: 'second-mint-proof',
    stage: 'DESTINATION_BROADCAST',
    burnTxHash: `0x${'a'.repeat(64)}`,
    sourceChainId: MANIFEST_CONSTANTS.ARC_TESTNET_CHAIN_ID,
    destinationChainId: MANIFEST_CONSTANTS.ETH_SEPOLIA_CHAIN_ID,
    walletAddress: SENDER,
    recipientAddress: RECIPIENT,
    amount: '1000000',
    tokenAddress: MANIFEST_CONSTANTS.ARC_TESTNET_USDC,
    balanceBefore: '0',
    attestationMessage: '0x1234',
    attestationSignature: '0xabcd',
    receiveTxHash: FIRST_TX,
    createdAt: 1000,
    updatedAt: 2000,
    ...changes,
  };
}

function mintLog(
  recipient: string = RECIPIENT,
  amount = 1_000_000n,
) {
  return {
    address: MANIFEST_CONSTANTS.ETH_SEPOLIA_USDC,
    topics: [
      TRANSFER_TOPIC,
      `0x${'0'.repeat(64)}`,
      `0x${'0'.repeat(24)}${recipient.slice(2)}`,
    ],
    data: `0x${amount.toString(16).padStart(64, '0')}`,
  };
}

function receipt(changes: Partial<TransactionReceipt> = {}): TransactionReceipt {
  return {
    status: 'success',
    transactionHash: SECOND_TX,
    blockNumber: 100n,
    blockHash: BLOCK,
    logs: [mintLog()],
    ...changes,
  } as unknown as TransactionReceipt;
}

function calldata(message: `0x${string}` = '0x1234', attestation: `0x${string}` = '0xabcd') {
  return encodeFunctionData({
    abi: RECEIVE_ABI,
    functionName: 'receiveMessage',
    args: [message, attestation],
  });
}

function checker(input: {
  current?: BridgeRecoveryInput;
  tx?: string;
  chainReceipt?: TransactionReceipt;
  to?: string | null;
  data?: `0x${string}`;
  canonicalHash?: `0x${string}` | null;
  head?: bigint;
} = {}) {
  const getReceipt = vi.fn(() => Promise.resolve(input.chainReceipt ?? receipt()));
  const getTx = vi.fn(() => Promise.resolve({
    to: input.to === undefined
      ? MANIFEST_CONSTANTS.CCTP_V2_MESSAGE_TRANSMITTER
      : input.to,
    input: input.data ?? calldata(),
  }));
  const getHash = vi.fn(() => Promise.resolve(
    input.canonicalHash === undefined ? BLOCK : input.canonicalHash,
  ));
  const getHead = vi.fn(() => Promise.resolve(input.head ?? 111n));
  return {
    proof: verifySecondCctpDestinationMint(
      input.current ?? checkpoint(),
      input.tx ?? SECOND_TX,
      getReceipt,
      getTx,
      getHash,
      getHead,
    ),
    getReceipt,
    getTx,
    getHash,
  };
}

describe('Phase 5 second CCTP receive canonical mint proof', () => {
  it('verifies distinct second tx with exact canonical mint, Circle calldata and 12 confirmations', async () => {
    const result = checker();
    await expect(result.proof).resolves.toEqual({
      receiveTxHash: SECOND_TX,
      destinationChainId: MANIFEST_CONSTANTS.ETH_SEPOLIA_CHAIN_ID,
      destinationBlockNumber: 100,
      destinationBlockHash: BLOCK,
      mintToken: MANIFEST_CONSTANTS.ETH_SEPOLIA_USDC.toLowerCase(),
      mintRecipient: RECIPIENT.toLowerCase(),
      mintAmountRaw: '1000000',
      confirmations: 12,
    });
    expect(result.getReceipt).toHaveBeenCalledWith(SECOND_TX);
    expect(result.getTx).toHaveBeenCalledWith(SECOND_TX);
    expect(result.getHash).toHaveBeenCalledWith(100n);
  });

  it('rejects reverted, wrong hash and unknown-block successful receipts', async () => {
    for (const chainReceipt of [
      receipt({ status: 'reverted' }),
      receipt({ transactionHash: FIRST_TX }),
      receipt({ blockNumber: -1n }),
    ]) {
      await expect(checker({ chainReceipt }).proof).rejects
        .toThrow(/not proven successful/i);
    }
  });

  it('refuses same first/second tx, wrong chain, missing attestation or premature stage', async () => {
    for (const input of [
      { tx: FIRST_TX },
      { current: checkpoint({ destinationChainId: 8453 }) },
      { current: checkpoint({ stage: 'SOURCE_CONFIRMED' }) },
      { current: checkpoint({ attestationSignature: undefined }) },
      { current: checkpoint({ receiveTxHash: undefined }) },
    ]) {
      await expect(checker(input).proof).rejects
        .toThrow(/distinct recorded retry hash and original attestation/i);
    }
  });

  it('rejects incorrect transmitter contract, message or Circle signature', async () => {
    for (const input of [
      { to: SENDER },
      { to: null },
      { data: calldata('0x8888') },
      { data: calldata('0x1234', '0x9999') },
      { data: '0xdeadbeef' as const },
    ]) {
      await expect(checker(input).proof).rejects
        .toThrow(/canonical CCTP|exact original message|valid CCTP receiveMessage/i);
    }
  });

  it('rejects wrong amount, wrong recipient, missing mint and duplicate mint', async () => {
    for (const chainReceipt of [
      receipt({ logs: [mintLog(RECIPIENT, 999_999n)] as unknown as TransactionReceipt['logs'] }),
      receipt({ logs: [mintLog(SENDER)] as unknown as TransactionReceipt['logs'] }),
      receipt({ logs: [] }),
      receipt({ logs: [mintLog(), mintLog()] as unknown as TransactionReceipt['logs'] }),
    ]) {
      await expect(checker({ chainReceipt }).proof).rejects
        .toThrow(/canonical USDC mint|exactly one reviewed USDC mint/i);
    }
  });

  it('rejects reorg, under-finality and RPC proof failures', async () => {
    for (const input of [
      { canonicalHash: null },
      { canonicalHash: `0x${'c'.repeat(64)}` as const },
      { head: 110n },
      { head: 99n },
    ]) {
      await expect(checker(input).proof).rejects
        .toThrow(/canonical block with 12 confirmations/i);
    }
  });
});
