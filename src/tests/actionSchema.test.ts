/**
 * Tests: src/core/actions/actionSchema.ts
 */
import { describe, it, expect } from 'vitest';
import {
  validateAction,
  assertActionValid,
  type TransferAction,
  type ConvertAction,
  type BridgeAction,
  type ApproveAction,
} from '../core/actions/actionSchema.js';

const ARC_TESTNET_CHAIN_ID = 5042002;
const USDC_ADDRESS = '0x3600000000000000000000000000000000000000';
const RECIPIENT = '0x1234567890123456789012345678901234567890';

function freshProvenance() {
  return {
    source: 'USER_DIRECT' as const,
    fetchedAt: Date.now(),
  };
}

function makeTransfer(overrides: Partial<TransferAction> = {}): TransferAction {
  return {
    actionType: 'TRANSFER',
    actionId: 'test-id-1',
    chainId: ARC_TESTNET_CHAIN_ID,
    createdAt: Date.now(),
    provenance: freshProvenance(),
    tokenAddress: USDC_ADDRESS,
    tokenDecimals: 6,
    amount: 10_000_000n, // 10 USDC
    from: RECIPIENT,
    to: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
    ...overrides,
  };
}

describe('validateAction — TRANSFER', () => {
  it('passes a valid transfer', () => {
    const result = validateAction(makeTransfer());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects zero amount', () => {
    const result = validateAction(makeTransfer({ amount: 0n }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('ZERO_AMOUNT');
  });

  it('rejects invalid token address', () => {
    const result = validateAction(makeTransfer({ tokenAddress: 'not-an-address' }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('INVALID_ADDRESS');
  });

  it('rejects invalid from address', () => {
    const result = validateAction(makeTransfer({ from: '0xshort' }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('INVALID_ADDRESS');
  });

  it('rejects invalid to address', () => {
    const result = validateAction(makeTransfer({ to: 'garbage' }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('INVALID_ADDRESS');
  });

  it('rejects stale provenance', () => {
    const staleProvenance = { source: 'USER_DIRECT' as const, fetchedAt: Date.now() - 60_000 };
    const result = validateAction(makeTransfer({ provenance: staleProvenance }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('STALE_PROVENANCE');
  });
});

describe('validateAction — CONVERT', () => {
  const futureExpiry = Date.now() + 120_000;

  function makeConvert(overrides: Partial<ConvertAction> = {}): ConvertAction {
    return {
      actionType: 'CONVERT',
      actionId: 'convert-1',
      chainId: ARC_TESTNET_CHAIN_ID,
      createdAt: Date.now(),
      provenance: freshProvenance(),
      fromTokenAddress: USDC_ADDRESS,
      toTokenAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
      fromTokenDecimals: 6,
      toTokenDecimals: 6,
      amountIn: 100_000_000n,
      minAmountOut: 99_000_000n,
      slippageBps: 100,
      quoteExpiresAt: futureExpiry,
      providerId: 'circle-swap',
      ...overrides,
    };
  }

  it('passes a valid convert', () => {
    const result = validateAction(makeConvert());
    expect(result.valid).toBe(true);
  });

  it('rejects zero amountIn', () => {
    const result = validateAction(makeConvert({ amountIn: 0n }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('ZERO_AMOUNT');
  });

  it('rejects zero minAmountOut', () => {
    const result = validateAction(makeConvert({ minAmountOut: 0n }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('ZERO_AMOUNT');
  });

  it('rejects expired quote', () => {
    const result = validateAction(makeConvert({ quoteExpiresAt: Date.now() - 1000 }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('EXPIRED_QUOTE');
  });

  it('rejects slippage above hard cap', () => {
    const result = validateAction(makeConvert({ slippageBps: 1000 }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('SLIPPAGE_EXCEEDED');
  });
});

describe('validateAction — BRIDGE', () => {
  function makeBridge(overrides: Partial<BridgeAction> = {}): BridgeAction {
    return {
      actionType: 'BRIDGE',
      actionId: 'bridge-1',
      chainId: ARC_TESTNET_CHAIN_ID,
      createdAt: Date.now(),
      provenance: freshProvenance(),
      sourceChainId: ARC_TESTNET_CHAIN_ID,
      destinationChainId: 84532, // Base Sepolia
      tokenAddress: USDC_ADDRESS,
      tokenDecimals: 6,
      amount: 5_000_000n,
      from: RECIPIENT,
      to: RECIPIENT,
      providerId: 'cctp-bridge',
      quoteExpiresAt: Date.now() + 120_000,
      ...overrides,
    };
  }

  it('passes a valid bridge', () => {
    const result = validateAction(makeBridge());
    expect(result.valid).toBe(true);
  });

  it('rejects same source and destination chain', () => {
    const result = validateAction(makeBridge({
      sourceChainId: ARC_TESTNET_CHAIN_ID,
      destinationChainId: ARC_TESTNET_CHAIN_ID,
    }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('SAME_SOURCE_DESTINATION_CHAIN');
  });

  it('rejects zero amount', () => {
    const result = validateAction(makeBridge({ amount: 0n }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('ZERO_AMOUNT');
  });

  it('rejects expired quote', () => {
    const result = validateAction(makeBridge({ quoteExpiresAt: Date.now() - 1000 }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('EXPIRED_QUOTE');
  });
});

describe('validateAction — APPROVE', () => {
  function makeApprove(overrides: Partial<ApproveAction> = {}): ApproveAction {
    return {
      actionType: 'APPROVE',
      actionId: 'approve-1',
      chainId: ARC_TESTNET_CHAIN_ID,
      createdAt: Date.now(),
      provenance: freshProvenance(),
      tokenAddress: USDC_ADDRESS,
      spenderAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
      amount: 1_000_000n,
      owner: RECIPIENT,
      ...overrides,
    };
  }

  it('passes a valid approve', () => {
    expect(validateAction(makeApprove()).valid).toBe(true);
  });

  it('rejects zero amount', () => {
    expect(validateAction(makeApprove({ amount: 0n })).errors).toContain('ZERO_AMOUNT');
  });

  it('rejects invalid spender address', () => {
    expect(validateAction(makeApprove({ spenderAddress: 'bad' })).errors).toContain('INVALID_ADDRESS');
  });
});

describe('assertActionValid', () => {
  it('does not throw for valid action', () => {
    expect(() => assertActionValid(makeTransfer())).not.toThrow();
  });

  it('throws for invalid action', () => {
    expect(() => assertActionValid(makeTransfer({ amount: 0n }))).toThrow(/invalid action/i);
  });
});
