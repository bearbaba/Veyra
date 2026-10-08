import { describe, expect, it } from 'vitest';
import { CCTP_V2_MAINNET, MAINNET_CHAIN_CATALOG, validateMainnetCatalog } from '../config/mainnetCatalog.js';
import { MAINNET_PROVIDER_MANIFEST } from '../providers/registry/mainnetProviderManifest.js';

const expectedUsdc: Record<number, string> = {
  1: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  43114: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E',
  10: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
  42161: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  8453: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  137: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
};

describe('Phase 3B verified mainnet catalog', () => {
  it('contains the Circle-verified EVM mainnet launch set', () => {
    expect(validateMainnetCatalog()).toEqual([]);
    expect(MAINNET_CHAIN_CATALOG).toHaveLength(6);
    for (const chain of MAINNET_CHAIN_CATALOG) expect(chain.usdc).toBe(expectedUsdc[chain.chainId]);
  });

  it('records the Circle CCTP V2 mainnet contracts', () => {
    expect(CCTP_V2_MAINNET.tokenMessengerV2).toBe('0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d');
    expect(CCTP_V2_MAINNET.messageTransmitterV2).toBe('0x81D40F21F12A8F0E3252Bccb954D722d4c464B64');
  });

  it('registers mainnet providers as verified but fail-closed', () => {
    expect(MAINNET_PROVIDER_MANIFEST.length).toBeGreaterThanOrEqual(2);
    for (const provider of MAINNET_PROVIDER_MANIFEST) {
      expect(provider.environment).toBe('mainnet');
      expect(provider.lifecycleStage).toBe('VERIFIED');
      expect(provider.enabled).toBe(false);
      expect(provider.healthStatus).toBe('UNKNOWN');
    }
  });
});
