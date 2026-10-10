import { describe, expect, it, vi } from 'vitest';
import type { PublicClient } from 'viem';
import type { VeyraReceipt } from '../core/receipt/receiptTypes';
import { recoverPendingTransferReceipt } from '../core/execution/transferRecovery';

const TOKEN = '0x3600000000000000000000000000000000000000';
const FROM = '0x1111111111111111111111111111111111111111';
const TO = '0x2222222222222222222222222222222222222222';
const HASH =
  '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const TRANSFER_TOPIC =
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

function topic(address: string): `0x${string}` {
  return `0x${'0'.repeat(24)}${address.slice(2).toLowerCase()}`;
}

function uint256Data(value: bigint): `0x${string}` {
  return `0x${value.toString(16).padStart(64, '0')}`;
}

function pendingReceipt(): VeyraReceipt {
  return {
    receiptId: 'veyra-test-transfer',
    planId: '550e8400-e29b-41d4-a716-446655440000',
    actionType: 'TRANSFER',
    status: 'PENDING',
    chainId: 5042002,
    executionTxHash: HASH,
    createdAt: 1,
    actualAmountDelta: null,
    expectedAmountDelta: 1_000_000n,
    riskScore: null,
    policyDecision: null,
    transferTrace: {
      providerId: 'arc-erc20-transfer',
      tokenAddress: TOKEN,
      tokenDecimals: 6,
      fromAddress: FROM,
      recipientAddress: TO,
      amountRaw: '1000000',
      balanceBeforeRaw: '10000000',
    },
  };
}

describe('Phase 5 durable transfer recovery', () => {
  it('keeps a submitted transfer pending while the transaction is not indexed', async () => {
    const client = {
      getTransactionReceipt: vi.fn().mockRejectedValue(new Error('not found')),
    } as unknown as PublicClient;

    const result = await recoverPendingTransferReceipt(client, pendingReceipt());
    expect(result.status).toBe('PENDING');
    expect(result.receipt.status).toBe('PENDING');
  });

  it('verifies an exact canonical ERC20 Transfer event after reload', async () => {
    const client = {
      getTransactionReceipt: vi.fn().mockResolvedValue({
        status: 'success',
        blockNumber: 123n,
        logs: [
          {
            address: TOKEN,
            topics: [TRANSFER_TOPIC, topic(FROM), topic(TO)],
            data: uint256Data(1_000_000n),
          },
        ],
      }),
      // The balance can include unrelated activity. Exact transaction receipt
      // evidence is the authoritative binding for this recovery.
      readContract: vi.fn().mockResolvedValue(77_000_000n),
    } as unknown as PublicClient;

    const result = await recoverPendingTransferReceipt(client, pendingReceipt());
    expect(result.status).toBe('VERIFIED');
    expect(result.receipt.status).toBe('VERIFIED');
    expect(result.receipt.executionBlock).toBe(123);
    expect(result.receipt.actualAmountDelta).toBe(1_000_000n);
    expect(result.receipt.verifiedBalanceAfter).toBe(77_000_000n);
  });

  it('marks an on-chain revert as a final failed receipt', async () => {
    const client = {
      getTransactionReceipt: vi.fn().mockResolvedValue({
        status: 'reverted',
        blockNumber: 123n,
        logs: [],
      }),
    } as unknown as PublicClient;

    const result = await recoverPendingTransferReceipt(client, pendingReceipt());
    expect(result.status).toBe('FAILED');
    expect(result.receipt.status).toBe('FAILED');
  });

  it('fails closed when the successful transaction lacks the reviewed transfer event', async () => {
    const client = {
      getTransactionReceipt: vi.fn().mockResolvedValue({
        status: 'success',
        blockNumber: 123n,
        logs: [
          {
            address: TOKEN,
            topics: [
              TRANSFER_TOPIC,
              topic(FROM),
              topic('0x3333333333333333333333333333333333333333'),
            ],
            data: uint256Data(1_000_000n),
          },
        ],
      }),
    } as unknown as PublicClient;

    const result = await recoverPendingTransferReceipt(client, pendingReceipt());
    expect(result.status).toBe('FAILED');
    expect(result.receipt.status).toBe('FAILED');
  });
});
