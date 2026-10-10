import { describe, expect, it } from 'vitest';
import {
  buildRegistryRoutePlan,
  generateRegistryRouteCandidates,
} from '../core/router/registryRouteCandidates';

const arcTestnet = {
  networkId: 'arc-testnet',
  displayName: 'Arc Testnet',
  family: 'EVM' as const,
  chainId: 5042002,
};

const ethSepolia = {
  networkId: 'ethereum-sepolia',
  displayName: 'Ethereum Sepolia',
  family: 'EVM' as const,
  chainId: 11155111,
};

const baseSepolia = {
  networkId: 'base-sepolia',
  displayName: 'Base Sepolia',
  family: 'EVM' as const,
  chainId: 84532,
};

describe('Phase 4B registry-derived routing', () => {
  it('builds bridge candidates from the provider registry', () => {
    const candidates = generateRegistryRouteCandidates({
      capability: 'BRIDGE',
      source: arcTestnet,
      destination: ethSepolia,
      assetAddress: '0x3600000000000000000000000000000000000000',
      runtimeEnvironment: 'testnet',
      providerFacts: {
        'cctp-v2-bridge': {
          allowance: 'SUFFICIENT',
          destinationRelayAvailable: true,
          sourceSwitchAutomated: true,
        },
      },
    });

    expect(candidates.some((candidate) => candidate.providerId === 'cctp-v2-bridge')).toBe(true);
    const enabled = candidates.find((candidate) => candidate.providerId === 'cctp-v2-bridge');
    expect(enabled?.eligible).toBe(true);
    expect(enabled?.ux.veyraAddedSignatures).toBe(0);
    expect(enabled?.ux.manualNetworkSwitches).toBe(0);
  });

  it('keeps implemented App Kit bridge candidate fail-closed', () => {
    const candidates = generateRegistryRouteCandidates({
      capability: 'BRIDGE',
      source: arcTestnet,
      destination: baseSepolia,
      assetAddress: '0x3600000000000000000000000000000000000000',
      runtimeEnvironment: 'testnet',
    });

    const appKit = candidates.find((candidate) => candidate.providerId === 'circle-appkit-bridge');
    expect(appKit).toBeDefined();
    expect(appKit?.eligible).toBe(false);
    expect(appKit?.rejectionReason).toBe('DISABLED');
  });

  it('does not invent fee or ETA when runtime facts are missing', () => {
    const candidates = generateRegistryRouteCandidates({
      capability: 'BRIDGE',
      source: arcTestnet,
      destination: ethSepolia,
      assetAddress: '0x3600000000000000000000000000000000000000',
    });
    const cctp = candidates.find((candidate) => candidate.providerId === 'cctp-v2-bridge');
    expect(cctp?.cost.feeUsd).toBeUndefined();
    expect(cctp?.cost.etaSeconds).toBeUndefined();
    expect(cctp?.explanation).toMatch(/fee unavailable/i);
    expect(cctp?.explanation).toMatch(/eta unavailable/i);
  });

  it('selects the enabled CCTP route while disabled App Kit stays rejected', () => {
    const plan = buildRegistryRoutePlan({
      capability: 'BRIDGE',
      source: arcTestnet,
      destination: ethSepolia,
      assetAddress: '0x3600000000000000000000000000000000000000',
      providerFacts: {
        'cctp-v2-bridge': {
          allowance: 'SUFFICIENT',
          destinationRelayAvailable: true,
          sourceSwitchAutomated: true,
          cost: { feeUsd: 0.25, etaSeconds: 60 },
        },
        'circle-appkit-bridge': {
          allowance: 'SUFFICIENT',
          destinationRelayAvailable: true,
          sourceSwitchAutomated: true,
          cost: { feeUsd: 0.01, etaSeconds: 10 },
        },
      },
    });

    expect(plan.selected?.providerId).toBe('cctp-v2-bridge');
    expect(plan.rejected.some((candidate) => candidate.providerId === 'circle-appkit-bridge')).toBe(true);
  });

  it('uses requested Earn operation instead of mixing discover/deposit providers', () => {
    const candidates = generateRegistryRouteCandidates({
      capability: 'EARN',
      operation: 'EARN_DEPOSIT',
      source: arcTestnet,
      assetAddress: '0x3600000000000000000000000000000000000000',
    });

    expect(candidates.every((candidate) => candidate.capability === 'EARN')).toBe(true);
    const appKit = candidates.find((candidate) => candidate.providerId === 'circle-appkit-earn');
    expect(appKit).toBeDefined();
    expect(appKit?.eligible).toBe(false);
  });
});
