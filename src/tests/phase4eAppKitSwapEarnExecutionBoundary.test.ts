import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EIP1193Provider } from 'viem';
import type {
  ConvertAction,
  SupplyAction,
  WithdrawAction,
} from '../core/actions/actionSchema';
import {
  assertReviewedAppKitSwapMatchesAction,
  assertReviewedSwapFeeMatchesCurrentPolicy,
  assertReviewedEarnDepositMatchesAction,
  assertReviewedEarnWithdrawalMatchesAction,
  executeEarnDeposit,
  executeEarnWithdrawal,
  executeReviewedAppKitSwap,
  type ReviewedAppKitEarnDeposit,
  type ReviewedAppKitEarnWithdrawal,
  type ReviewedAppKitSwap,
} from '../providers/appkit/appKitAdapter';
import { MANIFEST_CONSTANTS } from '../providers/registry/providerManifest';
import {
  markSecurityGateReady,
  resetSecurityGate,
} from '../lib/securityGate';
import type { EarnExplainabilityInput } from '../core/earn/earnExplainability';
import { quoteVeyraFee } from '../core/fees/feeEngine';
import { VEYRA_TESTNET_TREASURY_ADDRESS } from '../core/fees/treasuryConfig';

const WALLET = '0x1111111111111111111111111111111111111111';
const VAULT = '0x4444444444444444444444444444444444444444';

function swapAction(overrides: Partial<ConvertAction> = {}): ConvertAction {
  const now = Date.now();
  return {
    actionType: 'CONVERT',
    actionId: 'phase4e-appkit-swap',
    createdAt: now,
    chainId: MANIFEST_CONSTANTS.ARC_TESTNET_CHAIN_ID,
    provenance: {
      source: 'PROVIDER_QUOTE',
      fetchedAt: now,
      providerId: 'circle-appkit-swap',
      quoteId: 'appkit-swap-review',
    },
    fromTokenAddress: MANIFEST_CONSTANTS.ARC_TESTNET_USDC.toLowerCase(),
    toTokenAddress: MANIFEST_CONSTANTS.ARC_TESTNET_EURC.toLowerCase(),
    fromTokenDecimals: 6,
    toTokenDecimals: 6,
    amountIn: 1_000_000n,
    minAmountOut: 900_000n,
    slippageBps: 100,
    quoteExpiresAt: now + 120_000,
    providerId: 'circle-appkit-swap',
    ...overrides,
  };
}

function reviewedSwap(
  overrides: Partial<ReviewedAppKitSwap['request']> = {},
): ReviewedAppKitSwap {
  return {
    request: {
      chain: 'Arc_Testnet',
      tokenIn: 'USDC',
      tokenOut: 'EURC',
      amountIn: '1',
      slippageBps: 100,
      veyraFee: quoteVeyraFee({
        capability: 'SWAP',
        providerId: 'circle-appkit-swap',
        environment: 'testnet',
        treasuryAddress: VEYRA_TESTNET_TREASURY_ADDRESS,
      }),
      ...overrides,
    },
    estimate: {} as ReviewedAppKitSwap['estimate'],
  };
}

function earnExplainability(
  overrides: Partial<EarnExplainabilityInput> = {},
): EarnExplainabilityInput {
  return {
    vaultAddress: VAULT,
    providerId: 'circle-appkit-earn',
    chain: 'Arc_Testnet',
    asset: 'USDC',
    amount: '1',
    apyCurrent: 0.05,
    apyVerifiedAt: '2026-10-10T07:00:00.000Z',
    apySourceUrl: 'https://example.com/vault',
    yieldMechanism: 'Verified vault strategy.',
    positionReceived: 'Vault shares.',
    withdrawalAvailability: 'Withdrawal is available through the vault flow.',
    withdrawalDelay: 'No delay reported by verified metadata.',
    withdrawalLimits: 'Subject to verified vault liquidity limits.',
    fees: 'Verified provider fees shown at review.',
    liquidity: 'Verified vault liquidity shown at review.',
    riskSummary: 'Variable yield, smart-contract and liquidity risks apply.',
    provenance: {
      sourceUrl: 'https://example.com/vault',
      verifiedAt: '2026-10-10T07:00:00.000Z',
    },
    ...overrides,
  };
}

function supplyAction(overrides: Partial<SupplyAction> = {}): SupplyAction {
  const now = Date.now();
  return {
    actionType: 'SUPPLY',
    actionId: 'phase4e-earn-deposit',
    createdAt: now,
    chainId: MANIFEST_CONSTANTS.ARC_TESTNET_CHAIN_ID,
    provenance: {
      source: 'PROVIDER_QUOTE',
      fetchedAt: now,
      providerId: 'circle-appkit-earn',
    },
    tokenAddress: MANIFEST_CONSTANTS.ARC_TESTNET_USDC.toLowerCase(),
    tokenDecimals: 6,
    amount: 1_000_000n,
    from: WALLET,
    protocolAddress: VAULT,
    providerId: 'circle-appkit-earn',
    ...overrides,
  };
}

function withdrawAction(overrides: Partial<WithdrawAction> = {}): WithdrawAction {
  const now = Date.now();
  return {
    actionType: 'WITHDRAW',
    actionId: 'phase4e-earn-withdraw',
    createdAt: now,
    chainId: MANIFEST_CONSTANTS.ARC_TESTNET_CHAIN_ID,
    provenance: {
      source: 'PROVIDER_QUOTE',
      fetchedAt: now,
      providerId: 'circle-appkit-earn',
    },
    tokenAddress: MANIFEST_CONSTANTS.ARC_TESTNET_USDC.toLowerCase(),
    tokenDecimals: 6,
    amount: 1_000_000n,
    to: WALLET,
    protocolAddress: VAULT,
    providerId: 'circle-appkit-earn',
    ...overrides,
  };
}

function reviewedDeposit(
  overrides: Partial<ReviewedAppKitEarnDeposit['request']> = {},
): ReviewedAppKitEarnDeposit {
  return {
    request: {
      chain: 'Arc_Testnet',
      vaultAddress: VAULT,
      amount: '1',
      ...overrides,
    },
    quote: {} as ReviewedAppKitEarnDeposit['quote'],
  };
}

function reviewedWithdrawal(
  overrides: Partial<ReviewedAppKitEarnWithdrawal['request']> = {},
): ReviewedAppKitEarnWithdrawal {
  return {
    request: {
      chain: 'Arc_Testnet',
      vaultAddress: VAULT,
      amount: '1',
      ...overrides,
    },
    quote: {} as ReviewedAppKitEarnWithdrawal['quote'],
  };
}

beforeEach(() => {
  resetSecurityGate();
});

describe('Phase 4E App Kit swap execution boundary', () => {
  it('binds the reviewed swap to the deterministic ConvertAction', () => {
    expect(() =>
      assertReviewedAppKitSwapMatchesAction(reviewedSwap(), swapAction()),
    ).not.toThrow();
  });

  it('rejects a swap review/action amount mismatch', () => {
    expect(() =>
      assertReviewedAppKitSwapMatchesAction(
        reviewedSwap({ amountIn: '2' }),
        swapAction(),
      ),
    ).toThrow(/amount does not match/i);
  });

  it('rejects a tampered reviewed fee recipient before execution', () => {
    const base = reviewedSwap();
    const tampered = reviewedSwap({
      veyraFee: {
        ...base.request.veyraFee,
        treasuryAddress: '0x5555555555555555555555555555555555555555',
      },
    });

    expect(() =>
      assertReviewedSwapFeeMatchesCurrentPolicy(tampered, 'testnet'),
    ).toThrow(/fee.*policy|fresh review/i);
  });

  it('blocks disabled App Kit swap before wallet reads or switching', async () => {
    markSecurityGateReady();
    const request = vi.fn();
    const ensureSourceChain = vi.fn();

    await expect(
      executeReviewedAppKitSwap({
        provider: { request } as unknown as EIP1193Provider,
        reviewed: reviewedSwap(),
        action: swapAction(),
        walletAddress: WALLET,
        runtimeEnvironment: 'testnet',
        ensureSourceChain,
      }),
    ).rejects.toThrow(/DISABLED|not execution-ready/i);

    expect(request).not.toHaveBeenCalled();
    expect(ensureSourceChain).not.toHaveBeenCalled();
  });
});

describe('Phase 4E App Kit Earn execution boundary', () => {
  it('binds Earn deposit review and explainability to the SupplyAction', () => {
    expect(() =>
      assertReviewedEarnDepositMatchesAction(
        reviewedDeposit(),
        supplyAction(),
        earnExplainability(),
      ),
    ).not.toThrow();
  });

  it('binds Earn withdrawal review and explainability to the WithdrawAction', () => {
    expect(() =>
      assertReviewedEarnWithdrawalMatchesAction(
        reviewedWithdrawal(),
        withdrawAction(),
        earnExplainability(),
      ),
    ).not.toThrow();
  });

  it('blocks disabled Earn deposit before wallet reads or switching', async () => {
    markSecurityGateReady();
    const request = vi.fn();
    const ensureSourceChain = vi.fn();

    await expect(
      executeEarnDeposit({
        provider: { request } as unknown as EIP1193Provider,
        reviewed: reviewedDeposit(),
        action: supplyAction(),
        explainability: earnExplainability(),
        runtimeEnvironment: 'testnet',
        ensureSourceChain,
      }),
    ).rejects.toThrow(/DISABLED|not execution-ready/i);

    expect(request).not.toHaveBeenCalled();
    expect(ensureSourceChain).not.toHaveBeenCalled();
  });

  it('blocks disabled Earn withdrawal before wallet reads or switching', async () => {
    markSecurityGateReady();
    const request = vi.fn();
    const ensureSourceChain = vi.fn();

    await expect(
      executeEarnWithdrawal({
        provider: { request } as unknown as EIP1193Provider,
        reviewed: reviewedWithdrawal(),
        action: withdrawAction(),
        explainability: earnExplainability(),
        runtimeEnvironment: 'testnet',
        ensureSourceChain,
      }),
    ).rejects.toThrow(/DISABLED|not execution-ready/i);

    expect(request).not.toHaveBeenCalled();
    expect(ensureSourceChain).not.toHaveBeenCalled();
  });
});
