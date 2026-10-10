import type { PublicClient } from 'viem';
import type { VeyraReceipt } from '../receipt/receiptTypes';
import { verifyErc20TransferReceiptEvidence } from './receiptVerification';

const ERC20_BALANCE_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

export type TransferRecoveryResult =
  | { status: 'PENDING'; receipt: VeyraReceipt; detail: string }
  | { status: 'VERIFIED'; receipt: VeyraReceipt; detail: string }
  | { status: 'FAILED'; receipt: VeyraReceipt; detail: string };

function failure(
  receipt: VeyraReceipt,
  detail: string,
): TransferRecoveryResult {
  return {
    status: 'FAILED',
    detail,
    receipt: {
      ...receipt,
      status: 'FAILED',
      completedAt: Date.now(),
      displaySummary: `Transfer verification failed: ${detail}`,
    },
  };
}

export async function recoverPendingTransferReceipt(
  publicClient: PublicClient,
  receipt: VeyraReceipt,
): Promise<TransferRecoveryResult> {
  if (
    receipt.actionType !== 'TRANSFER' ||
    receipt.status !== 'PENDING' ||
    !receipt.executionTxHash ||
    !receipt.transferTrace
  ) {
    return {
      status: 'PENDING',
      receipt,
      detail: 'Receipt does not contain a resumable pending transfer.',
    };
  }

  const trace = receipt.transferTrace;
  const amount = BigInt(trace.amountRaw);
  if (amount <= 0n) {
    return failure(receipt, 'Persisted transfer amount is invalid.');
  }

  let txReceipt;
  try {
    txReceipt = await publicClient.getTransactionReceipt({
      hash: receipt.executionTxHash as `0x${string}`,
    });
  } catch {
    return {
      status: 'PENDING',
      receipt,
      detail: 'Transaction is still pending or not yet indexed.',
    };
  }

  if (txReceipt.status !== 'success') {
    return failure(receipt, 'Transaction reverted on-chain.');
  }

  const evidence = verifyErc20TransferReceiptEvidence({
    receipt: txReceipt,
    tokenAddress: trace.tokenAddress,
    from: trace.fromAddress,
    to: trace.recipientAddress,
    amount,
  });
  if (!evidence.verified || evidence.transferAmount === null) {
    return failure(receipt, evidence.detail);
  }

  let verifiedBalanceAfter: bigint | undefined;
  try {
    verifiedBalanceAfter = await publicClient.readContract({
      address: trace.tokenAddress as `0x${string}`,
      abi: ERC20_BALANCE_ABI,
      functionName: 'balanceOf',
      args: [trace.recipientAddress as `0x${string}`],
    });
  } catch {
    // Exact canonical Transfer evidence in the successful receipt is
    // authoritative. Balance read is supplementary post-state metadata.
  }

  return {
    status: 'VERIFIED',
    detail: evidence.detail,
    receipt: {
      ...receipt,
      status: 'VERIFIED',
      executionBlock: Number(txReceipt.blockNumber),
      completedAt: Date.now(),
      actualAmountDelta: evidence.transferAmount,
      expectedAmountDelta: amount,
      ...(verifiedBalanceAfter !== undefined
        ? { verifiedBalanceAfter }
        : {}),
      displaySummary:
        receipt.displaySummary ??
        `Transfer verified to ${trace.recipientAddress.slice(0, 6)}...${trace.recipientAddress.slice(-4)}`,
    },
  };
}
