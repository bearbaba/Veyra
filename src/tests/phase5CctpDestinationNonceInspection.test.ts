import { describe, expect, it, vi } from 'vitest';
import {
  inspectCctpDestinationNonce,
  parseReviewedCctpV2Nonce,
} from '../../server/services/cctpDestinationNonceInspectionService.js';
import type { BridgeRecoveryInput } from '../../server/db/repositories/bridgeRecoveryRepository.js';
import { MANIFEST_CONSTANTS } from '../providers/registry/providerManifest';

const HASH = `0x${'a'.repeat(64)}`;
const BLOCK_HASH = `0x${'b'.repeat(64)}` as const;
const NONCE = `0x${'c'.repeat(64)}`;
const ZERO = '0'.repeat(64);

const u32 = (n: number) => n.toString(16).padStart(8, '0');
function message(args: {
  version?: number;
  sourceDomain?: number;
  destinationDomain?: number;
  nonce?: string;
  destinationCaller?: string;
  body?: string;
} = {}) {
  return `0x${u32(args.version ?? 1)}${u32(args.sourceDomain ?? 26)}${u32(args.destinationDomain ?? 0)}${args.nonce ?? 'c'.repeat(64)}${'1'.repeat(64)}${'2'.repeat(64)}${args.destinationCaller ?? ZERO}${u32(2000)}${u32(2000)}${args.body ?? 'abcd'}`;
}

function checkpoint(override: Partial<BridgeRecoveryInput> = {}): BridgeRecoveryInput {
  return {
    planId: 'cctp-nonce-inspection',
    stage: 'DESTINATION_BROADCAST',
    burnTxHash: HASH,
    sourceChainId: MANIFEST_CONSTANTS.ARC_TESTNET_CHAIN_ID,
    destinationChainId: MANIFEST_CONSTANTS.ETH_SEPOLIA_CHAIN_ID,
    walletAddress: '0x1111111111111111111111111111111111111111',
    recipientAddress: '0x2222222222222222222222222222222222222222',
    amount: '1000000',
    tokenAddress: MANIFEST_CONSTANTS.ARC_TESTNET_USDC,
    balanceBefore: '0',
    receiveTxHash: `0x${'3'.repeat(64)}`,
    attestationMessage: message(),
    attestationSignature: '0xabcd',
    createdAt: 1000,
    updatedAt: 1001,
    ...override,
  };
}

function inspect(args: {
  current?: BridgeRecoveryInput;
  used?: bigint;
  firstHash?: `0x${string}` | null;
  secondHash?: `0x${string}` | null;
  head?: bigint;
  failure?: 'read' | 'head' | 'hash';
} = {}) {
  let hashCalls = 0;
  let headCalls = 0;
  const getHead = vi.fn(async () => {
    headCalls += 1;
    if (args.failure === 'head' && headCalls === 2) throw new Error('RPC error');
    return headCalls === 1 ? 200n : (args.head ?? 200n);
  });
  const getHash = vi.fn(async () => {
    hashCalls += 1;
    if (args.failure === 'hash') throw new Error('RPC unavailable');
    return hashCalls === 1
      ? (args.firstHash === undefined ? BLOCK_HASH : args.firstHash)
      : (args.secondHash === undefined ? BLOCK_HASH : args.secondHash);
  });
  const readNonce = vi.fn(async () => {
    if (args.failure === 'read') throw new Error('RPC timeout');
    return args.used ?? 0n;
  });
  return {
    proof: inspectCctpDestinationNonce(
      args.current ?? checkpoint(),
      getHead, getHash, readNonce,
    ),
    getHead, getHash, readNonce,
  };
}

describe('Phase 5 CCTP V2 destination nonce read-only safety gate', () => {
  it('parses nonce from exact V2 offset with source/dest domains and any-caller', () => {
    expect(parseReviewedCctpV2Nonce(checkpoint())).toEqual({
      nonce: NONCE,
      version: 1,
      sourceDomain: 26,
      destinationDomain: 0,
    });
  });

  it('observes an unused nonce at one canonical block but NEVER authorizes retry', async () => {
    const result = inspect();
    await expect(result.proof).resolves.toMatchObject({
      nonce: NONCE,
      destinationChainId: MANIFEST_CONSTANTS.ETH_SEPOLIA_CHAIN_ID,
      destinationDomain: 0,
      observedBlockNumber: 200,
      observedBlockHash: BLOCK_HASH,
      usage: 'UNUSED_AT_OBSERVED_BLOCK',
      retryAuthorized: false,
    });
    expect(result.readNonce).toHaveBeenCalledWith(NONCE, 200n);
    expect(result.getHash).toHaveBeenCalledTimes(2);
    expect(result.getHead).toHaveBeenCalledTimes(2);
  });

  it('marks an already consumed nonce, always without signing authorization', async () => {
    await expect(inspect({ used: 1n }).proof).resolves.toMatchObject({
      usage: 'ALREADY_CONSUMED',
      retryAuthorized: false,
    });
  });

  it('supports Base Sepolia with the right destination CCTP domain', async () => {
    const input = checkpoint({
      destinationChainId: MANIFEST_CONSTANTS.BASE_SEPOLIA_CHAIN_ID,
      attestationMessage: message({ destinationDomain: 6 }),
    });
    await expect(inspect({ current: input }).proof).resolves.toMatchObject({
      destinationDomain: 6,
      destinationChainId: MANIFEST_CONSTANTS.BASE_SEPOLIA_CHAIN_ID,
      retryAuthorized: false,
    });
  });

  it('rejects truncated, odd-hex, v1-format and malformed message headers', () => {
    const invalid = [
      '0x1234',
      '0x123',
      '0xGHIJ',
      message({ version: 0 }),
      message({ version: 2 }),
      message({ sourceDomain: 0 }),
      message({ destinationDomain: 6 }),
      message({ nonce: ZERO }),
      message({ destinationCaller: '4'.repeat(64) }),
    ];
    for (const attestationMessage of invalid) {
      expect(() => parseReviewedCctpV2Nonce(checkpoint({ attestationMessage })))
        .toThrow(/complete attested V2 message|reviewed Arc destination domains/i);
    }
  });

  it('does not allow non-CCTP routes, absent first receive or wrong checkpoint stage', () => {
    const invalid: Array<Partial<BridgeRecoveryInput>> = [
      { sourceChainId: 1 },
      { destinationChainId: 1 },
      { attestationMessage: undefined },
      { receiveTxHash: undefined },
      { receiveTxHash: '0xdead' },
      { stage: 'SOURCE_CONFIRMED' },
      { stage: 'ATTESTATION_READY' },
    ];
    for (const change of invalid) {
      expect(() => parseReviewedCctpV2Nonce(checkpoint(change))).toThrow();
    }
  });

  it('fails closed on reorg, disappearing block or invalid nonce contract values', async () => {
    const invalid = [
      { secondHash: `0x${'d'.repeat(64)}` as const },
      { firstHash: null },
      { head: 199n },
      { used: 2n },
      { used: -1n },
    ];
    for (const args of invalid) {
      await expect(inspect(args).proof).rejects.toThrow(/inconsistent, non-canonical or invalid/i);
    }
  });

  it('fails closed on network errors, never assumes nonce=0 when RPC fails', async () => {
    for (const failure of ['read', 'head', 'hash'] as const) {
      await expect(inspect({ failure }).proof).rejects
        .toThrow(/unavailable; never infer unused/i);
    }
  });
});
