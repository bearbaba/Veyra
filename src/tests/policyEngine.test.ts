/**
 * Tests: src/core/policy/policyEngine.ts
 */
import { describe, it, expect } from 'vitest';
import { evaluatePolicy, DEFAULT_VEYRA_POLICY } from '../core/policy/policyEngine.js';
import type { VeyraPolicy } from '../core/policy/policyTypes.js';
import type { TransferAction } from '../core/actions/actionSchema.js';

const ARC_TESTNET_CHAIN_ID = 5042002;
const USDC_ADDRESS = '0x3600000000000000000000000000000000000000';
const RECIPIENT = '0x1234567890123456789012345678901234567890';

function freshTransfer(overrides: Partial<TransferAction> = {}): TransferAction {
  return {
    actionType: 'TRANSFER',
    actionId: 'policy-test-1',
    chainId: ARC_TESTNET_CHAIN_ID,
    createdAt: Date.now(),
    provenance: { source: 'USER_DIRECT', fetchedAt: Date.now() },
    tokenAddress: USDC_ADDRESS,
    tokenDecimals: 6,
    amount: 10_000_000n, // 10 USDC
    from: RECIPIENT,
    to: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
    ...overrides,
  };
}

function goodContext() {
  return {
    currentBalanceBaseUnits: 100_000_000n, // 100 USDC
    dailySpentBaseUnits: 0n,
    riskScore: 10,
    simulationCompleted: true,
    quoteId: 'q-1',
    contractAddresses: [USDC_ADDRESS],
  };
}

const MINIMAL_POLICY: VeyraPolicy = {
  policyId: 'minimal-test',
  displayName: 'Minimal Test Policy',
  enabled: true,
  createdAt: 0,
  updatedAt: 0,
  rules: [
    { ruleId: 'STALE_DATA_BLOCK', maxAgeMs: 30_000 },
  ],
};

describe('evaluatePolicy — STALE_DATA_BLOCK', () => {
  it('PASS for fresh action', () => {
    const result = evaluatePolicy(freshTransfer(), goodContext(), MINIMAL_POLICY);
    expect(result.decision).toBe('PASS');
  });

  it('BLOCKED for stale action', () => {
    const stale = freshTransfer({
      provenance: { source: 'USER_DIRECT', fetchedAt: Date.now() - 60_000 },
    });
    const result = evaluatePolicy(stale, goodContext(), MINIMAL_POLICY);
    expect(result.decision).toBe('BLOCKED');
    expect(result.blockedBy).toContain('STALE_DATA_BLOCK');
  });
});

describe('evaluatePolicy — EXPIRED_QUOTE_BLOCK', () => {
  const policy: VeyraPolicy = {
    ...MINIMAL_POLICY,
    policyId: 'quote-test',
    rules: [{ ruleId: 'EXPIRED_QUOTE_BLOCK', bufferMs: 10_000 }],
  };

  it('PASS for non-CONVERT/BRIDGE action (rule is N/A)', () => {
    const result = evaluatePolicy(freshTransfer(), goodContext(), policy);
    expect(result.decision).toBe('PASS');
  });
});

describe('evaluatePolicy — QUOTE_REPLAY_BLOCK', () => {
  const policy: VeyraPolicy = {
    ...MINIMAL_POLICY,
    policyId: 'replay-test',
    rules: [{ ruleId: 'QUOTE_REPLAY_BLOCK' }],
  };

  it('PASS when quoteId is normal', () => {
    const result = evaluatePolicy(freshTransfer(), { ...goodContext(), quoteId: 'normal-id' }, policy);
    expect(result.decision).toBe('PASS');
  });

  it('BLOCKED when quoteId is REPLAYED sentinel', () => {
    const result = evaluatePolicy(freshTransfer(), { ...goodContext(), quoteId: 'REPLAYED' }, policy);
    expect(result.decision).toBe('BLOCKED');
    expect(result.blockedBy).toContain('QUOTE_REPLAY_BLOCK');
  });
});

describe('evaluatePolicy — MAX_SLIPPAGE', () => {
  const policy: VeyraPolicy = {
    ...MINIMAL_POLICY,
    policyId: 'slippage-test',
    rules: [{ ruleId: 'MAX_SLIPPAGE', maxSlippageBps: 100 }],
  };

  it('PASS for TRANSFER (slippage not applicable)', () => {
    const result = evaluatePolicy(freshTransfer(), goodContext(), policy);
    expect(result.decision).toBe('PASS');
  });
});

describe('evaluatePolicy — MAX_SINGLE_TX_AMOUNT', () => {
  const policy: VeyraPolicy = {
    ...MINIMAL_POLICY,
    policyId: 'max-tx-test',
    rules: [{
      ruleId: 'MAX_SINGLE_TX_AMOUNT',
      maxAmountBaseUnits: 100_000_000n, // 100 USDC
      actionTypes: ['TRANSFER'],
    }],
  };

  it('PASS for small amount', () => {
    const result = evaluatePolicy(freshTransfer({ amount: 1_000_000n }), goodContext(), policy);
    expect(result.decision).toBe('PASS');
  });

  it('NEEDS_CONFIRMATION for amount above 50% threshold', () => {
    const result = evaluatePolicy(freshTransfer({ amount: 60_000_000n }), goodContext(), policy);
    expect(result.decision).toBe('NEEDS_CONFIRMATION');
    expect(result.confirmationRequired).toContain('MAX_SINGLE_TX_AMOUNT');
  });

  it('BLOCKED for amount above maximum', () => {
    const result = evaluatePolicy(freshTransfer({ amount: 200_000_000n }), goodContext(), policy);
    expect(result.decision).toBe('BLOCKED');
    expect(result.blockedBy).toContain('MAX_SINGLE_TX_AMOUNT');
  });
});

describe('evaluatePolicy — SIMULATION_REQUIRED', () => {
  const policy: VeyraPolicy = {
    ...MINIMAL_POLICY,
    policyId: 'sim-test',
    rules: [{
      ruleId: 'SIMULATION_REQUIRED',
      requiredForActionTypes: ['TRANSFER'],
    }],
  };

  it('PASS when simulation completed', () => {
    const result = evaluatePolicy(freshTransfer(), { ...goodContext(), simulationCompleted: true }, policy);
    expect(result.decision).toBe('PASS');
  });

  it('BLOCKED when simulation not completed', () => {
    const result = evaluatePolicy(freshTransfer(), { ...goodContext(), simulationCompleted: false }, policy);
    expect(result.decision).toBe('BLOCKED');
    expect(result.blockedBy).toContain('SIMULATION_REQUIRED');
  });
});

describe('evaluatePolicy — MAX_RISK', () => {
  const policy: VeyraPolicy = {
    ...MINIMAL_POLICY,
    policyId: 'risk-test',
    rules: [{ ruleId: 'MAX_RISK', maxRiskScore: 70 }],
  };

  it('PASS for low risk score', () => {
    const result = evaluatePolicy(freshTransfer(), { ...goodContext(), riskScore: 10 }, policy);
    expect(result.decision).toBe('PASS');
  });

  it('NEEDS_CONFIRMATION for score above threshold but below max', () => {
    const result = evaluatePolicy(freshTransfer(), { ...goodContext(), riskScore: 60 }, policy);
    expect(result.decision).toBe('NEEDS_CONFIRMATION');
  });

  it('BLOCKED for score above maximum', () => {
    const result = evaluatePolicy(freshTransfer(), { ...goodContext(), riskScore: 80 }, policy);
    expect(result.decision).toBe('BLOCKED');
    expect(result.blockedBy).toContain('MAX_RISK');
  });

  it('BLOCKED when riskScore is undefined', () => {
    const { riskScore: _, ...ctx } = goodContext();
    const result = evaluatePolicy(freshTransfer(), ctx, policy);
    expect(result.decision).toBe('BLOCKED');
  });
});

describe('evaluatePolicy — ALLOWED_CHAINS', () => {
  const policy: VeyraPolicy = {
    ...MINIMAL_POLICY,
    policyId: 'chain-test',
    rules: [{ ruleId: 'ALLOWED_CHAINS', allowedChainIds: [ARC_TESTNET_CHAIN_ID] }],
  };

  it('PASS for allowed chain', () => {
    const result = evaluatePolicy(freshTransfer(), goodContext(), policy);
    expect(result.decision).toBe('PASS');
  });

  it('BLOCKED for disallowed chain', () => {
    const result = evaluatePolicy(freshTransfer({ chainId: 1 }), goodContext(), policy);
    expect(result.decision).toBe('BLOCKED');
    expect(result.blockedBy).toContain('ALLOWED_CHAINS');
  });
});

describe('evaluatePolicy — disabled policy', () => {
  it('PASS when policy is disabled (all rules skipped)', () => {
    const disabled = { ...DEFAULT_VEYRA_POLICY, enabled: false };
    const result = evaluatePolicy(freshTransfer(), goodContext(), disabled);
    expect(result.decision).toBe('PASS');
  });
});

describe('evaluatePolicy — worst decision aggregation', () => {
  it('BLOCKED wins over NEEDS_CONFIRMATION', () => {
    const policy: VeyraPolicy = {
      ...MINIMAL_POLICY,
      policyId: 'agg-test',
      rules: [
        { ruleId: 'MAX_SINGLE_TX_AMOUNT', maxAmountBaseUnits: 100_000_000n, actionTypes: ['TRANSFER'] },
        { ruleId: 'SIMULATION_REQUIRED', requiredForActionTypes: ['TRANSFER'] },
      ],
    };
    // 60 USDC → NEEDS_CONFIRMATION from MAX_SINGLE_TX, simulationCompleted=false → BLOCKED
    const result = evaluatePolicy(
      freshTransfer({ amount: 60_000_000n }),
      { ...goodContext(), simulationCompleted: false },
      policy,
    );
    expect(result.decision).toBe('BLOCKED');
  });
});
