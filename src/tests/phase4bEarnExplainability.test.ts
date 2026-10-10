import { describe, expect, it } from 'vitest';
import {
  assertEarnExplainabilityComplete,
  evaluateEarnExplainability,
} from '../core/earn/earnExplainability';

const completeEvidence = {
  vaultAddress: '0x1111111111111111111111111111111111111111',
  providerId: 'circle-appkit-earn',
  chain: 'Arc_Testnet',
  asset: 'USDC',
  amount: '10',
  apyCurrent: 0.052,
  apyVerifiedAt: '2026-10-10T04:00:00.000Z',
  apySourceUrl: 'https://example.com/vault-metadata',
  yieldMechanism: 'The vault lends deposited USDC according to the provider strategy.',
  positionReceived: 'vault shares representing the deposit position',
  withdrawalAvailability: 'Withdrawals are available through the vault withdrawal flow.',
  withdrawalDelay: 'No delay was reported by the verified metadata.',
  withdrawalLimits: 'Subject to current vault liquidity and provider limits.',
  fees: 'Use the verified provider fee fields shown in the review.',
  liquidity: 'Use current verified vault liquidity shown in the review.',
  riskSummary: 'Variable yield, smart-contract, liquidity, and provider risks apply.',
  provenance: {
    sourceUrl: 'https://example.com/vault-metadata',
    verifiedAt: '2026-10-10T04:00:00.000Z',
  },
};

describe('Phase 4B Earn explainability gate', () => {
  it('allows execution only when all required evidence is present', () => {
    const result = evaluateEarnExplainability(completeEvidence);
    expect(result.executable).toBe(true);
    expect(result.missing).toEqual([]);
    expect(result.answers.whereIsMyMoneyGoing).toContain('10 USDC');
    expect(result.answers.howCanItEarnMoney).toContain('0.052');
  });

  it('blocks when APY has no timestamp/source', () => {
    const result = evaluateEarnExplainability({
      ...completeEvidence,
      apyVerifiedAt: null,
      apySourceUrl: null,
    });
    expect(result.executable).toBe(false);
    expect(result.missing).toContain('apyVerifiedAt');
    expect(result.missing).toContain('apySourceUrl');
  });

  it('blocks when yield mechanism is missing instead of guessing', () => {
    const result = evaluateEarnExplainability({
      ...completeEvidence,
      yieldMechanism: '',
    });
    expect(result.executable).toBe(false);
    expect(result.answers.howCanItEarnMoney).toBeNull();
  });

  it('blocks when risk/liquidity/fees cannot be explained', () => {
    const result = evaluateEarnExplainability({
      ...completeEvidence,
      riskSummary: null,
      liquidity: null,
      fees: null,
    });
    expect(result.executable).toBe(false);
    expect(result.answers.whatCanGoWrong).toBeNull();
  });

  it('throws before execution when evidence is incomplete', () => {
    expect(() =>
      assertEarnExplainabilityComplete({
        ...completeEvidence,
        withdrawalAvailability: null,
      }),
    ).toThrow(/Earn deposit blocked/i);
  });
});
