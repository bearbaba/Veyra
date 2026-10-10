import { describe, expect, it } from 'vitest';
import { MAINNET_CHAIN_CATALOG } from '../config/mainnetCatalog';
import { MANIFEST_CONSTANTS, PROVIDER_MANIFEST } from '../providers/registry/providerManifest';
import {
  checkProviderEligibility,
  checkProviderNetworkEligibility,
} from '../providers/registry/providerRegistry';

describe('Phase 4D network ↔ asset compatibility', () => {
  it('blocks an Ethereum Sepolia USDC address when the route source is Arc Testnet', () => {
    const result = checkProviderEligibility(
      'cctp-v2-bridge',
      'BRIDGE',
      MANIFEST_CONSTANTS.ARC_TESTNET_CHAIN_ID,
      MANIFEST_CONSTANTS.ETH_SEPOLIA_USDC,
      'testnet',
    );

    expect(result.eligible).toBe(false);
    expect(result.status).toBe('ASSET_NOT_SUPPORTED');
  });

  it('allows the correct USDC deployment on each enabled CCTP testnet chain', () => {
    const cases = [
      [MANIFEST_CONSTANTS.ARC_TESTNET_CHAIN_ID, MANIFEST_CONSTANTS.ARC_TESTNET_USDC],
      [MANIFEST_CONSTANTS.ETH_SEPOLIA_CHAIN_ID, MANIFEST_CONSTANTS.ETH_SEPOLIA_USDC],
      [MANIFEST_CONSTANTS.BASE_SEPOLIA_CHAIN_ID, MANIFEST_CONSTANTS.BASE_SEPOLIA_USDC],
    ] as const;

    for (const [chainId, asset] of cases) {
      const result = checkProviderEligibility(
        'cctp-v2-bridge',
        'BRIDGE',
        chainId,
        asset,
        'testnet',
      );
      expect(result.eligible).toBe(true);
      expect(result.status).toBe('ELIGIBLE');
    }
  });

  it('applies the same exact deployment check through product network eligibility', () => {
    const result = checkProviderNetworkEligibility(
      'cctp-v2-bridge',
      'BRIDGE',
      {
        networkId: 'arc-testnet',
        chainId: MANIFEST_CONSTANTS.ARC_TESTNET_CHAIN_ID,
      },
      MANIFEST_CONSTANTS.BASE_SEPOLIA_USDC,
      'testnet',
    );

    expect(result.eligible).toBe(false);
    expect(result.status).toBe('ASSET_NOT_SUPPORTED');
  });

  it('requires an explicit matrix for every multi-chain asset-specific provider', () => {
    const multiChainAssetProviders = PROVIDER_MANIFEST.filter(
      (entry) => entry.supportedChainIds.length > 1 && entry.supportedAssets.length > 0,
    );

    expect(multiChainAssetProviders.length).toBeGreaterThan(0);

    for (const entry of multiChainAssetProviders) {
      expect(entry.networkAssetSupport?.length ?? 0).toBeGreaterThan(0);

      for (const chainId of entry.supportedChainIds) {
        const rows = entry.networkAssetSupport?.filter((row) => row.chainId === chainId) ?? [];
        expect(rows.length, `${entry.providerId} missing chain ${chainId}`).toBeGreaterThan(0);
        expect(rows.some((row) => row.assets.length > 0)).toBe(true);
      }
    }
  });

  it('maps every mainnet USDC deployment to its own chain for future activation', () => {
    for (const providerId of ['mainnet-usdc-transfer', 'cctp-v2-mainnet']) {
      const entry = PROVIDER_MANIFEST.find((candidate) => candidate.providerId === providerId);
      expect(entry).toBeDefined();

      for (const chain of MAINNET_CHAIN_CATALOG) {
        const row = entry!.networkAssetSupport?.find(
          (candidate) => candidate.chainId === chain.chainId,
        );
        expect(row).toBeDefined();
        expect(row!.assets.map((asset) => asset.toLowerCase()))
          .toContain(chain.usdc.toLowerCase());
      }
    }
  });
});
