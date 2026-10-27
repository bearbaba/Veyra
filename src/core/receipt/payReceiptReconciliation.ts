/**
 * Reconciliation of local Pay receipts from authoritative chain evidence.
 * This NEVER signs, broadcasts, retries or changes a receipt belonging to
 * another wallet. A missing/mismatched receipt is NOT evidence of a failed pay.
 */
import type { VeyraReceipt } from './receiptTypes';
import {
  verifyErc20TransferReceiptEvidence,
  type Erc20TransferReceiptEvidence,
} from '../execution/receiptVerification';

const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export function receiptBelongsToWallet(receipt: VeyraReceipt, wallet: string | undefined): boolean {
  // Legacy receipts lack owner binding. They must not leak into another
  // connected wallet's personal Activity view.
  return Boolean(wallet && ADDRESS_RE.test(wallet) &&
    receipt.ownerAddress && receipt.ownerAddress.toLowerCase() === wallet.toLowerCase());
}

export function canReconcilePendingPay(receipt: VeyraReceipt): boolean {
  return receipt.actionType === 'TRANSFER' && receipt.status === 'PENDING' &&
    receipt.chainId === 5042002 &&
    Boolean(receipt.executionTxHash && TX_HASH_RE.test(receipt.executionTxHash)) &&
    Boolean(receipt.ownerAddress && ADDRESS_RE.test(receipt.ownerAddress)) &&
    Boolean(receipt.recipientAddress && ADDRESS_RE.test(receipt.recipientAddress)) &&
    Boolean(receipt.tokenAddress && ADDRESS_RE.test(receipt.tokenAddress)) &&
    receipt.expectedAmountDelta != null && receipt.expectedAmountDelta > 0n;
}

export const ARC_PAY_REQUIRED_CONFIRMATIONS = 12n;
const BLOCK_HASH_RE = /^0x[0-9a-fA-F]{64}$/;

export type PayChainReceipt = Erc20TransferReceiptEvidence & {
  transactionHash: string;
  blockNumber: bigint;
  blockHash: string;
};

/** Confirm inclusion depth and that the block at that height is canonical. */
export function hasCanonicalPayFinality(
  receipt: PayChainReceipt,
  headBlockNumber: bigint,
  blockHashAtHeight: string,
): boolean {
  return receipt.blockNumber >= 0n &&
    headBlockNumber >= receipt.blockNumber &&
    headBlockNumber - receipt.blockNumber + 1n >= ARC_PAY_REQUIRED_CONFIRMATIONS &&
    BLOCK_HASH_RE.test(receipt.blockHash) &&
    BLOCK_HASH_RE.test(blockHashAtHeight) &&
    receipt.blockHash.toLowerCase() === blockHashAtHeight.toLowerCase();
}

/**
 * Only a confirmed revert proves failure. A successful receipt needs the
 * exact (contract, from, to, amount) Transfer event to prove this payment.
 * Unavailable RPC or mismatched evidence must remain unresolved, not FAILED.
 */
export async function reconcilePendingPayReceipt(
  receipt: VeyraReceipt,
  readReceipt: (hash: `0x${string}`) => Promise<PayChainReceipt>,
  hasFinality: (receipt: PayChainReceipt) => Promise<boolean>,
): Promise<VeyraReceipt> {
  if (!canReconcilePendingPay(receipt)) return receipt;
  const txHash = receipt.executionTxHash as `0x${string}`;
  const chainReceipt = await readReceipt(txHash); // RPC error: caller keeps PENDING.
  if (chainReceipt.transactionHash.toLowerCase() !== txHash.toLowerCase()) {
    return { ...receipt, displaySummary: 'RPC returned mismatched transaction evidence. Verification delayed; do not resend.' };
  }
  // A receipt seen in a single block is not final. Both success and revert
  // require canonical 12-block settlement, matching Arc Testnet's Pay drill.
  // A reorg, stale endpoint or temporary RPC error must never create finality.
  if (!await hasFinality(chainReceipt)) {
    return {
      ...receipt,
      displaySummary: 'Transaction is indexed but final confirmation is pending. Do not resend.',
    };
  }
  if (chainReceipt.status === 'reverted') {
    return {
      ...receipt, status: 'FAILED', executionBlock: Number(chainReceipt.blockNumber),
      completedAt: Date.now(), actualAmountDelta: null,
      displaySummary: 'This transaction reverted on Arc Testnet. No successful token transfer was confirmed.',
    };
  }
  const evidence = verifyErc20TransferReceiptEvidence({
    receipt: chainReceipt,
    tokenAddress: receipt.tokenAddress!,
    from: receipt.ownerAddress!,
    to: receipt.recipientAddress!,
    amount: receipt.expectedAmountDelta!,
  });
  if (!evidence.verified) {
    return { ...receipt, displaySummary: 'Transaction mined, but exact USDC transfer evidence needs review. Do not resend.' };
  }
  return {
    ...receipt, status: 'VERIFIED', executionBlock: Number(chainReceipt.blockNumber),
    completedAt: Date.now(), actualAmountDelta: evidence.transferAmount,
    displaySummary: 'Payment verified against this transaction\'s USDC Transfer event on Arc Testnet.',
  };
}
