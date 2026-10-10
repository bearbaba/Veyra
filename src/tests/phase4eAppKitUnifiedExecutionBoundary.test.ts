import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EIP1193Provider } from 'viem';
import type { BridgeAction } from '../core/actions/actionSchema';
import {
  assertUnifiedSpendMatchesAction,
  depositUnifiedUsdc,
  spendUnifiedUsdcForwarded,
} from '../providers/appkit/appKitAdapter';
import { MANIFEST_CONSTANTS } from '../providers/registry/providerManifest';
import {
  markSecurityGateReady,
  resetSecurityGate,
} from '../lib/securityGate';

const WALLET = '0x1111111111111111111111111111111111111111';
const RECIPIENT = '0x2222222222222222222222222222222222222222';

function unifiedSpendAction(
  overrides: Partial<BridgeAction> = {},
): BridgeAction {
  const now = Date.now();
  return {
    actionType: 'BRIDGE',
    actionId: 'phase4e-unified-spend',
    createdAt: now,
    chainId: MANIFEST_CONSTANTS.ARC_TESTNET_CHAIN_ID,
    provenance: {
      source: 'PROVIDER_QUOTE',
      fetchedAt: now,
      providerId: 'circle-appkit-unified-balance',
    },
    sourceChainId: MANIFEST_CONSTANTS.ARC_TESTNET_CHAIN_ID,
    destinationChainId: MANIFEST_CONSTANTS.ETH_SEPOLIA_CHAIN_ID,
    tokenAddress: MANIFEST_CONSTANTS.ARC_TESTNET_USDC.toLowerCase(),
    tokenDecimals: 6,
    amount: 1_000_000n,
    from: WALLET,
    to: RECIPIENT,
    providerId: 'circle-appkit-unified-balance',
    quoteExpiresAt: now + 120_000,
    ...overrides,
  };
}

beforeEach(() => {
  resetSecurityGate();
});

describe('Phase 4E App Kit Unified execution boundary', () => {
  it('binds forwarded Unified spend to the deterministic BridgeAction', () => {
    expect(() =>
      assertUnifiedSpendMatchesAction({
        sourceChain: 'Arc_Testnet',
        destinationChain: 'Ethereum_Sepolia',
        recipientAddress: RECIPIENT,
        amount: '1',
        action: unifiedSpendAction(),
      }),
    ).not.toThrow();
  });

  it('rejects a Unified spend recipient mismatch', () => {
    expect(() =>
      assertUnifiedSpendMatchesAction({
        sourceChain: 'Arc_Testnet',
        destinationChain: 'Ethereum_Sepolia',
        recipientAddress: '0x3333333333333333333333333333333333333333',
        amount: '1',
        action: unifiedSpendAction(),
      }),
    ).toThrow(/recipient does not match/i);
  });

  it('blocks disabled Unified spend before wallet reads or switching', async () => {
    markSecurityGateReady();
    const request = vi.fn();
    const ensureSourceChain = vi.fn();

    await expect(
      spendUnifiedUsdcForwarded({
        provider: { request } as unknown as EIP1193Provider,
        sourceChain: 'Arc_Testnet',
        destinationChain: 'Ethereum_Sepolia',
        recipientAddress: RECIPIENT,
        amount: '1',
        action: unifiedSpendAction(),
        runtimeEnvironment: 'testnet',
        ensureSourceChain,
      }),
    ).rejects.toThrow(/DISABLED|not execution-ready/i);

    expect(request).not.toHaveBeenCalled();
    expect(ensureSourceChain).not.toHaveBeenCalled();
  });

  it('keeps raw Unified deposit fail-closed before any provider call', async () => {
    const request = vi.fn();
    const ensureSourceChain = vi.fn();

    await expect(
      depositUnifiedUsdc({
        provider: { request } as unknown as EIP1193Provider,
        sourceChain: 'Arc_Testnet',
        amount: '1',
        ensureSourceChain,
      }),
    ).rejects.toThrow(/canonical Veyra Unified-deposit action/i);

    expect(request).not.toHaveBeenCalled();
    expect(ensureSourceChain).not.toHaveBeenCalled();
  });
});
