/**
 * Tests: src/core/risk/riskEngine.ts
 */
import { describe, it, expect } from 'vitest';
import {
  scoreProvider,
  scoreAction,
  scoreToLevel,
  getProviderRiskProfile,
  STATIC_PROVIDER_RISK_PROFILES,
} from '../core/risk/riskEngine.js';
import type { ActionRiskContext, ProviderRiskProfile } from '../core/risk/riskTypes.js';

function makeProfile(overrides: Partial<ProviderRiskProfile> = {}): ProviderRiskProfile {
  return {
    providerId: 'test-provider',
    audited: true,
    audits: [{ auditorName: 'Trail of Bits', auditDate: '2024-01-01', critical: 0, high: 0, medium: 0 }],
    upgradeable: false,
    hasTimelock: false,
    launchDate: '2022-01-01',
    tvlUsd: 50_000_000,
    incidentCount: 0,
    contractVerified: true,
    oracleDependent: false,
    isOfficialCircleProduct: false,
    healthStatus: 'OK',
    ...overrides,
  };
}

describe('scoreToLevel', () => {
  it('0 → LOW', () => expect(scoreToLevel(0)).toBe('LOW'));
  it('25 → LOW', () => expect(scoreToLevel(25)).toBe('LOW'));
  it('26 → MEDIUM', () => expect(scoreToLevel(26)).toBe('MEDIUM'));
  it('50 → MEDIUM', () => expect(scoreToLevel(50)).toBe('MEDIUM'));
  it('51 → HIGH', () => expect(scoreToLevel(51)).toBe('HIGH'));
  it('75 → HIGH', () => expect(scoreToLevel(75)).toBe('HIGH'));
  it('76 → CRITICAL', () => expect(scoreToLevel(76)).toBe('CRITICAL'));
  it('100 → CRITICAL', () => expect(scoreToLevel(100)).toBe('CRITICAL'));
  it('NaN → UNKNOWN', () => expect(scoreToLevel(NaN)).toBe('UNKNOWN'));
});

describe('scoreProvider — basic scoring', () => {
  it('a fully safe profile scores LOW', () => {
    const result = scoreProvider(makeProfile());
    expect(result.score).toBeLessThanOrEqual(25);
    expect(result.level).toBe('LOW');
  });

  it('unaudited provider scores higher', () => {
    const audited = scoreProvider(makeProfile({ audited: true }));
    const unaudited = scoreProvider(makeProfile({ audited: false, audits: [] }));
    expect(unaudited.score).toBeGreaterThan(audited.score);
  });

  it('upgradeable without timelock increases score', () => {
    const immutable = scoreProvider(makeProfile({ upgradeable: false }));
    const upgradeable = scoreProvider(makeProfile({ upgradeable: true, hasTimelock: false }));
    expect(upgradeable.score).toBeGreaterThan(immutable.score);
  });

  it('incidents increase score', () => {
    const clean = scoreProvider(makeProfile({ incidentCount: 0 }));
    const incidents = scoreProvider(makeProfile({ incidentCount: 3 }));
    expect(incidents.score).toBeGreaterThan(clean.score);
  });

  it('DOWN health drastically increases score', () => {
    const ok = scoreProvider(makeProfile({ healthStatus: 'OK' }));
    const down = scoreProvider(makeProfile({ healthStatus: 'DOWN' }));
    expect(down.score).toBeGreaterThan(ok.score);
    expect(down.score).toBeGreaterThan(35);
  });

  it('official Circle product slightly reduces score but does not force LOW', () => {
    // Start with a medium-risk profile
    const base = makeProfile({
      incidentCount: 2,
      upgradeable: true,
      hasTimelock: false,
      audited: false,
      audits: [],
    });
    const nonOfficial = scoreProvider({ ...base, isOfficialCircleProduct: false });
    const official = scoreProvider({ ...base, isOfficialCircleProduct: true });
    // Official cannot increase score and may decrease slightly
    expect(official.score).toBeLessThanOrEqual(nonOfficial.score);
    // But should NOT force LOW if base score is high
    if (nonOfficial.score > 25) {
      expect(official.score).toBeGreaterThan(25);
    }
  });

  it('includes a factors array', () => {
    const result = scoreProvider(makeProfile());
    expect(result.factors.length).toBeGreaterThan(0);
  });

  it('score is clamped to 0–100', () => {
    const result = scoreProvider(makeProfile({ incidentCount: 100, audited: false, audits: [], upgradeable: true, hasTimelock: false }));
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });
});

describe('scoreAction', () => {
  it('returns CRITICAL with no providers', () => {
    const context: ActionRiskContext = {
      providerProfiles: [],
      chainId: 5042002,
      wasSimulated: true,
    };
    const result = scoreAction(context);
    expect(result.score).toBe(100);
    expect(result.level).toBe('CRITICAL');
  });

  it('simulation absence adds penalty', () => {
    const profile = makeProfile();
    const simulated = scoreAction({ providerProfiles: [profile], chainId: 5042002, wasSimulated: true });
    const unsimulated = scoreAction({ providerProfiles: [profile], chainId: 5042002, wasSimulated: false });
    expect(unsimulated.score).toBeGreaterThan(simulated.score);
  });

  it('worst provider wins in multi-provider scenario', () => {
    const good = makeProfile({ providerId: 'good' });
    const bad = makeProfile({ providerId: 'bad', incidentCount: 5, upgradeable: true, hasTimelock: false, audited: false, audits: [] });
    const result = scoreAction({ providerProfiles: [good, bad], chainId: 5042002, wasSimulated: true });
    const badScore = scoreProvider(bad).score;
    // Overall score should be the bad score (worst case)
    expect(result.score).toBeGreaterThanOrEqual(badScore - 5); // allow minor float diff
  });
});

describe('STATIC_PROVIDER_RISK_PROFILES', () => {
  it('arc-erc20-transfer exists and scores LOW', () => {
    const profile = STATIC_PROVIDER_RISK_PROFILES['arc-erc20-transfer'];
    expect(profile).toBeDefined();
    const result = scoreProvider(profile);
    expect(result.level).toBe('LOW');
  });

  it('viem-simulation exists and scores LOW or MEDIUM', () => {
    const profile = STATIC_PROVIDER_RISK_PROFILES['viem-simulation'];
    expect(profile).toBeDefined();
    const result = scoreProvider(profile);
    expect(['LOW', 'MEDIUM']).toContain(result.level);
  });
});

describe('getProviderRiskProfile', () => {
  it('returns known profile for arc-erc20-transfer', () => {
    const p = getProviderRiskProfile('arc-erc20-transfer');
    expect(p.providerId).toBe('arc-erc20-transfer');
  });

  it('returns high-risk unknown profile for unregistered provider', () => {
    const p = getProviderRiskProfile('totally-fake-provider-xyz');
    expect(p.audited).toBe(false);
    expect(p.isOfficialCircleProduct).toBe(false);
    expect(p.healthStatus).toBe('UNKNOWN');
  });
});
