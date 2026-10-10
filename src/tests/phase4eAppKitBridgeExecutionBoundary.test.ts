import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EIP1193Provider } from 'viem';
import {
  assertReviewedAppKitBridgeMatchesAction,
  executeReviewedAppKitBridge,
  type ReviewedAppKitBridge,
} from '../providers/appkit/appKitAdapter';
import { MANIFEST_CONSTANTS } from '../providers/registry/providerManifest';
import {
  markSecurityGateReady,
  resetSecurityGate,
} from '../lib/securityGate';
import type { BridgeAction } from '../core/actions/actionSchema';

function action(overrides: Partial<BridgeAction> = {}): BridgeAction {
  const now = Date.now();
  return {
    actionType: 'BRIDGE',
    actionId: 'phase4e-appkit-bridge',
    createdAt: now,
    chainId: MANIFEST_CONSTANTS.ARC_TESTNET_CHAIN_ID,
    provenance: {
      source: 'PROVIDER_QUOTE',
      fetchedAt: now,
      providerId: 'circle-appkit-bridge',
    },
    sourceChainId: MANIFEST_CONSTANTS.ARC_TESTNET_CHAIN_ID,
    destinationChainId: MANIFEST_CONSTANTS.ETH_SEPOLIA_CHAIN_ID,
    tokenAddress: MANIFEST_CONSTANTS.ARC_TESTNET_USDC.toLowerCase(),
    tokenDecimals: 6,
    amount: 1_000_000n,
    from: '0x1111111111111111111111111111111111111111',
    to: '0x2222222222222222222222222222222222222222',
    providerId: 'circle-appkit-bridge',
    quoteExpiresAt: now + 120_000,
    ...overrides,
  };
}

function reviewed(
  overrides: Partial<ReviewedAppKitBridge['request']> = {},
): ReviewedAppKitBridge {
  return {
    request: {
      sourceChain: 'Arc_Testnet',
      destinationChain: 'Ethereum_Sepolia',
      amount: '1',
      token: 'USDC',
      recipientAddress: '0x2222222222222222222222222222222222222222',
      useForwarder: true,
      ...overrides,
    },
    estimate: {} as ReviewedAppKitBridge['estimate'],
  };
}

beforeEach(() => {
  resetSecurityGate();
});

describe('Phase 4E App Kit bridge execution boundary', () => {
  it('accepts an exact review/action binding', () => {
    expect(() =>
      assertReviewedAppKitBridgeMatchesAction(reviewed(), action()),
    ).not.toThrow();
  });

  it('rejects a reviewed amount that differs from the deterministic action', () => {
    expect(() =>
      assertReviewedAppKitBridgeMatchesAction(
        reviewed({ amount: '2' }),
        action(),
      ),
    ).toThrow(/amount does not match/i);
  });

  it('rejects a reviewed recipient that differs from the deterministic action', () => {
    expect(() =>
      assertReviewedAppKitBridgeMatchesAction(
        reviewed({
          recipientAddress: '0x3333333333333333333333333333333333333333',
        }),
        action(),
      ),
    ).toThrow(/recipient does not match/i);
  });

  it('rejects a cross-chain USDC deployment mismatch', () => {
    expect(() =>
      assertReviewedAppKitBridgeMatchesAction(
        reviewed(),
        action({
          tokenAddress: MANIFEST_CONSTANTS.ETH_SEPOLIA_USDC.toLowerCase(),
        }),
      ),
    ).toThrow(/source-chain USDC/i);
  });

  it('blocks the disabled App Kit bridge before wallet reads or switching', async () => {
    markSecurityGateReady();

    const request = vi.fn();
    const ensureSourceChain = vi.fn();
    const provider = { request } as unknown as EIP1193Provider;

    await expect(
      executeReviewedAppKitBridge({
        provider,
        reviewed: reviewed(),
        action: action(),
        runtimeEnvironment: 'testnet',
        ensureSourceChain,
      }),
    ).rejects.toThrow(/DISABLED|not execution-ready/i);

    expect(request).not.toHaveBeenCalled();
    expect(ensureSourceChain).not.toHaveBeenCalled();
  });
});
