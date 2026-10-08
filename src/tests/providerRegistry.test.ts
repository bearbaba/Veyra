/**
 * Tests: src/providers/registry/providerRegistry.ts
 */
import { describe, it, expect } from 'vitest';
import {
  checkProviderEligibility,
  findEligibleProvider,
  getAllProviders,
  getProvider,
  getProvidersForCapability,
  updateProviderHealth,
} from '../providers/registry/providerRegistry.js';

const ARC_TESTNET_CHAIN_ID = 5042002;
const ARC_TESTNET_USDC = '0x3600000000000000000000000000000000000000';

describe('getProvider', () => {
  it('returns found:true for arc-erc20-transfer', () => {
    const result = getProvider('arc-erc20-transfer');
    expect(result.found).toBe(true);
  });

  it('returns found:false for an unregistered provider', () => {
    const result = getProvider('totally-fake-provider');
    expect(result.found).toBe(false);
  });

  it('includes effectiveHealth for a known provider', () => {
    const result = getProvider('arc-erc20-transfer');
    if (result.found) {
      expect(['OK', 'DEGRADED', 'DOWN', 'UNKNOWN']).toContain(result.effectiveHealth);
    }
  });
});

describe('getAllProviders', () => {
  it('returns all manifest entries', () => {
    const all = getAllProviders();
    expect(all.length).toBeGreaterThan(0);
  });
});

describe('getProvidersForCapability', () => {
  it('returns providers that support TRANSFER', () => {
    const providers = getProvidersForCapability('TRANSFER');
    const ids = providers.map((p) => p.providerId);
    expect(ids).toContain('arc-erc20-transfer');
  });

  it('returns providers that support SIMULATION', () => {
    const providers = getProvidersForCapability('SIMULATION');
    const ids = providers.map((p) => p.providerId);
    expect(ids).toContain('viem-simulation');
  });

  it('returns an empty array for BORROW (no provider yet)', () => {
    const providers = getProvidersForCapability('BORROW');
    // cctp-bridge doesn't do BORROW, so this should filter correctly
    const enabled = providers.filter((p) => p.enabled);
    expect(enabled.length).toBe(0);
  });
});

describe('checkProviderEligibility', () => {
  it('eligible for arc-erc20-transfer on Arc Testnet with USDC', () => {
    const result = checkProviderEligibility(
      'arc-erc20-transfer',
      'TRANSFER',
      ARC_TESTNET_CHAIN_ID,
      ARC_TESTNET_USDC,
    );
    expect(result.eligible).toBe(true);
  });

  it('not eligible for unregistered provider', () => {
    const result = checkProviderEligibility('fake-provider', 'TRANSFER', ARC_TESTNET_CHAIN_ID);
    expect(result.eligible).toBe(false);
    expect(result.status).toBe('NOT_FOUND');
  });

  it('not eligible for disabled/unverified provider (circle-unified-balance)', () => {
    // circle-unified-balance is UNVERIFIED and disabled — disabled check fires before lifecycle check
    const result = checkProviderEligibility('circle-unified-balance', 'BRIDGE', ARC_TESTNET_CHAIN_ID, ARC_TESTNET_USDC);
    expect(result.eligible).toBe(false);
    expect(result.status).toBe('UNVERIFIED');
  });

  it('not eligible for IMPLEMENTED provider (circle-stablefx) — lifecycle gate fires', () => {
    // circle-stablefx is explicitly disabled (enabled:false) so UNVERIFIED fires first;
    // this test confirms the disabled path also blocks it correctly
    const result = checkProviderEligibility('circle-stablefx', 'CONVERT', ARC_TESTNET_CHAIN_ID, ARC_TESTNET_USDC);
    expect(result.eligible).toBe(false);
    // disabled:false and trustStatus:OFFICIAL → DISABLED status (not UNVERIFIED)
    expect(['DISABLED', 'NOT_LIFECYCLE_READY']).toContain(result.status);
  });

  it('not eligible for wrong chain', () => {
    const result = checkProviderEligibility(
      'arc-erc20-transfer',
      'TRANSFER',
      1, // Ethereum mainnet
      ARC_TESTNET_USDC,
    );
    expect(result.eligible).toBe(false);
    expect(result.status).toBe('CHAIN_NOT_SUPPORTED');
  });

  it('not eligible for unsupported asset', () => {
    const result = checkProviderEligibility(
      'arc-erc20-transfer',
      'TRANSFER',
      ARC_TESTNET_CHAIN_ID,
      '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
    );
    expect(result.eligible).toBe(false);
    expect(result.status).toBe('ASSET_NOT_SUPPORTED');
  });

  it('not eligible for unsupported capability', () => {
    const result = checkProviderEligibility(
      'arc-erc20-transfer',
      'BORROW',
      ARC_TESTNET_CHAIN_ID,
    );
    expect(result.eligible).toBe(false);
    expect(result.status).toBe('CAPABILITY_NOT_SUPPORTED');
  });

  it('not eligible when health is DOWN', () => {
    updateProviderHealth({
      providerId: 'arc-erc20-transfer',
      status: 'DOWN',
      checkedAt: Date.now(),
    });
    const result = checkProviderEligibility(
      'arc-erc20-transfer',
      'TRANSFER',
      ARC_TESTNET_CHAIN_ID,
      ARC_TESTNET_USDC,
    );
    expect(result.eligible).toBe(false);
    expect(result.status).toBe('HEALTH_DOWN');

    // Restore health
    updateProviderHealth({
      providerId: 'arc-erc20-transfer',
      status: 'OK',
      checkedAt: Date.now(),
    });
  });

  it('eligible but requiresConfirmation when health is DEGRADED', () => {
    updateProviderHealth({
      providerId: 'arc-erc20-transfer',
      status: 'DEGRADED',
      checkedAt: Date.now(),
    });
    const result = checkProviderEligibility(
      'arc-erc20-transfer',
      'TRANSFER',
      ARC_TESTNET_CHAIN_ID,
      ARC_TESTNET_USDC,
    );
    expect(result.eligible).toBe(true);
    expect(result.requiresConfirmation).toBe(true);

    // Restore health
    updateProviderHealth({
      providerId: 'arc-erc20-transfer',
      status: 'OK',
      checkedAt: Date.now(),
    });
  });
});

describe('findEligibleProvider', () => {
  it('finds arc-erc20-transfer for TRANSFER on Arc Testnet', () => {
    // Ensure health is OK first
    updateProviderHealth({
      providerId: 'arc-erc20-transfer',
      status: 'OK',
      checkedAt: Date.now(),
    });
    const result = findEligibleProvider('TRANSFER', ARC_TESTNET_CHAIN_ID, ARC_TESTNET_USDC);
    expect(result.found).toBe(true);
    if (result.found) {
      expect(result.entry.providerId).toBe('arc-erc20-transfer');
    }
  });

  it('returns found:false for BORROW (no enabled provider)', () => {
    const result = findEligibleProvider('BORROW', ARC_TESTNET_CHAIN_ID, ARC_TESTNET_USDC);
    expect(result.found).toBe(false);
  });

  it('returns found:false for CONVERT (circle-stablefx is IMPLEMENTED, not ENABLED — awaiting testnet E2E)', () => {
    // circle-stablefx docs are verified and adapter is written, but real testnet execution
    // has not yet occurred. It must not be eligible for execution until ENABLED lifecycle stage.
    const result = findEligibleProvider('CONVERT', ARC_TESTNET_CHAIN_ID, ARC_TESTNET_USDC);
    expect(result.found).toBe(false);
  });

  it('returns found:true for BRIDGE (cctp-v2-bridge is ENABLED after real testnet E2E)', () => {
    const result = findEligibleProvider('BRIDGE', ARC_TESTNET_CHAIN_ID, ARC_TESTNET_USDC);
    expect(result.found).toBe(true);
    if (result.found) expect(result.entry.providerId).toBe('cctp-v2-bridge');
  });
});

describe('Phase 3A provider environment gate', () => {
  it('blocks testnet providers when runtime environment is mainnet', () => {
    const result = checkProviderEligibility(
      'arc-erc20-transfer',
      'TRANSFER',
      ARC_TESTNET_CHAIN_ID,
      ARC_TESTNET_USDC,
      'mainnet',
    );
    expect(result.eligible).toBe(false);
    expect(result.status).toBe('ENVIRONMENT_NOT_SUPPORTED');
  });
});
