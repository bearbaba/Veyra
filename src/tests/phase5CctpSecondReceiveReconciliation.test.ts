import { describe, expect, it } from 'vitest';
import { encodeFunctionData, parseAbi } from 'viem';
import {
  assertSecondReceiveTransactionMatchesCheckpoint,
} from '../../server/services/cctpSecondReceiveReconciliationService.js';
import type { BridgeRecoveryInput } from '../../server/db/repositories/bridgeRecoveryRepository.js';
import { MANIFEST_CONSTANTS } from '../providers/registry/providerManifest';

const FIRST = `0x${'7'.repeat(64)}`;
const SECOND = `0x${'8'.repeat(64)}`;
const RELAYER = '0x3333333333333333333333333333333333333333';
const WALLET = '0x1111111111111111111111111111111111111111';
const RECIPIENT = '0x2222222222222222222222222222222222222222';
const U32 = (n: number) => n.toString(16).padStart(8, '0');
const message = (domain = 0, destinationCaller = '0'.repeat(64)) =>
  `0x${U32(1)}${U32(26)}${U32(domain)}${'a'.repeat(64)}${'1'.repeat(64)}${'2'.repeat(64)}${destinationCaller}${U32(2000)}${U32(2000)}abcd` as `0x${string}`;
const ATTESTATION = '0xcafe' as const;
const RECEIVE_ABI = parseAbi([
  'function receiveMessage(bytes message, bytes attestation) returns (bool success)',
]);

function checkpoint(overrides: Partial<BridgeRecoveryInput> = {}): BridgeRecoveryInput {
  return {
    planId: 'lost-attempt-two-hash',
    stage: 'DESTINATION_BROADCAST',
    burnTxHash: `0x${'6'.repeat(64)}`,
    receiveTxHash: FIRST,
    sourceChainId: MANIFEST_CONSTANTS.ARC_TESTNET_CHAIN_ID,
    destinationChainId: MANIFEST_CONSTANTS.ETH_SEPOLIA_CHAIN_ID,
    walletAddress: WALLET,
    recipientAddress: RECIPIENT,
    amount: '1000000',
    tokenAddress: MANIFEST_CONSTANTS.ARC_TESTNET_USDC,
    balanceBefore: '0',
    attestationMessage: message(),
    attestationSignature: ATTESTATION,
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

function indexed(overrides: Partial<{
  hash: string;
  from: string;
  to: string | null;
  input: `0x${string}`;
}> = {}) {
  return {
    hash: SECOND,
    from: RELAYER,
    to: MANIFEST_CONSTANTS.CCTP_V2_MESSAGE_TRANSMITTER,
    input: encodeFunctionData({
      abi: RECEIVE_ABI,
      functionName: 'receiveMessage',
      args: [message(), ATTESTATION],
    }),
    ...overrides,
  };
}

describe('Phase 5 second receive lost-response transaction reconciliation', () => {
  it('allows an unrelated funded relayer only for the original any-caller Circle message', () => {
    expect(() => assertSecondReceiveTransactionMatchesCheckpoint(
      checkpoint(), SECOND, MANIFEST_CONSTANTS.ETH_SEPOLIA_CHAIN_ID, indexed(),
    )).not.toThrow();
  });

  it('accepts Base Sepolia only when actual RPC chain and source message domain agree', () => {
    const baseMessage = message(6);
    const c = checkpoint({
      destinationChainId: MANIFEST_CONSTANTS.BASE_SEPOLIA_CHAIN_ID,
      attestationMessage: baseMessage,
    });
    const tx = indexed({ input: encodeFunctionData({
      abi: RECEIVE_ABI,
      functionName: 'receiveMessage',
      args: [baseMessage, ATTESTATION],
    }) });
    expect(() => assertSecondReceiveTransactionMatchesCheckpoint(
      c, SECOND, MANIFEST_CONSTANTS.BASE_SEPOLIA_CHAIN_ID, tx,
    )).not.toThrow();
  });

  it('fails closed on wrong RPC chain, swapped hash, first hash reuse or noncanonical contract', () => {
    const cases = [
      { hash: SECOND, chain: MANIFEST_CONSTANTS.BASE_SEPOLIA_CHAIN_ID, tx: indexed() },
      { hash: SECOND, chain: 1, tx: indexed() },
      { hash: SECOND, chain: Number.NaN, tx: indexed() },
      { hash: SECOND, chain: MANIFEST_CONSTANTS.ETH_SEPOLIA_CHAIN_ID, tx: indexed({ hash: FIRST }) },
      { hash: FIRST, chain: MANIFEST_CONSTANTS.ETH_SEPOLIA_CHAIN_ID, tx: indexed({ hash: FIRST }) },
      { hash: '0xdead', chain: MANIFEST_CONSTANTS.ETH_SEPOLIA_CHAIN_ID, tx: indexed() },
      { hash: SECOND, chain: MANIFEST_CONSTANTS.ETH_SEPOLIA_CHAIN_ID, tx: indexed({ to: WALLET }) },
      { hash: SECOND, chain: MANIFEST_CONSTANTS.ETH_SEPOLIA_CHAIN_ID, tx: indexed({ from: 'not-an-address' }) },
    ];
    for (const c of cases) {
      expect(() => assertSecondReceiveTransactionMatchesCheckpoint(
        checkpoint(), c.hash, c.chain, c.tx,
      )).toThrow(/distinct indexed hash|correct RPC chain|canonical CCTP transmitter/i);
    }
  });

  it('refuses incorrect message, Circle signature, input selector and missing first hash', () => {
    for (const args of [
      [message(6), ATTESTATION],
      [message(), '0xbadbad'],
    ] as const) {
      const tx = indexed({ input: encodeFunctionData({
        abi: RECEIVE_ABI,
        functionName: 'receiveMessage',
        args: [args[0], args[1]],
      }) });
      expect(() => assertSecondReceiveTransactionMatchesCheckpoint(
        checkpoint(), SECOND, MANIFEST_CONSTANTS.ETH_SEPOLIA_CHAIN_ID, tx,
      )).toThrow(/original source-attested Circle message/i);
    }
    expect(() => assertSecondReceiveTransactionMatchesCheckpoint(
      checkpoint(), SECOND, MANIFEST_CONSTANTS.ETH_SEPOLIA_CHAIN_ID,
      indexed({ input: '0xdeadbeef' }),
    )).toThrow(/canonical CCTP receiveMessage calldata/i);
    expect(() => assertSecondReceiveTransactionMatchesCheckpoint(
      checkpoint({ receiveTxHash: undefined }),
      SECOND, MANIFEST_CONSTANTS.ETH_SEPOLIA_CHAIN_ID, indexed(),
    )).toThrow(/complete attested|distinct indexed hash/i);
  });

  it('refuses restrictive destinationCaller, malformed header, source/destination substitution', () => {
    for (const current of [
      checkpoint({ attestationMessage: message(0, 'f'.repeat(64)) }),
      checkpoint({ attestationMessage: '0x1234' }),
      checkpoint({ destinationChainId: MANIFEST_CONSTANTS.BASE_SEPOLIA_CHAIN_ID }),
      checkpoint({ sourceChainId: 1 }),
      checkpoint({ stage: 'SOURCE_CONFIRMED' }),
    ]) {
      expect(() => assertSecondReceiveTransactionMatchesCheckpoint(
        current, SECOND, MANIFEST_CONSTANTS.ETH_SEPOLIA_CHAIN_ID, indexed(),
      )).toThrow();
    }
  });
});
