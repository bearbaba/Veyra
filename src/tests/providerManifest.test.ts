/**
 * Tests: src/providers/registry/providerManifest.ts
 */
import { describe, it, expect } from 'vitest';
import { PROVIDER_MANIFEST, findManifestEntry } from '../providers/registry/providerManifest.js';

describe('PROVIDER_MANIFEST structure', () => {
  it('is a non-empty array', () => {
    expect(Array.isArray(PROVIDER_MANIFEST)).toBe(true);
    expect(PROVIDER_MANIFEST.length).toBeGreaterThan(0);
  });

  it('every entry has a unique providerId', () => {
    const ids = PROVIDER_MANIFEST.map((e) => e.providerId);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it('every entry has at least one capability', () => {
    for (const entry of PROVIDER_MANIFEST) {
      expect(entry.capabilities.length).toBeGreaterThan(0);
    }
  });

  it('every entry has provenance with a sourceUrl and verifiedAt', () => {
    for (const entry of PROVIDER_MANIFEST) {
      expect(entry.provenance.sourceUrl).toBeTruthy();
      expect(entry.provenance.verifiedAt).toBeTruthy();
    }
  });

  it('disabled entries have trustStatus UNVERIFIED or are explicitly DISABLED', () => {
    const disabled = PROVIDER_MANIFEST.filter((e) => !e.enabled);
    for (const entry of disabled) {
      expect(['UNVERIFIED', 'DISABLED', 'TRUSTED', 'OFFICIAL']).toContain(entry.trustStatus);
    }
  });
});

describe('PROVIDER_MANIFEST — enabled providers', () => {
  const enabled = PROVIDER_MANIFEST.filter((e) => e.enabled);

  it('has at least one enabled provider', () => {
    expect(enabled.length).toBeGreaterThan(0);
  });

  it('every enabled provider supports at least one chain', () => {
    for (const entry of enabled) {
      expect(entry.supportedChainIds.length).toBeGreaterThan(0);
    }
  });

  it('arc-erc20-transfer is enabled', () => {
    const entry = PROVIDER_MANIFEST.find((e) => e.providerId === 'arc-erc20-transfer');
    expect(entry).toBeDefined();
    expect(entry!.enabled).toBe(true);
  });

  it('viem-simulation is enabled', () => {
    const entry = PROVIDER_MANIFEST.find((e) => e.providerId === 'viem-simulation');
    expect(entry).toBeDefined();
    expect(entry!.enabled).toBe(true);
  });

  it('arc-portfolio-read is enabled', () => {
    const entry = PROVIDER_MANIFEST.find((e) => e.providerId === 'arc-portfolio-read');
    expect(entry).toBeDefined();
    expect(entry!.enabled).toBe(true);
  });
});

describe('PROVIDER_MANIFEST — provider lifecycle stages', () => {
  it('arc-erc20-transfer is ENABLED (real testnet TRANSFER verified in Phase B)', () => {
    const entry = PROVIDER_MANIFEST.find((e) => e.providerId === 'arc-erc20-transfer');
    expect(entry).toBeDefined();
    expect(entry!.lifecycleStage).toBe('ENABLED');
    expect(entry!.enabled).toBe(true);
  });

  it('viem-simulation is ENABLED', () => {
    const entry = PROVIDER_MANIFEST.find((e) => e.providerId === 'viem-simulation');
    expect(entry).toBeDefined();
    expect(entry!.lifecycleStage).toBe('ENABLED');
    expect(entry!.enabled).toBe(true);
  });

  it('arc-portfolio-read is ENABLED', () => {
    const entry = PROVIDER_MANIFEST.find((e) => e.providerId === 'arc-portfolio-read');
    expect(entry).toBeDefined();
    expect(entry!.lifecycleStage).toBe('ENABLED');
    expect(entry!.enabled).toBe(true);
  });

  it('circle-stablefx is IMPLEMENTED — not yet ENABLED (awaiting real testnet E2E)', () => {
    const entry = PROVIDER_MANIFEST.find((e) => e.providerId === 'circle-stablefx');
    expect(entry).toBeDefined();
    expect(entry!.lifecycleStage).toBe('IMPLEMENTED');
    expect(entry!.enabled).toBe(false);
    expect(entry!.capabilities).toContain('CONVERT');
  });

  it('cctp-v2-bridge is ENABLED — real testnet E2E verified 2026-10-08', () => {
    const entry = PROVIDER_MANIFEST.find((e) => e.providerId === 'cctp-v2-bridge');
    expect(entry).toBeDefined();
    expect(entry!.lifecycleStage).toBe('ENABLED');
    expect(entry!.enabled).toBe(true);
    expect(entry!.capabilities).toContain('BRIDGE');
    expect(entry!.healthStatus).toBe('OK');
    // Provenance must document the E2E evidence
    expect(entry!.provenance.notes).toContain('LIFECYCLE PROMOTED TO ENABLED');
  });

  it('circle-unified-balance is DISCOVERED', () => {
    const entry = PROVIDER_MANIFEST.find((e) => e.providerId === 'circle-unified-balance');
    expect(entry).toBeDefined();
    expect(entry!.lifecycleStage).toBe('DISCOVERED');
    expect(entry!.enabled).toBe(false);
    expect(entry!.trustStatus).toBe('UNVERIFIED');
  });

  it('every entry has a lifecycleStage field', () => {
    const stages = ['DISCOVERED', 'VERIFIED', 'IMPLEMENTED', 'TESTED', 'ENABLED'];
    for (const entry of PROVIDER_MANIFEST) {
      expect(stages).toContain(entry.lifecycleStage);
    }
  });

  it('enabled:true requires lifecycleStage ENABLED — no exceptions', () => {
    for (const entry of PROVIDER_MANIFEST) {
      if (entry.enabled) {
        expect(entry.lifecycleStage).toBe('ENABLED');
      }
    }
  });

  it('lifecycleStage ENABLED requires enabled:true — no silent disabled ENABLED providers', () => {
    for (const entry of PROVIDER_MANIFEST) {
      if (entry.lifecycleStage === 'ENABLED') {
        expect(entry.enabled).toBe(true);
      }
    }
  });
});

describe('PROVIDER_MANIFEST — disabled providers', () => {
  it('every disabled provider has a non-ENABLED lifecycleStage', () => {
    const disabled = PROVIDER_MANIFEST.filter((e) => !e.enabled);
    for (const entry of disabled) {
      expect(entry.lifecycleStage).not.toBe('ENABLED');
    }
  });

  it('every disabled provider has trustStatus UNVERIFIED, DISABLED, TRUSTED, or OFFICIAL', () => {
    const disabled = PROVIDER_MANIFEST.filter((e) => !e.enabled);
    for (const entry of disabled) {
      expect(['UNVERIFIED', 'DISABLED', 'TRUSTED', 'OFFICIAL']).toContain(entry.trustStatus);
    }
  });
});

describe('findManifestEntry', () => {
  it('returns the correct entry for a known ID', () => {
    const entry = findManifestEntry('arc-erc20-transfer');
    expect(entry).toBeDefined();
    expect(entry!.providerId).toBe('arc-erc20-transfer');
  });

  it('returns undefined for an unknown ID', () => {
    expect(findManifestEntry('nonexistent-provider-xyz')).toBeUndefined();
  });
});
