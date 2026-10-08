/**
 * Veyra Risk Engine — Type Definitions
 *
 * Risk scoring is deterministic (0–100).
 * Official Circle/Arc status is metadata only — it never forces LOW risk.
 */

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' | 'UNKNOWN';

// ── Risk Factors ──────────────────────────────────────────────────────────────

export interface AuditInfo {
  auditorName: string;
  auditDate: string; // ISO-8601
  reportUrl?: string;
  critical: number;
  high: number;
  medium: number;
}

export interface ProviderRiskProfile {
  providerId: string;

  /** Whether the smart contracts have been audited. */
  audited: boolean;

  /** Audit records. Empty if unaudited. */
  audits: AuditInfo[];

  /** Whether the contracts are upgradeable (proxy pattern). */
  upgradeable: boolean;

  /** Whether there is a timelock on upgrades/admin actions. */
  hasTimelock: boolean;

  /** Protocol launch date (ISO-8601). Affects maturity score. */
  launchDate?: string;

  /** Total Value Locked in USD. Used as a liquidity proxy. */
  tvlUsd?: number;

  /** Number of security incidents recorded. */
  incidentCount: number;

  /** Whether the contracts are verified on the block explorer. */
  contractVerified: boolean;

  /** Whether the protocol depends on an oracle for critical pricing. */
  oracleDependent: boolean;

  /** Whether this provider has official Circle/Arc backing (metadata only). */
  isOfficialCircleProduct: boolean;

  /** Current provider health status. */
  healthStatus: 'OK' | 'DEGRADED' | 'DOWN' | 'UNKNOWN';
}

// ── Scoring Breakdown ─────────────────────────────────────────────────────────

export interface RiskScoreFactor {
  factor: string;
  contribution: number; // positive = increases risk (0–100 scale)
  note: string;
}

export interface RiskScoringResult {
  /** Composite risk score 0–100. Higher is riskier. */
  score: number;

  /** Derived level. */
  level: RiskLevel;

  /** Per-factor breakdown for transparency. */
  factors: RiskScoreFactor[];

  /** Provider ID this score applies to. */
  providerId: string;

  /** Timestamp when this score was computed. */
  computedAt: number;
}

// ── Action Risk Context ───────────────────────────────────────────────────────

export interface ActionRiskContext {
  /** Risk profiles for all providers involved in this action. */
  providerProfiles: ProviderRiskProfile[];

  /** Chain ID the action runs on. */
  chainId: number;

  /** Whether the action has been simulated. */
  wasSimulated: boolean;
}
