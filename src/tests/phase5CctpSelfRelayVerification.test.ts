import { describe, expect, it } from 'vitest';
import { encodeFunctionData, parseAbi } from 'viem';
import {
  assertSelfRelayTransactionMatchesCheckpoint,
  assertSelfRelayNetworkEvidence,
} from '../../server/services/cctpSelfRelayVerification.js';
import type {
  BridgeRecoveryInput,
} from '../../server/db/repositories/bridgeRecoveryRepository.js';
import { MANIFEST_CONSTANTS } from '../providers/registry/providerManifest';

const SENDER = '0x1111111111111111111111111111111111111111';
const RECIPIENT = '0x2222222222222222222222222222222222222222';
const MESSAGE = '0x11223344';
const ATTESTATION = '0xaabbccdd';
const RECEIVE_ABI = parseAbi([
  'function receiveMessage(bytes message, bytes attestation) returns (bool success)',
]);

function checkpoint(
  overrides: Partial<BridgeRecoveryInput> = {},
): BridgeRecoveryInput {
  return {
    planId: 'self-relay-immutable-plan',
    stage: 'ATTESTATION_READY',
    burnTxHash: `0x${'a'.repeat(64)}`,
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
    updatedAt: 1000,
    ...overrides,
  };
}

function transaction(
  overrides: Partial<{
    from: string;
    to: string | null;
    input: `0x${string}`;
  }> = {},
) {
  return {
    from: RECIPIENT,
    to: MANIFEST_CONSTANTS.CCTP_V2_MESSAGE_TRANSMITTER,
    input: encodeFunctionData({
      abi: RECEIVE_ABI,
      functionName: 'receiveMessage',
      args: [MESSAGE, ATTESTATION],
    }),
    ...overrides,
  };
}

describe('Phase 5 self-relay authoritative transaction binding', () => {
  it('accepts only exact source-attested destination calldata and recipient wallet sender', () => {
    expect(() =>
      assertSelfRelayTransactionMatchesCheckpoint(checkpoint(), transaction()),
    ).not.toThrow();
    expect(() =>
      assertSelfRelayTransactionMatchesCheckpoint(
        checkpoint({ stage: 'DESTINATION_BROADCAST' }),
        transaction(),
      ),
    ).not.toThrow();
  });

  it('blocks recipient/wallet substitution and noncanonical target', () => {
    for (const value of [
      { from: SENDER },
      { to: SENDER },
      { to: null },
    ]) {
      expect(() =>
        assertSelfRelayTransactionMatchesCheckpoint(checkpoint(), transaction(value)),
      ).toThrow(/sender, target or attestation checkpoint/i);
    }
  });

  it('rejects attestation/message substitution and unrecognized calldata', () => {
    const alternatives = [
      encodeFunctionData({
        abi: RECEIVE_ABI,
        functionName: 'receiveMessage',
        args: ['0xdeadbeef', ATTESTATION],
      }),
      encodeFunctionData({
        abi: RECEIVE_ABI,
        functionName: 'receiveMessage',
        args: [MESSAGE, '0x999999'],
      }),
      '0xdeadbeef' as const,
    ];

    for (const input of alternatives) {
      expect(() =>
        assertSelfRelayTransactionMatchesCheckpoint(checkpoint(), transaction({ input })),
      ).toThrow(/receiveMessage calldata|persisted CCTP message/i);
    }
  });

  it('rejects missing/unfinished and unbound attestation checkpoints', () => {
    for (const value of [
      checkpoint({ stage: 'SOURCE_CONFIRMED' }),
      checkpoint({ attestationMessage: undefined }),
      checkpoint({ attestationSignature: undefined }),
    ]) {
      expect(() =>
        assertSelfRelayTransactionMatchesCheckpoint(value, transaction()),
      ).toThrow(/sender, target or attestation checkpoint/i);
    }
  });
});

describe('Phase 5 lost-response self-relay hash reconciliation boundary', () => {
  const hash = `0x${'9'.repeat(64)}`;

  it('accepts only the exact indexed transaction on reviewed destination RPC chain', () => {
    expect(() => assertSelfRelayNetworkEvidence(
      checkpoint(),
      hash,
      MANIFEST_CONSTANTS.ETH_SEPOLIA_CHAIN_ID,
      { ...transaction(), hash: hash.toUpperCase().replace('0X', '0x') },
    )).not.toThrow();
  });

  it('rejects wrong RPC chain, malicious tx substitution and malformed hash', () => {
    for (const [requested, chainId, indexed] of [
      [hash, MANIFEST_CONSTANTS.BASE_SEPOLIA_CHAIN_ID, hash],
      [hash, 5042002, hash],
      [hash, Number.NaN, hash],
      [hash, MANIFEST_CONSTANTS.ETH_SEPOLIA_CHAIN_ID, `0x${'8'.repeat(64)}`],
      ['0xdead', MANIFEST_CONSTANTS.ETH_SEPOLIA_CHAIN_ID, hash],
    ] as const) {
      expect(() => assertSelfRelayNetworkEvidence(
        checkpoint(), requested, chainId, { ...transaction(), hash: indexed },
      )).toThrow(/hash or independent destination RPC chain ID mismatch/i);
    }
  });

  it('also enforces the canonical CCTP call and intended wallet sender', () => {
    expect(() => assertSelfRelayNetworkEvidence(
      checkpoint(), hash, MANIFEST_CONSTANTS.ETH_SEPOLIA_CHAIN_ID,
      { ...transaction({ from: SENDER }), hash },
    )).toThrow(/sender, target or attestation checkpoint/i);
  });
});
