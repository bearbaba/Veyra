/**
 * Veyra Provider Registry — Type Definitions
 *
 * Every financial provider Veyra may use must be explicitly registered.
 * Unregistered providers cannot execute.
 */

// ── Capability ────────────────────────────────────────────────────────────────

export type ProviderCapability =
  | 'TRANSFER'
  | 'CONVERT'
  | 'SWAP'
  | 'BRIDGE'
  | 'UNIFIED_BALANCE'
  | 'EARN_DISCOVER'
  | 'EARN_DEPOSIT'
  | 'EARN_WITHDRAW'
  | 'EARN_POSITION'
  | 'ONRAMP'
  | 'SUPPLY'
  | 'WITHDRAW'
  | 'BORROW'
  | 'REPAY'
  | 'PORTFOLIO_READ'
  | 'SIMULATION';

// ── Trust & Health ────────────────────────────────────────────────────────────

/**
 * Trust status — whether the integration has been reviewed and enabled.
 * OFFICIAL means Circle/Arc officially published this provider, but that
 * is metadata only and does not force LOW risk.
 */
export type ProviderTrustStatus =
  | 'TRUSTED'      // verified, reviewed, enabled
  | 'OFFICIAL'     // Circle/Arc official — still subject to risk scoring
  | 'UNVERIFIED'   // integration not yet reviewed
  | 'DISABLED';    // explicitly turned off

export type ProviderHealthStatus =
  | 'OK'           // normal operation
  | 'DEGRADED'     // impaired but partially operational — require confirmation
  | 'DOWN'         // not operational — block
  | 'UNKNOWN';     // health check has not run or is stale — fail conservatively

export type ProviderRiskClassification =
  | 'LOW'
  | 'MEDIUM'
  | 'HIGH'
  | 'CRITICAL'
  | 'UNKNOWN';

// ── Provider Lifecycle ────────────────────────────────────────────────────────

/**
 * Mandatory lifecycle progression for every provider.
 *
 * DISCOVERED  — provider identified; no docs or adapter yet
 * VERIFIED    — current official docs, contracts, chain IDs, assets, API/SDK and
 *               credentials have been independently verified
 * IMPLEMENTED — adapter exists and passes unit/schema tests
 * TESTED      — real end-to-end testnet execution has succeeded and
 *               post-execution state (balance delta, receipt) has been verified
 * ENABLED     — provider may participate in user-executable Veyra flows
 *
 * Only ENABLED providers may pass the checkProviderEligibility execution gate.
 * Documentation verification alone is NOT sufficient — real testnet E2E
 * execution must succeed before a provider may be promoted to TESTED or ENABLED.
 */
export type ProviderLifecycleStage =
  | 'DISCOVERED'
  | 'VERIFIED'
  | 'IMPLEMENTED'
  | 'TESTED'
  | 'ENABLED';

// ── Environment ───────────────────────────────────────────────────────────────

export type ProviderEnvironment = 'local' | 'testnet' | 'mainnet' | 'all';

// ── Registry Entry ────────────────────────────────────────────────────────────

export interface ProviderContractAddress {
  chainId: number;
  name: string;
  address: string;
}

/**
 * Source provenance record. Every manifest entry carries this so we can
 * audit where addresses/versions came from.
 */
export interface ProviderProvenance {
  /** URL of the official documentation or source used to verify this entry. */
  sourceUrl: string;
  /** ISO-8601 date when this entry was last verified against official docs. */
  verifiedAt: string;
  /** Short human note about what was verified. */
  notes: string;
}

export interface ProviderManifestEntry {
  /** Unique stable identifier for this provider. */
  providerId: string;

  /** Human display name. */
  displayName: string;

  /** What this provider can do. */
  capabilities: ProviderCapability[];

  /** EVM chain IDs this provider is active on. Empty = no EVM chain restriction metadata. */
  supportedChainIds: number[];

  /**
   * Product-layer network IDs supported by the provider. Optional for legacy
   * entries. This allows the registry to describe non-EVM networks such as
   * Solana without inventing a numeric EVM chain ID.
   */
  supportedNetworkIds?: string[];

  /** ERC-20 token addresses (lowercase) this provider works with. */
  supportedAssets: string[];

  /** Which deployment environment this manifest entry applies to. */
  environment: ProviderEnvironment;

  /** Current trust status of this integration. */
  trustStatus: ProviderTrustStatus;

  /** Current health status — updated by the health check subsystem. */
  healthStatus: ProviderHealthStatus;

  /** Risk classification from the risk engine. */
  riskClassification: ProviderRiskClassification;

  /** On-chain contracts this provider uses. */
  contractAddresses: ProviderContractAddress[];

  /** NPM package name if applicable, e.g. "@circle-fin/bridge-kit". */
  packageName?: string;

  /** Package version used, e.g. "1.0.0". */
  packageVersion?: string;

  /**
   * Lifecycle stage of this provider integration.
   * Only ENABLED providers may pass the execution gate.
   * Progresses: DISCOVERED → VERIFIED → IMPLEMENTED → TESTED → ENABLED
   * Promotion to TESTED requires successful real testnet E2E execution.
   * Promotion to ENABLED requires TESTED + explicit sign-off.
   */
  lifecycleStage: ProviderLifecycleStage;

  /**
   * Whether this provider is enabled for execution.
   * Must be true AND lifecycleStage must be ENABLED for execution to proceed.
   * Even a TRUSTED provider with OK health must have enabled === true.
   * Providers whose integrations have not been independently verified
   * must remain false.
   */
  enabled: boolean;

  /** Source provenance — re-verify before updating addresses. */
  provenance: ProviderProvenance;
}

// ── Runtime Health Record ─────────────────────────────────────────────────────

export interface ProviderHealthRecord {
  providerId: string;
  status: ProviderHealthStatus;
  checkedAt: number; // ms timestamp
  detail?: string;
}

// ── Registry Result ───────────────────────────────────────────────────────────

export interface ProviderLookupResult {
  found: true;
  entry: ProviderManifestEntry;
  effectiveHealth: ProviderHealthStatus;
}

export interface ProviderNotFoundResult {
  found: false;
  providerId: string;
}

export type ProviderResult = ProviderLookupResult | ProviderNotFoundResult;

// ── Execution Eligibility ─────────────────────────────────────────────────────

export type ProviderEligibilityStatus =
  | 'ELIGIBLE'
  | 'DISABLED'
  | 'UNVERIFIED'
  | 'NOT_LIFECYCLE_READY'  // lifecycleStage is not yet ENABLED — real testnet E2E required
  | 'HEALTH_DOWN'
  | 'HEALTH_UNKNOWN'
  | 'CHAIN_NOT_SUPPORTED'
  | 'ASSET_NOT_SUPPORTED'
  | 'CAPABILITY_NOT_SUPPORTED'
  | 'ENVIRONMENT_NOT_SUPPORTED'
  | 'NOT_FOUND';

export interface ProviderEligibilityResult {
  eligible: boolean;
  status: ProviderEligibilityStatus;
  requiresConfirmation: boolean; // true when DEGRADED health requires explicit confirmation
  detail: string;
}
