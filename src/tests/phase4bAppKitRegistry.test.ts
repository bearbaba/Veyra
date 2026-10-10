import { describe, expect, it } from 'vitest';
import {
  assertCircleAppKitChain,
  circleChainForNetworkId,
} from '../providers/appkit/appKitChains';
import { findManifestEntry } from '../providers/registry/providerManifest';
import { checkProviderNetworkEligibility } from '../providers/registry/providerRegistry';

describe('Phase 4B Circle App Kit chain registry', () => {
  it('maps Veyra network IDs to exact Circle chain identifiers', () => {
    expect(circleChainForNetworkId('arc-testnet')).toBe('Arc_Testnet');
    expect(circleChainForNetworkId('base')).toBe('Base');
    expect(circleChainForNetworkId('solana-devnet')).toBe('Solana_Devnet');
    expect(circleChainForNetworkId('world-chain')).toBe('World_Chain');
  });

  it('rejects unknown App Kit chain identifiers', () => {
    expect(() => assertCircleAppKitChain('Not_A_Chain')).toThrow(/unsupported circle app kit chain/i);
  });
});

describe('Phase 4B Circle App Kit provider lifecycle', () => {
  it('keeps every new App Kit money provider disabled before real E2E', () => {
    const ids = [
      'circle-appkit-unified-balance',
      'circle-appkit-bridge',
      'circle-appkit-swap',
      'circle-appkit-earn',
    ];
    for (const id of ids) {
      const entry = findManifestEntry(id);
      expect(entry).toBeDefined();
      expect(entry!.trustStatus).toBe('OFFICIAL');
      expect(entry!.lifecycleStage).toBe('IMPLEMENTED');
      expect(entry!.enabled).toBe(false);
      expect(entry!.healthStatus).toBe('UNKNOWN');
    }
  });

  it('recognizes Solana at the product layer without claiming the current viem adapter can execute it', () => {
    expect(circleChainForNetworkId('solana-devnet')).toBe('Solana_Devnet');
    const entry = findManifestEntry('circle-appkit-unified-balance');
    expect(entry?.supportedNetworkIds).not.toContain('solana-devnet');
  });

  it('fails closed on non-EVM execution until a Solana adapter path is implemented', () => {
    const result = checkProviderNetworkEligibility(
      'circle-appkit-unified-balance',
      'UNIFIED_BALANCE',
      { networkId: 'solana-devnet' },
      undefined,
      'testnet',
    );
    expect(result.eligible).toBe(false);
    expect(result.status).toBe('CHAIN_NOT_SUPPORTED');
  });
});
