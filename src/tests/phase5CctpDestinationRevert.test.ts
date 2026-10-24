import { describe, expect, it, vi } from 'vitest';
import {
  encodeFunctionData,
  parseAbi,
  type TransactionReceipt,
} from 'viem';
import {
  verifyRevertedCctpDestinationReceive,
} from '../../server/services/cctpDestinationRevertVerificationService.js';
import {
  assertFirstDestinationRevertFinalizable,
} from '../../server/db/repositories/bridgeDestinationRevertRepository.js';
import type { BridgeRecoveryInput } from '../../server/db/repositories/bridgeRecoveryRepository.js';
import { MANIFEST_CONSTANTS } from '../providers/registry/providerManifest';

const TX = `0x${'a'.repeat(64)}` as const;
const BLOCK = `0x${'b'.repeat(64)}` as const;
const WALLET = '0x1111111111111111111111111111111111111111';
const RECEIVE_ABI = parseAbi([
  'function receiveMessage(bytes message, bytes attestation) returns (bool success)',
]);

function checkpoint(changes: Partial<BridgeRecoveryInput> = {}): BridgeRecoveryInput {
  return {
    planId: 'destination-revert-proof',
    stage: 'DESTINATION_BROADCAST',
    burnTxHash: `0x${'c'.repeat(64)}`,
    sourceChainId: MANIFEST_CONSTANTS.ARC_TESTNET_CHAIN_ID,
    destinationChainId: MANIFEST_CONSTANTS.ETH_SEPOLIA_CHAIN_ID,
    walletAddress: WALLET,
    recipientAddress: '0x2222222222222222222222222222222222222222',
    amount: '1000000',
    tokenAddress: MANIFEST_CONSTANTS.ARC_TESTNET_USDC,
    balanceBefore: '0',
    attestationMessage: '0x1234',
    attestationSignature: '0xabcd',
    receiveTxHash: TX,
    createdAt: 1000,
    updatedAt: 1001,
    ...changes,
  };
}

function revertedReceipt(changes: Partial<TransactionReceipt> = {}): TransactionReceipt {
  return {
    status: 'reverted',
    transactionHash: TX,
    blockNumber: 100n,
    blockHash: BLOCK,
    logs: [],
    ...changes,
  } as TransactionReceipt;
}

function callData(
  message: `0x${string}` = '0x1234',
  attestation: `0x${string}` = '0xabcd',
) {
  return encodeFunctionData({
    abi: RECEIVE_ABI,
    functionName: 'receiveMessage',
    args: [message, attestation],
  });
}

function verify(args: {
  current?: BridgeRecoveryInput;
  receipt?: TransactionReceipt;
  to?: string | null;
  calldata?: `0x${string}`;
  canonicalHash?: `0x${string}` | null;
  head?: bigint;
} = {}) {
  const getReceipt = vi.fn(() => Promise.resolve(args.receipt ?? revertedReceipt()));
  const getTransaction = vi.fn(() => Promise.resolve({
    to: args.to === undefined
      ? MANIFEST_CONSTANTS.CCTP_V2_MESSAGE_TRANSMITTER
      : args.to,
    input: args.calldata ?? callData(),
  }));
  const getHash = vi.fn(() => Promise.resolve(
    args.canonicalHash === undefined ? BLOCK : args.canonicalHash,
  ));
  const getHead = vi.fn(() => Promise.resolve(args.head ?? 111n));
  return {
    proof: verifyRevertedCctpDestinationReceive(
      args.current ?? checkpoint(), TX, getReceipt, getTransaction, getHash, getHead,
    ),
    getReceipt,
    getTransaction,
    getHash,
    getHead,
  };
}

describe('Phase 5 canonical first destination revert evidence', () => {
  it('accepts exactly matching reverted receiveMessage and 12 source-independent destination confirmations', async () => {
    const result = verify();
    await expect(result.proof).resolves.toMatchObject({
      receiveTxHash: TX,
      destinationChainId: MANIFEST_CONSTANTS.ETH_SEPOLIA_CHAIN_ID,
      destinationBlockNumber: 100,
      destinationBlockHash: BLOCK,
      confirmations: 12,
    });
    expect(result.getReceipt).toHaveBeenCalledWith(TX);
    expect(result.getTransaction).toHaveBeenCalledWith(TX);
    expect(result.getHash).toHaveBeenCalledWith(100n);
  });

  it('rejects successful, wrong-tx, and invalid-block receipt as non-reverted', async () => {
    for (const receipt of [
      revertedReceipt({ status: 'success' }),
      revertedReceipt({ transactionHash: `0x${'d'.repeat(64)}` }),
      revertedReceipt({ blockNumber: -1n }),
    ]) {
      await expect(verify({ receipt }).proof).rejects.toThrow(/not proven reverted/i);
    }
  });

  it('rejects wrong chain, missing first hash, and missing attestation', async () => {
    for (const current of [
      checkpoint({ stage: 'ATTESTATION_READY' }),
      checkpoint({ destinationChainId: 8453 }),
      checkpoint({ receiveTxHash: `0x${'e'.repeat(64)}` }),
      checkpoint({ receiveTxHash: undefined }),
      checkpoint({ attestationSignature: undefined }),
    ]) {
      await expect(verify({ current }).proof).rejects.toThrow(/first recorded destination receive/i);
    }
  });

  it('rejects unrelated contract, malformed calldata, and changed CCTP message', async () => {
    for (const args of [
      { to: WALLET },
      { to: null },
      { calldata: '0xdeadbeef' as const },
      { calldata: callData('0x9999') },
      { calldata: callData('0x1234', '0x9999') },
    ]) {
      await expect(verify(args).proof).rejects.toThrow(
        /canonical CCTP MessageTransmitterV2|valid CCTP receiveMessage|reviewed persisted CCTP attestation/i,
      );
    }
  });

  it('refuses block reorg, head behind receipt, and insufficient confirmations', async () => {
    for (const args of [
      { canonicalHash: `0x${'e'.repeat(64)}` as const },
      { canonicalHash: null },
      { head: 99n },
      { head: 110n },
    ]) {
      await expect(verify(args).proof).rejects.toThrow(/canonical block with 12 confirmations/i);
    }
  });

  it('rejects stale or different first destination claim under database row lock', () => {
    const receipt = {
      stage: 'DESTINATION_BROADCAST',
      receiveTxHash: TX,
      destinationChainId: MANIFEST_CONSTANTS.ETH_SEPOLIA_CHAIN_ID,
    };
    const claim = { receiveTxHash: TX };
    const proof = {
      receiveTxHash: TX,
      destinationChainId: MANIFEST_CONSTANTS.ETH_SEPOLIA_CHAIN_ID,
      destinationBlockNumber: 100,
      destinationBlockHash: BLOCK,
      confirmations: 12,
    };

    expect(() => assertFirstDestinationRevertFinalizable(receipt, claim, proof))
      .not.toThrow();
    for (const mismatch of [
      { ...receipt, stage: 'VERIFIED' },
      { ...receipt, receiveTxHash: `0x${'e'.repeat(64)}` },
      { ...receipt, destinationChainId: 84532 },
    ]) {
      expect(() => assertFirstDestinationRevertFinalizable(mismatch, claim, proof))
        .toThrow(/exact immutable first destination tx/i);
    }
    expect(() =>
      assertFirstDestinationRevertFinalizable(
        receipt, { receiveTxHash: `0x${'e'.repeat(64)}` }, proof,
      ),
    ).toThrow(/exact immutable first destination tx/i);
    expect(() =>
      assertFirstDestinationRevertFinalizable(receipt, claim, { ...proof, confirmations: 11 }),
    ).toThrow(/exact immutable first destination tx/i);
  });
});
