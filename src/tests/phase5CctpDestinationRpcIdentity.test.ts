import { describe, expect, it } from 'vitest';
import { assertCctpDestinationRpcIdentity } from '../../server/services/cctpDestinationRpcIdentity.js';
import { MANIFEST_CONSTANTS } from '../providers/registry/providerManifest';

describe('Phase 5 destination chain verification against real eth_chainId', () => {
  it('accepts only actual matching Ethereum Sepolia or Base Sepolia RPC network', () => {
    for (const destination of [
      MANIFEST_CONSTANTS.ETH_SEPOLIA_CHAIN_ID,
      MANIFEST_CONSTANTS.BASE_SEPOLIA_CHAIN_ID,
    ]) {
      expect(() => assertCctpDestinationRpcIdentity(destination, destination))
        .not.toThrow();
    }
  });

  it('fails closed on RPC URL network mismatch, mainnet/Arc substitution or unsafe identifiers', () => {
    const invalid: Array<[number, number]> = [
      [MANIFEST_CONSTANTS.ETH_SEPOLIA_CHAIN_ID, MANIFEST_CONSTANTS.BASE_SEPOLIA_CHAIN_ID],
      [MANIFEST_CONSTANTS.BASE_SEPOLIA_CHAIN_ID, MANIFEST_CONSTANTS.ETH_SEPOLIA_CHAIN_ID],
      [MANIFEST_CONSTANTS.ETH_SEPOLIA_CHAIN_ID, 1],
      [MANIFEST_CONSTANTS.ETH_SEPOLIA_CHAIN_ID, MANIFEST_CONSTANTS.ARC_TESTNET_CHAIN_ID],
      [MANIFEST_CONSTANTS.ETH_SEPOLIA_CHAIN_ID, 0],
      [MANIFEST_CONSTANTS.ETH_SEPOLIA_CHAIN_ID, Number.NaN],
      [MANIFEST_CONSTANTS.BASE_SEPOLIA_CHAIN_ID, Number.POSITIVE_INFINITY],
      [1, 1],
    ];
    for (const [expected, actual] of invalid) {
      expect(() => assertCctpDestinationRpcIdentity(expected, actual))
        .toThrow(/destination RPC identity does not match/i);
    }
  });

  it('is a common guard for first revert, second mint and Circle nonce reads', async () => {
    // We assert the three independent network proof services import the same
    // predicate; a new path must not bypass this trust boundary by relying
    // only on the viem chain metadata.
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    for (const path of [
      '../../server/services/cctpDestinationRevertVerificationService.ts',
      '../../server/services/cctpSecondDestinationVerificationService.ts',
      '../../server/services/cctpDestinationNonceInspectionService.ts',
    ]) {
      const source = readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
      expect(source).toContain('client.getChainId()');
      expect(source).toContain('assertCctpDestinationRpcIdentity(checkpoint.destinationChainId, actualChainId)');
    }
  });
});
