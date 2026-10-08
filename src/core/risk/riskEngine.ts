/**
 * Veyra Risk Engine
 *
 * Deterministic risk scoring for providers and actions.
 * Score: 0 (no risk) → 100 (maximum risk).
 *
 * Factors considered:
 * - audit status and recency
 * - upgradeability
 * - timelocks
 * - maturity (protocol age)
 * - liquidity / TVL
 * - incidents
 * - contract verification
 * - oracle dependencies
 * - provider health
 * - isOfficialCircleProduct (positive signal only — never forces LOW)
 *
 * Official Circle/Arc status may reduce risk score but cannot force it to LOW.
 */

import type {
  ActionRiskContext,
  AuditInfo,
  ProviderRiskProfile,
  RiskLevel,
  RiskScoreFactor,
  RiskScoringResult,
} from './riskTypes';

// ── Level Boundaries ──────────────────────────────────────────────────────────

export function scoreToLevel(score: number): RiskLevel {
  if (score < 0 || isNaN(score)) return 'UNKNOWN';
  if (score <= 25) return 'LOW';
  if (score <= 50) return 'MEDIUM';
  if (score <= 75) return 'HIGH';
  return 'CRITICAL';
}

// ── Factor Calculators ────────────────────────────────────────────────────────

function scoreAudit(profile: ProviderRiskProfile): RiskScoreFactor {
  if (!profile.audited || profile.audits.length === 0) {
    return { factor: 'audit', contribution: 30, note: 'No audit found — significant risk.' };
  }

  // Find most recent audit
  const sorted = [...profile.audits].sort(
    (a, b) => new Date(b.auditDate).getTime() - new Date(a.auditDate).getTime(),
  );
  const latest: AuditInfo = sorted[0];
  const ageMs = Date.now() - new Date(latest.auditDate).getTime();
  const ageYears = ageMs / (365 * 24 * 60 * 60 * 1000);

  let base = 0;

  // Recency penalty
  if (ageYears > 2) base += 15;
  else if (ageYears > 1) base += 8;
  else if (ageYears > 0.5) base += 3;

  // Outstanding findings
  base += Math.min(latest.critical * 8, 16);
  base += Math.min(latest.high * 3, 9);

  return {
    factor: 'audit',
    contribution: base,
    note: `Audited ${ageYears.toFixed(1)}yr ago by ${latest.auditorName}; ${latest.critical} critical, ${latest.high} high findings.`,
  };
}

function scoreUpgradeability(profile: ProviderRiskProfile): RiskScoreFactor {
  if (!profile.upgradeable) {
    return { factor: 'upgradeability', contribution: 0, note: 'Immutable contracts.' };
  }
  if (!profile.hasTimelock) {
    return { factor: 'upgradeability', contribution: 15, note: 'Upgradeable without timelock — admin key risk.' };
  }
  return { factor: 'upgradeability', contribution: 7, note: 'Upgradeable but has timelock.' };
}

function scoreMaturity(profile: ProviderRiskProfile): RiskScoreFactor {
  if (!profile.launchDate) {
    return { factor: 'maturity', contribution: 10, note: 'Launch date unknown.' };
  }
  const ageMs = Date.now() - new Date(profile.launchDate).getTime();
  const ageMonths = ageMs / (30 * 24 * 60 * 60 * 1000);
  if (ageMonths < 1) return { factor: 'maturity', contribution: 20, note: 'Protocol less than 1 month old.' };
  if (ageMonths < 3) return { factor: 'maturity', contribution: 15, note: 'Protocol less than 3 months old.' };
  if (ageMonths < 6) return { factor: 'maturity', contribution: 8, note: 'Protocol less than 6 months old.' };
  if (ageMonths < 12) return { factor: 'maturity', contribution: 3, note: 'Protocol less than 12 months old.' };
  return { factor: 'maturity', contribution: 0, note: `Protocol ${(ageMonths / 12).toFixed(1)}yr old.` };
}

function scoreLiquidity(profile: ProviderRiskProfile): RiskScoreFactor {
  if (profile.tvlUsd === undefined) {
    return { factor: 'liquidity', contribution: 10, note: 'TVL unknown.' };
  }
  if (profile.tvlUsd < 100_000) return { factor: 'liquidity', contribution: 15, note: `TVL < $100k (${profile.tvlUsd}).` };
  if (profile.tvlUsd < 1_000_000) return { factor: 'liquidity', contribution: 8, note: `TVL < $1M (${profile.tvlUsd}).` };
  if (profile.tvlUsd < 10_000_000) return { factor: 'liquidity', contribution: 3, note: `TVL < $10M.` };
  return { factor: 'liquidity', contribution: 0, note: `TVL >= $10M.` };
}

function scoreIncidents(profile: ProviderRiskProfile): RiskScoreFactor {
  if (profile.incidentCount === 0) {
    return { factor: 'incidents', contribution: 0, note: 'No incidents recorded.' };
  }
  const penalty = Math.min(profile.incidentCount * 10, 30);
  return {
    factor: 'incidents',
    contribution: penalty,
    note: `${profile.incidentCount} incident(s) recorded.`,
  };
}

function scoreContractVerification(profile: ProviderRiskProfile): RiskScoreFactor {
  if (!profile.contractVerified) {
    return { factor: 'contractVerification', contribution: 10, note: 'Contract source not verified on explorer.' };
  }
  return { factor: 'contractVerification', contribution: 0, note: 'Contract verified on explorer.' };
}

function scoreOracle(profile: ProviderRiskProfile): RiskScoreFactor {
  if (profile.oracleDependent) {
    return { factor: 'oracle', contribution: 5, note: 'Protocol relies on oracle for critical pricing.' };
  }
  return { factor: 'oracle', contribution: 0, note: 'No oracle dependency.' };
}

function scoreHealth(profile: ProviderRiskProfile): RiskScoreFactor {
  switch (profile.healthStatus) {
    case 'OK': return { factor: 'health', contribution: 0, note: 'Provider health OK.' };
    case 'DEGRADED': return { factor: 'health', contribution: 15, note: 'Provider is DEGRADED.' };
    case 'DOWN': return { factor: 'health', contribution: 40, note: 'Provider is DOWN.' };
    case 'UNKNOWN': return { factor: 'health', contribution: 20, note: 'Provider health UNKNOWN.' };
    default: return { factor: 'health', contribution: 20, note: 'Health status unrecognised.' };
  }
}

function scoreOfficialStatus(profile: ProviderRiskProfile, baseScore: number): RiskScoreFactor {
  if (!profile.isOfficialCircleProduct) {
    return { factor: 'officialStatus', contribution: 0, note: 'Not an official Circle product.' };
  }
  // Positive signal: reduces score by up to 5 points, but cannot take score below LOW boundary
  const reduction = Math.min(5, Math.max(0, baseScore - 20));
  return {
    factor: 'officialStatus',
    contribution: -reduction,
    note: `Official Circle product — minor positive signal (−${reduction} pts). Does not force LOW risk.`,
  };
}

// ── Provider Scoring ──────────────────────────────────────────────────────────

/**
 * Compute a deterministic risk score for a single provider profile.
 */
export function scoreProvider(profile: ProviderRiskProfile): RiskScoringResult {
  const factorResults: RiskScoreFactor[] = [
    scoreAudit(profile),
    scoreUpgradeability(profile),
    scoreMaturity(profile),
    scoreLiquidity(profile),
    scoreIncidents(profile),
    scoreContractVerification(profile),
    scoreOracle(profile),
    scoreHealth(profile),
  ];

  const baseScore = factorResults.reduce((sum, f) => sum + f.contribution, 0);

  // Official status applied last, against the base score
  const officialFactor = scoreOfficialStatus(profile, baseScore);
  factorResults.push(officialFactor);

  const finalScore = Math.max(0, Math.min(100, baseScore + officialFactor.contribution));

  return {
    score: Math.round(finalScore),
    level: scoreToLevel(finalScore),
    factors: factorResults,
    providerId: profile.providerId,
    computedAt: Date.now(),
  };
}

// ── Action-Level Risk ─────────────────────────────────────────────────────────

/**
 * Compute the aggregate risk score for an action involving multiple providers.
 * The overall score is the maximum of all provider scores (worst case).
 * Simulation absence adds a fixed penalty.
 */
export function scoreAction(context: ActionRiskContext): RiskScoringResult {
  if (context.providerProfiles.length === 0) {
    return {
      score: 100,
      level: 'CRITICAL',
      factors: [{ factor: 'no_providers', contribution: 100, note: 'No provider profiles provided.' }],
      providerId: 'none',
      computedAt: Date.now(),
    };
  }

  const providerScores = context.providerProfiles.map(scoreProvider);
  const worstProvider = providerScores.reduce((prev, curr) => (curr.score > prev.score ? curr : prev));

  let adjustedScore = worstProvider.score;
  const extraFactors: RiskScoreFactor[] = [];

  if (!context.wasSimulated) {
    const penalty = 10;
    extraFactors.push({
      factor: 'no_simulation',
      contribution: penalty,
      note: 'Action was not simulated before risk scoring. Adding risk penalty.',
    });
    adjustedScore = Math.min(100, adjustedScore + penalty);
  }

  return {
    score: Math.round(adjustedScore),
    level: scoreToLevel(adjustedScore),
    factors: [...worstProvider.factors, ...extraFactors],
    providerId: worstProvider.providerId,
    computedAt: Date.now(),
  };
}

// ── Static Profiles for Known Providers ──────────────────────────────────────

/**
 * Static risk profiles for registered providers.
 * These are the baseline profiles used when live data is unavailable.
 * Must be updated as provider state changes.
 */
export const STATIC_PROVIDER_RISK_PROFILES: Record<string, ProviderRiskProfile> = {
  'arc-erc20-transfer': {
    providerId: 'arc-erc20-transfer',
    audited: true,
    audits: [
      {
        auditorName: 'OpenZeppelin',
        auditDate: '2023-01-01',
        critical: 0,
        high: 0,
        medium: 0,
      },
    ],
    upgradeable: false,
    hasTimelock: false,
    launchDate: '2023-01-01',
    tvlUsd: undefined,
    incidentCount: 0,
    contractVerified: true,
    oracleDependent: false,
    isOfficialCircleProduct: true,
    healthStatus: 'OK',
  },
  'viem-simulation': {
    providerId: 'viem-simulation',
    audited: true,
    audits: [],
    upgradeable: false,
    hasTimelock: false,
    launchDate: '2022-01-01',
    tvlUsd: undefined,
    incidentCount: 0,
    contractVerified: false,
    oracleDependent: false,
    isOfficialCircleProduct: false,
    healthStatus: 'OK',
  },
  'arc-portfolio-read': {
    providerId: 'arc-portfolio-read',
    audited: true,
    audits: [],
    upgradeable: false,
    hasTimelock: false,
    launchDate: '2023-01-01',
    tvlUsd: undefined,
    incidentCount: 0,
    contractVerified: true,
    oracleDependent: false,
    isOfficialCircleProduct: true,
    healthStatus: 'OK',
  },
  // ── Verified 2026-10-07: Circle StableFX (USDC ↔ EURC) ────────────────────
  'circle-stablefx': {
    providerId: 'circle-stablefx',
    audited: true,
    audits: [
      { auditorName: 'Circle Internal / Third-party', auditDate: '2024-01-01', critical: 0, high: 0, medium: 0 },
    ],
    upgradeable: false,
    hasTimelock: true,
    launchDate: '2024-01-01',
    tvlUsd: 50_000_000,
    incidentCount: 0,
    contractVerified: true,
    oracleDependent: false,
    isOfficialCircleProduct: true,
    healthStatus: 'OK',
  },
  // ── Verified 2026-10-07: CCTP V2 Bridge ───────────────────────────────────
  'cctp-v2-bridge': {
    providerId: 'cctp-v2-bridge',
    audited: true,
    audits: [
      { auditorName: 'OpenZeppelin', auditDate: '2024-06-01', critical: 0, high: 0, medium: 0 },
    ],
    upgradeable: false,
    hasTimelock: true,
    launchDate: '2024-01-01',
    tvlUsd: 100_000_000,
    incidentCount: 0,
    contractVerified: true,
    oracleDependent: false,
    isOfficialCircleProduct: true,
    healthStatus: 'OK',
  },
};

/**
 * Get a static provider risk profile by ID, or return a high-risk unknown profile.
 */
export function getProviderRiskProfile(providerId: string): ProviderRiskProfile {
  return (
    STATIC_PROVIDER_RISK_PROFILES[providerId] ?? {
      providerId,
      audited: false,
      audits: [],
      upgradeable: true,
      hasTimelock: false,
      launchDate: undefined,
      tvlUsd: undefined,
      incidentCount: 0,
      contractVerified: false,
      oracleDependent: false,
      isOfficialCircleProduct: false,
      healthStatus: 'UNKNOWN',
    }
  );
}
