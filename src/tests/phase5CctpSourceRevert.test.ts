import { describe, expect, it, vi } from 'vitest';
import {
  encodeFunctionData,
  parseAbi,
  type TransactionReceipt,
} from 'viem';
import { MANIFEST_CONSTANTS } from '../providers/registry/providerManifest';
import {
  verifyRevertedCctpSourceEvidence,
  type CctpSourceRevertContext,
} from '../../server/services/activityReceiptVerificationService.js';
import {
  assertCctpSourceRevertFinalizable,
  type VerifiedCctpSourceRevert,
} from '../../server/db/repositories/receiptRepository.js';

const SOURCE_TX = `0x${'a'.repeat(64)}` as const;
const BLOCK_HASH = `0x${'b'.repeat(64)}` as const;
const SENDER = '0x1111111111111111111111111111111111111111';
const RECIPIENT = '0x2222222222222222222222222222222222222222';

const DEPOSIT_ABI = parseAbi([
  'function depositForBurn(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken, bytes32 destinationCaller, uint256 maxFee, uint32 minFinalityThreshold)',
]);

function calldata(amount = 1_000_000n) {
  return encodeFunctionData({
    abi: DEPOSIT_ABI,
    functionName: 'depositForBurn',
    args: [
      amount,
      MANIFEST_CONSTANTS.ETH_SEPOLIA_CCTP_DOMAIN,
      `0x${'0'.repeat(24)}${RECIPIENT.slice(2)}`,
      MANIFEST_CONSTANTS.ARC_TESTNET_USDC,
      `0x${'0'.repeat(64)}`,
      0n,
      MANIFEST_CONSTANTS.CCTP_STANDARD_FINALITY,
    ],
  });
}

function context(
  changes: Partial<CctpSourceRevertContext> = {},
): CctpSourceRevertContext {
  return {
    providerId: 'cctp-v2-bridge',
    action: 'BRIDGE',
    status: 'BROADCAST',
    senderAddress: SENDER,
    senderChainId: MANIFEST_CONSTANTS.ARC_TESTNET_CHAIN_ID,
    recipientAddress: RECIPIENT,
    recipientChainId: MANIFEST_CONSTANTS.ETH_SEPOLIA_CHAIN_ID,
    amountRaw: '1000000',
    tokenAddress: MANIFEST_CONSTANTS.ARC_TESTNET_USDC,
    burnTxHash: SOURCE_TX,
    burnChainId: MANIFEST_CONSTANTS.ARC_TESTNET_CHAIN_ID,
    burnBlockNumber: null,
    receiveTxHash: null,
    receiveChainId: null,
    receiveBlockNumber: null,
    ...changes,
  };
}

function revertedReceipt(
  changes: Partial<TransactionReceipt> = {},
): TransactionReceipt {
  return {
    status: 'reverted',
    transactionHash: SOURCE_TX,
    blockNumber: 100n,
    blockHash: BLOCK_HASH,
    logs: [],
    ...changes,
  } as TransactionReceipt;
}

function verifier(input: {
  current?: CctpSourceRevertContext;
  receipt?: TransactionReceipt;
  from?: string;
  to?: string;
  calldata?: `0x${string}`;
  canonicalHash?: `0x${string}` | null;
  head?: bigint;
} = {}) {
  const getReceipt = vi.fn(() => Promise.resolve(input.receipt ?? revertedReceipt()));
  const getTx = vi.fn(() => Promise.resolve({
    from: input.from ?? SENDER,
    to: input.to ?? MANIFEST_CONSTANTS.CCTP_V2_TOKEN_MESSENGER,
    input: input.calldata ?? calldata(),
  }));
  const getBlockHash = vi.fn(() => Promise.resolve(
    input.canonicalHash === undefined ? BLOCK_HASH : input.canonicalHash,
  ));
  const getHead = vi.fn(() => Promise.resolve(input.head ?? 111n));

  return {
    proof: verifyRevertedCctpSourceEvidence(
      input.current ?? context(),
      getReceipt,
      getTx,
      getBlockHash,
      getHead,
    ),
    getReceipt,
    getTx,
    getBlockHash,
    getHead,
  };
}

describe('Phase 5 canonical CCTP source revert finalization', () => {
  it('proves an exact reverted source call in a canonical block with 12 confirmations', async () => {
    const request = verifier();
    await expect(request.proof).resolves.toMatchObject({
      burnTxHash: SOURCE_TX,
      sourceBlockNumber: 100,
      sourceBlockHash: BLOCK_HASH,
      confirmations: 12,
    });
    expect(request.getReceipt).toHaveBeenCalledWith(SOURCE_TX);
    expect(request.getTx).toHaveBeenCalledWith(SOURCE_TX);
    expect(request.getBlockHash).toHaveBeenCalledWith(100n);
  });

  it('rejects successful and mismatched transaction receipts', async () => {
    for (const receipt of [
      revertedReceipt({ status: 'success' }),
      revertedReceipt({ transactionHash: `0x${'c'.repeat(64)}` }),
      revertedReceipt({ blockNumber: 101n }),
    ]) {
      await expect(verifier({ receipt, current: context({ burnBlockNumber: 100 }) }).proof)
        .rejects.toMatchObject({ code: 'SOURCE_REVERT_UNVERIFIED' });
    }
  });

  it('rejects wrong wallet, contract, or reviewed calldata', async () => {
    for (const changes of [
      { from: '0x3333333333333333333333333333333333333333' },
      { to: '0x4444444444444444444444444444444444444444' },
      { calldata: calldata(2_000_000n) },
      { calldata: '0xdeadbeef' as const },
    ]) {
      await expect(verifier(changes).proof).rejects.toMatchObject({
        code: 'SOURCE_REVERT_CALL_MISMATCH',
      });
    }
  });

  it('rejects unconfirmed and noncanonical blocks', async () => {
    await expect(verifier({ head: 110n }).proof)
      .rejects.toMatchObject({ code: 'SOURCE_REVERT_NOT_FINAL' });
    await expect(verifier({ canonicalHash: `0x${'c'.repeat(64)}` }).proof)
      .rejects.toMatchObject({ code: 'SOURCE_REVERT_NOT_FINAL' });
  });

  it('never resolves a source burn after destination evidence or source confirmation exists', async () => {
    for (const changes of [
      { status: 'SOURCE_CONFIRMED' as const },
      { status: 'COMPLETE' as const },
      { receiveTxHash: `0x${'c'.repeat(64)}` },
      { burnChainId: 11155111 },
    ]) {
      await expect(verifier({ current: context(changes) }).proof)
        .rejects.toMatchObject({ code: 'SOURCE_REVERT_NOT_ELIGIBLE' });
    }
  });

  it('rejects races and stale source-revert proofs at the repository gate', () => {
    const receipt: Parameters<typeof assertCctpSourceRevertFinalizable>[0] = {
      status: 'BROADCAST',
      providerId: 'cctp-v2-bridge',
      action: 'BRIDGE',
      senderChainId: MANIFEST_CONSTANTS.ARC_TESTNET_CHAIN_ID,
      burnTxHash: SOURCE_TX,
      burnChainId: MANIFEST_CONSTANTS.ARC_TESTNET_CHAIN_ID,
      burnBlockNumber: null,
      receiveTxHash: null,
      receiveChainId: null,
      receiveBlockNumber: null,
    };
    const proof: VerifiedCctpSourceRevert = {
      burnTxHash: SOURCE_TX,
      sourceBlockNumber: 100,
      sourceBlockHash: BLOCK_HASH,
      confirmations: 12,
    };
    expect(() => assertCctpSourceRevertFinalizable(receipt, proof)).not.toThrow();
    expect(() => assertCctpSourceRevertFinalizable(
      { ...receipt, status: 'SOURCE_CONFIRMED' },
      proof,
    )).toThrow(/Only the exact unreconciled/);
    expect(() => assertCctpSourceRevertFinalizable(
      { ...receipt, receiveTxHash: `0x${'c'.repeat(64)}` },
      proof,
    )).toThrow(/Only the exact unreconciled/);
    expect(() => assertCctpSourceRevertFinalizable(
      receipt,
      { ...proof, burnTxHash: `0x${'c'.repeat(64)}` },
    )).toThrow(/Only the exact unreconciled/);
    expect(() => assertCctpSourceRevertFinalizable(
      receipt,
      { ...proof, confirmations: 11 },
    )).toThrow(/at least 12 confirmations/);
  });
});
