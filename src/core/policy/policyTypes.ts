/**
 * Veyra Policy Engine — Type Definitions
 *
 * The policy engine is a pure deterministic layer.
 * Agent output cannot modify policy results.
 */

import type { ActionType } from '../actions/actionSchema';

// ── Policy Rule Types ─────────────────────────────────────────────────────────

export type PolicyRuleId =
  | 'MAX_SINGLE_TX_AMOUNT'
  | 'MIN_LIQUID_BALANCE'
  | 'MAX_DAILY_SPEND'
  | 'ALLOWED_CHAINS'
  | 'ALLOWED_ASSETS'
  | 'ALLOWED_PROVIDERS'
  | 'MAX_SLIPPAGE'
  | 'STALE_DATA_BLOCK'
  | 'EXPIRED_QUOTE_BLOCK'
  | 'QUOTE_REPLAY_BLOCK'
  | 'UNKNOWN_CONTRACT_BLOCK'
  | 'SIMULATION_REQUIRED'
  | 'MAX_RISK';

// ── Policy Rule Configuration ─────────────────────────────────────────────────

export interface MaxSingleTxAmountRule {
  ruleId: 'MAX_SINGLE_TX_AMOUNT';
  /** Maximum amount in token base units (bigint string for JSON serialisability). */
  maxAmountBaseUnits: bigint;
  /** Applies to these action types. */
  actionTypes: ActionType[];
}

export interface MinLiquidBalanceRule {
  ruleId: 'MIN_LIQUID_BALANCE';
  /** Minimum balance that must remain after the action (base units). */
  minBalanceBaseUnits: bigint;
}

export interface MaxDailySpendRule {
  ruleId: 'MAX_DAILY_SPEND';
  maxDailyBaseUnits: bigint;
}

export interface AllowedChainsRule {
  ruleId: 'ALLOWED_CHAINS';
  allowedChainIds: number[];
}

export interface AllowedAssetsRule {
  ruleId: 'ALLOWED_ASSETS';
  /** Lowercase ERC-20 addresses. */
  allowedAssets: string[];
}

export interface AllowedProvidersRule {
  ruleId: 'ALLOWED_PROVIDERS';
  allowedProviderIds: string[];
}

export interface MaxSlippageRule {
  ruleId: 'MAX_SLIPPAGE';
  maxSlippageBps: number;
}

export interface StaleDataBlockRule {
  ruleId: 'STALE_DATA_BLOCK';
  maxAgeMs: number;
}

export interface ExpiredQuoteBlockRule {
  ruleId: 'EXPIRED_QUOTE_BLOCK';
  bufferMs: number;
}

export interface QuoteReplayBlockRule {
  ruleId: 'QUOTE_REPLAY_BLOCK';
  // No config — uses the replay store state machine
}

export interface UnknownContractBlockRule {
  ruleId: 'UNKNOWN_CONTRACT_BLOCK';
  allowedContractAddresses: string[];
}

export interface SimulationRequiredRule {
  ruleId: 'SIMULATION_REQUIRED';
  requiredForActionTypes: ActionType[];
}

export interface MaxRiskRule {
  ruleId: 'MAX_RISK';
  maxRiskScore: number;
}

export type PolicyRule =
  | MaxSingleTxAmountRule
  | MinLiquidBalanceRule
  | MaxDailySpendRule
  | AllowedChainsRule
  | AllowedAssetsRule
  | AllowedProvidersRule
  | MaxSlippageRule
  | StaleDataBlockRule
  | ExpiredQuoteBlockRule
  | QuoteReplayBlockRule
  | UnknownContractBlockRule
  | SimulationRequiredRule
  | MaxRiskRule;

// ── Policy Set ────────────────────────────────────────────────────────────────

export interface VeyraPolicy {
  policyId: string;
  displayName: string;
  rules: PolicyRule[];
  /** Whether this policy set is currently active. */
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

// ── Evaluation Context ────────────────────────────────────────────────────────

export interface PolicyEvaluationContext {
  /** Current wallet balance in token base units (from deterministic chain read). */
  currentBalanceBaseUnits?: bigint;
  /** Cumulative spend today in token base units. */
  dailySpentBaseUnits?: bigint;
  /** Risk score (0–100) from the risk engine. */
  riskScore?: number;
  /** Whether simulation has been completed for this action. */
  simulationCompleted?: boolean;
  /** Quote ID to check for replay. */
  quoteId?: string;
  /** Addresses of contracts the action will interact with. */
  contractAddresses?: string[];
  /** Additional provider ID override (usually from the action). */
  providerId?: string;
}

// ── Evaluation Result ─────────────────────────────────────────────────────────

export type PolicyDecision = 'PASS' | 'NEEDS_CONFIRMATION' | 'BLOCKED';

export interface PolicyRuleResult {
  ruleId: PolicyRuleId;
  decision: PolicyDecision;
  message: string;
}

export interface PolicyEvaluationResult {
  /** Overall decision — worst of all individual rule results. */
  decision: PolicyDecision;
  ruleResults: PolicyRuleResult[];
  /** Rules that produced BLOCKED. */
  blockedBy: PolicyRuleId[];
  /** Rules that produced NEEDS_CONFIRMATION. */
  confirmationRequired: PolicyRuleId[];
}
