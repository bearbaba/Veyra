import { describe, expect, it } from 'vitest';
import {
  verifyErc20TransferReceiptEvidence,
  verifyExactTokenDelta,
  verifyMinimumOutput,
} from '../core/execution/receiptVerification';

describe('Phase 4C deterministic receipt verification', () => {
  it('verifies an exact recipient token balance delta', () => {
    const result = verifyExactTokenDelta(10_000_000n, 11_000_000n, 1_000_000n);
    expect(result.verified).toBe(true);
    expect(result.actualDelta).toBe(1_000_000n);
  });

  it('fails closed when the observed delta does not match the reviewed amount', () => {
    const result = verifyExactTokenDelta(10_000_000n, 10_900_000n, 1_000_000n);
    expect(result.verified).toBe(false);
    expect(result.actualDelta).toBe(900_000n);
  });

  it('binds an ERC20 receipt to the exact reviewed sender recipient and amount', () => {
    const token = '0x3600000000000000000000000000000000000000';
    const from = '0x1111111111111111111111111111111111111111';
    const to = '0x2222222222222222222222222222222222222222';
    const topic = (address: string) =>
      `0x${'0'.repeat(24)}${address.slice(2).toLowerCase()}`;

    const result = verifyErc20TransferReceiptEvidence({
      receipt: {
        status: 'success',
        logs: [
          {
            address: token,
            topics: [
              '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
              topic(from),
              topic(to),
            ],
            data: `0x${1_000_000n.toString(16).padStart(64, '0')}`,
          },
        ],
      },
      tokenAddress: token,
      from,
      to,
      amount: 1_000_000n,
    });

    expect(result.verified).toBe(true);
    expect(result.transferAmount).toBe(1_000_000n);
  });

  it('rejects an otherwise successful receipt with a different transfer recipient', () => {
    const token = '0x3600000000000000000000000000000000000000';
    const from = '0x1111111111111111111111111111111111111111';
    const actualTo = '0x3333333333333333333333333333333333333333';
    const reviewedTo = '0x2222222222222222222222222222222222222222';
    const topic = (address: string) =>
      `0x${'0'.repeat(24)}${address.slice(2).toLowerCase()}`;

    const result = verifyErc20TransferReceiptEvidence({
      receipt: {
        status: 'success',
        logs: [
          {
            address: token,
            topics: [
              '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
              topic(from),
              topic(actualTo),
            ],
            data: `0x${1_000_000n.toString(16).padStart(64, '0')}`,
          },
        ],
      },
      tokenAddress: token,
      from,
      to: reviewedTo,
      amount: 1_000_000n,
    });

    expect(result.verified).toBe(false);
  });

  it('accepts final convert output at or above the reviewed minimum', () => {
    expect(verifyMinimumOutput(1_005_000n, 1_000_000n).verified).toBe(true);
    expect(verifyMinimumOutput(1_000_000n, 1_000_000n).verified).toBe(true);
  });

  it('rejects final convert output below the reviewed minimum', () => {
    expect(verifyMinimumOutput(999_999n, 1_000_000n).verified).toBe(false);
  });
});
