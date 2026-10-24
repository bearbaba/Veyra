import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { toEventSelector } from 'viem';
import type { VeyraReceipt } from '../core/receipt/receiptTypes';
import {
  canReconcilePendingPay, receiptBelongsToWallet, reconcilePendingPayReceipt,
} from '../core/receipt/payReceiptReconciliation';

const FROM = '0x1111111111111111111111111111111111111111';
const OTHER = '0x3333333333333333333333333333333333333333';
const TO = '0x2222222222222222222222222222222222222222';
const TOKEN = '0x3600000000000000000000000000000000000000';
const HASH = `0x${'a'.repeat(64)}`;
const transferLog = {
  address: TOKEN,
  topics: [
    toEventSelector('Transfer(address,address,uint256)'),
    `0x${FROM.slice(2).padStart(64, '0')}`,
    `0x${TO.slice(2).padStart(64, '0')}`,
  ],
  data: `0x${(1000000n).toString(16).padStart(64, '0')}`,
};
function pending(): VeyraReceipt {
  return {
    receiptId: 'veyra-test', planId: 'plan', actionType: 'TRANSFER',
    status: 'PENDING', chainId: 5042002, executionTxHash: HASH,
    ownerAddress: FROM, recipientAddress: TO, tokenAddress: TOKEN,
    tokenDecimals: 6, tokenSymbol: 'USDC',
    createdAt: 1, actualAmountDelta: null, expectedAmountDelta: 1000000n,
    policyDecision: null, riskScore: null,
  };
}
const confirmed = {
  transactionHash: HASH, status: 'success' as const,
  logs: [transferLog], blockNumber: 125n,
};

describe('wallet-scoped Veyra Pay receipts recover without another signing', () => {
  it('hides legacy records and other wallets, including capitalization changes', () => {
    expect(receiptBelongsToWallet(pending(), FROM.toLowerCase())).toBe(true);
    expect(receiptBelongsToWallet(pending(), FROM.toUpperCase().replace('0X', '0x'))).toBe(true);
    expect(receiptBelongsToWallet(pending(), OTHER)).toBe(false);
    expect(receiptBelongsToWallet({ ...pending(), ownerAddress: undefined }, FROM)).toBe(false);
    expect(receiptBelongsToWallet(pending(), undefined)).toBe(false);
  });
  it('rejects incomplete or unbound recovery metadata before any RPC read', async () => {
    const read = vi.fn(() => Promise.resolve(confirmed));
    for (const mutation of [
      { ownerAddress: undefined }, { recipientAddress: undefined },
      { tokenAddress: undefined }, { executionTxHash: '0x123' },
      { expectedAmountDelta: 0n }, { chainId: 1 }, { actionType: 'BRIDGE' as const },
    ]) {
      const record = { ...pending(), ...mutation };
      expect(canReconcilePendingPay(record)).toBe(false);
      expect(await reconcilePendingPayReceipt(record, read)).toBe(record);
    }
    expect(read).not.toHaveBeenCalled();
  });
  it('verifies an exact transaction Transfer even with unrelated balance changes', async () => {
    const recovered = await reconcilePendingPayReceipt(pending(), () => Promise.resolve(confirmed));
    expect(recovered).toMatchObject({ status: 'VERIFIED', executionBlock: 125, actualAmountDelta: 1000000n });
    expect(recovered.completedAt).toBeGreaterThan(0);
  });
  it('reports on-chain revert as failed, not a successful payment', async () => {
    const recovered = await reconcilePendingPayReceipt(pending(), () => Promise.resolve({ ...confirmed, status: 'reverted' as const, logs: [] }));
    expect(recovered.status).toBe('FAILED');
    expect(recovered.actualAmountDelta).toBeNull();
  });
  it('never labels mismatched token, amount, sender, recipient or tx hash as VERIFIED', async () => {
    const variants = [
      { ...confirmed, transactionHash: `0x${'b'.repeat(64)}` },
      { ...confirmed, logs: [] },
      { ...confirmed, logs: [{ ...transferLog, address: OTHER }] },
      { ...confirmed, logs: [{ ...transferLog, data: '0x' + (1n).toString(16).padStart(64, '0') }] },
      { ...confirmed, logs: [{ ...transferLog, topics: [transferLog.topics[0], transferLog.topics[1], `0x${OTHER.slice(2).padStart(64, '0')}`] }] },
    ];
    for (const chain of variants) {
      const record = await reconcilePendingPayReceipt(pending(), () => Promise.resolve(chain));
      expect(record.status).toBe('PENDING');
      expect(record.displaySummary).toMatch(/review|delayed/i);
    }
  });
  it('propagates temporary RPC errors without declaring failure or attempting resubmission', async () => {
    await expect(reconcilePendingPayReceipt(pending(), () => Promise.reject(new Error('RPC unavailable'))))
      .rejects.toThrow('RPC unavailable');
    const hook = readFileSync(new URL('../hooks/useReceiptStore.ts', import.meta.url), 'utf8');
    expect(hook).toContain('getTransactionReceipt({ hash })');
    expect(hook).not.toContain('writeContractAsync');
    expect(hook).not.toContain('sendTransaction');
    expect(hook).toContain('receiptBelongsToWallet(receipt, walletKey)');
  });
  it('does not classify committed on-chain Pay as PENDING if local persistence fails', () => {
    const hook = readFileSync(new URL('../hooks/useTransferExecution.ts', import.meta.url), 'utf8');
    expect(hook).toContain("step: 'DONE', receipt: veyraReceipt, error: persistenceWarning");
    expect(hook).not.toContain('verifyExactTokenDelta(');
    expect(hook).toContain('actualAmountDelta: transferEvidence.transferAmount');
    expect(hook).toContain('ownerAddress: action.from');
  });
});
