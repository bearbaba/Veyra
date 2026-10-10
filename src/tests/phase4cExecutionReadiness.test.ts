import { beforeEach, describe, expect, it, vi } from 'vitest';
import { assertExecutionReady } from '../core/execution/executionReadiness';
import {
  markSecurityGateReady,
  resetSecurityGate,
} from '../lib/securityGate';
import { MANIFEST_CONSTANTS } from '../providers/registry/providerManifest';

function transferAction() {
  const now = Date.now();
  return {
    actionType: 'TRANSFER' as const,
    actionId: 'phase4c-transfer',
    createdAt: now,
    chainId: MANIFEST_CONSTANTS.ARC_TESTNET_CHAIN_ID,
    provenance: { source: 'USER_DIRECT' as const, fetchedAt: now },
    tokenAddress: MANIFEST_CONSTANTS.ARC_TESTNET_USDC.toLowerCase(),
    tokenDecimals: 6,
    amount: 1_000_000n,
    from: '0x1111111111111111111111111111111111111111',
    to: '0x2222222222222222222222222222222222222222',
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  resetSecurityGate();
  vi.clearAllTimers();
});

describe('Phase 4C execution readiness boundary', () => {
  it('blocks before security initialization is READY', () => {
    expect(() =>
      assertExecutionReady({
        action: transferAction(),
        providerId: 'arc-erc20-transfer',
        providerCapability: 'TRANSFER',
        assetAddress: MANIFEST_CONSTANTS.ARC_TESTNET_USDC,
        runtimeEnvironment: 'testnet',
      }),
    ).toThrow(/security/i);
  });

  it('allows an enabled healthy transfer provider after the gate is READY', () => {
    markSecurityGateReady();

    const result = assertExecutionReady({
      action: transferAction(),
      providerId: 'arc-erc20-transfer',
      providerCapability: 'TRANSFER',
      assetAddress: MANIFEST_CONSTANTS.ARC_TESTNET_USDC,
      runtimeEnvironment: 'testnet',
    });

    expect(result.providerId).toBe('arc-erc20-transfer');
    expect(result.providerEligibility?.status).toBe('ELIGIBLE');
  });

  it('blocks an implemented but disabled App Kit provider before any signature', () => {
    markSecurityGateReady();

    const action = {
      ...transferAction(),
      actionType: 'BRIDGE' as const,
      actionId: 'phase4c-bridge',
      sourceChainId: MANIFEST_CONSTANTS.ARC_TESTNET_CHAIN_ID,
      destinationChainId: MANIFEST_CONSTANTS.ETH_SEPOLIA_CHAIN_ID,
      providerId: 'circle-appkit-bridge',
      quoteExpiresAt: Date.now() + 120_000,
    };

    expect(() =>
      assertExecutionReady({
        action,
        providerId: 'circle-appkit-bridge',
        providerCapability: 'BRIDGE',
        assetAddress: MANIFEST_CONSTANTS.ARC_TESTNET_USDC,
        runtimeEnvironment: 'testnet',
      }),
    ).toThrow(/DISABLED|not execution-ready/i);
  });
});
