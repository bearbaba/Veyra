/**
 * Veyra Central Security Configuration
 *
 * ONE source of truth for all security-relevant timing, threshold, and
 * validation constants. Nothing else may define these magic numbers.
 *
 * Import from here; never hardcode these values elsewhere.
 */

export const SECURITY_CONFIG = {
  // ── Data Freshness ────────────────────────────────────────────────────────

  /**
   * Maximum age (ms) of a balance read before it is considered stale
   * and must be refetched before execution.
   */
  MAX_BALANCE_AGE_MS: 30_000, // 30 seconds

  /**
   * Maximum age (ms) of a provider health check result.
   * After this, the health is considered UNKNOWN.
   */
  MAX_PROVIDER_HEALTH_AGE_MS: 60_000, // 60 seconds

  /**
   * Maximum age (ms) of any provenance-carrying data (prices, quotes, rates)
   * before it is treated as stale.
   */
  MAX_PROVENANCE_AGE_MS: 30_000, // 30 seconds

  /**
   * Maximum age (ms) of a token/contract metadata read.
   */
  MAX_METADATA_AGE_MS: 300_000, // 5 minutes

  // ── Quote Handling ────────────────────────────────────────────────────────

  /**
   * Buffer time (ms) before a quote's stated expiry at which Veyra
   * refuses the quote to avoid clock-skew or latency-induced replays.
   */
  QUOTE_EXPIRY_BUFFER_MS: 10_000, // 10 seconds

  /**
   * Maximum time (ms) a quote reservation may be held in RESERVED state
   * before it is automatically released (stale reservation reconciliation).
   */
  QUOTE_RESERVATION_TIMEOUT_MS: 120_000, // 2 minutes

  /**
   * How long (ms) to retain used/expired quote entries in replay protection
   * storage before pruning.
   */
  QUOTE_REPLAY_RETENTION_MS: 600_000, // 10 minutes

  // ── Slippage ──────────────────────────────────────────────────────────────

  /**
   * Default maximum slippage tolerance (basis points, 1 bp = 0.01%).
   * A quote must not have slippage exceeding this without explicit
   * user-level policy override.
   */
  DEFAULT_MAX_SLIPPAGE_BPS: 100, // 1%

  /**
   * Absolute hard cap on slippage (basis points).
   * No policy or user action may raise slippage above this.
   */
  HARD_MAX_SLIPPAGE_BPS: 500, // 5%

  // ── Risk Thresholds ───────────────────────────────────────────────────────

  /**
   * Risk score (0–100) above which an action is BLOCKED by default policy.
   * 100 = maximum risk.
   */
  DEFAULT_MAX_RISK_SCORE: 70,

  /**
   * Risk score above which NEEDS_CONFIRMATION is surfaced (below BLOCKED).
   */
  RISK_CONFIRMATION_THRESHOLD: 50,

  // ── Transaction Limits ────────────────────────────────────────────────────

  /**
   * Default maximum single-transaction USDC amount (in USDC micro-units, 6 decimals).
   * Policy engine will require explicit user confirmation above this.
   */
  DEFAULT_MAX_SINGLE_TX_USDC: 10_000 * 1_000_000, // $10,000 USDC

  /**
   * Default maximum daily spend in USDC micro-units.
   */
  DEFAULT_MAX_DAILY_SPEND_USDC: 50_000 * 1_000_000, // $50,000 USDC

  // ── Simulation ────────────────────────────────────────────────────────────

  /**
   * Whether simulation is required before any execution by default.
   * Individual action policies may override this per action type.
   */
  SIMULATION_REQUIRED_BY_DEFAULT: true,

  // ── Security Gate ─────────────────────────────────────────────────────────

  /**
   * Maximum time (ms) the security gate may remain in PENDING state
   * before it transitions to FAILED.
   */
  SECURITY_GATE_TIMEOUT_MS: 10_000, // 10 seconds

  // ── Bridge ────────────────────────────────────────────────────────────────

  /**
   * Maximum time (ms) to wait for destination-chain confirmation of a bridge.
   * After this the bridge receipt is BRIDGE_PENDING with a warning.
   */
  BRIDGE_DESTINATION_TIMEOUT_MS: 900_000, // 15 minutes

  /**
   * Polling interval (ms) for checking bridge destination status.
   */
  BRIDGE_POLL_INTERVAL_MS: 15_000, // 15 seconds

} as const;

export type SecurityConfig = typeof SECURITY_CONFIG;
