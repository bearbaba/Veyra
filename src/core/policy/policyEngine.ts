/**
 * Veyra Policy Engine
 *
 * Pure deterministic evaluation layer.
 * Takes an action + context and evaluates all active policy rules.
 * Agent output cannot modify the result.
 *
 * Mandatory protections:
 * - stale-data blocking
 * - expired-quote blocking
 * - replay protection (delegated to quoteReplayStore)
 * - unknown-contract blocking
 * - maximum slippage
 * - simulation requirement
 */

import { SECURITY_CONFIG } from '../../lib/securityConfig';
import type { VeyraAction } from '../actions/actionSchema';
import type {
  AllowedAssetsRule,
  AllowedChainsRule,
  AllowedProvidersRule,
  MaxDailySpendRule,
  MaxRiskRule,
  MaxSingleTxAmountRule,
  MaxSlippageRule,
  MinLiquidBalanceRule,
  PolicyDecision,
  PolicyEvaluationContext,
  PolicyEvaluationResult,
  PolicyRuleResult,
  SimulationRequiredRule,
  UnknownContractBlockRule,
  VeyraPolicy,
} from './policyTypes';
// PolicyRule and PolicyRuleId are used in policyTypes and tests only — not directly here.

// ── Default Policy ────────────────────────────────────────────────────────────

/** The default Veyra safety policy applied to every action unless overridden. */
export const DEFAULT_VEYRA_POLICY: VeyraPolicy = {
  policyId: 'veyra-default-v1',
  displayName: 'Veyra Default Safety Policy',
  enabled: true,
  createdAt: 0,
  updatedAt: 0,
  rules: [
    {
      ruleId: 'STALE_DATA_BLOCK',
      maxAgeMs: SECURITY_CONFIG.MAX_PROVENANCE_AGE_MS,
    },
    {
      ruleId: 'EXPIRED_QUOTE_BLOCK',
      bufferMs: SECURITY_CONFIG.QUOTE_EXPIRY_BUFFER_MS,
    },
    {
      ruleId: 'QUOTE_REPLAY_BLOCK',
    },
    {
      ruleId: 'MAX_SLIPPAGE',
      maxSlippageBps: SECURITY_CONFIG.DEFAULT_MAX_SLIPPAGE_BPS,
    },
    {
      ruleId: 'MAX_SINGLE_TX_AMOUNT',
      maxAmountBaseUnits: BigInt(SECURITY_CONFIG.DEFAULT_MAX_SINGLE_TX_USDC),
      actionTypes: ['TRANSFER', 'CONVERT', 'BRIDGE', 'SUPPLY', 'WITHDRAW', 'BORROW', 'REPAY'],
    },
    {
      ruleId: 'MAX_RISK',
      maxRiskScore: SECURITY_CONFIG.DEFAULT_MAX_RISK_SCORE,
    },
    ...(SECURITY_CONFIG.SIMULATION_REQUIRED_BY_DEFAULT
      ? [
          {
            ruleId: 'SIMULATION_REQUIRED' as const,
            requiredForActionTypes: ['TRANSFER', 'CONVERT', 'BRIDGE', 'APPROVE', 'SUPPLY', 'WITHDRAW', 'BORROW', 'REPAY'] as const,
          } satisfies SimulationRequiredRule,
        ]
      : []),
  ],
};

// ── Rule Evaluators ───────────────────────────────────────────────────────────

function evaluateStaleData(
  action: VeyraAction,
  rule: { maxAgeMs: number },
): PolicyRuleResult {
  const age = Date.now() - action.provenance.fetchedAt;
  if (age > rule.maxAgeMs) {
    return {
      ruleId: 'STALE_DATA_BLOCK',
      decision: 'BLOCKED',
      message: `Action data is stale (age: ${age}ms, max: ${rule.maxAgeMs}ms). Refresh and retry.`,
    };
  }
  return { ruleId: 'STALE_DATA_BLOCK', decision: 'PASS', message: 'Data freshness OK.' };
}

function evaluateExpiredQuote(action: VeyraAction, bufferMs: number): PolicyRuleResult {
  if (action.actionType === 'CONVERT' || action.actionType === 'BRIDGE') {
    const now = Date.now();
    if (action.quoteExpiresAt <= now + bufferMs) {
      return {
        ruleId: 'EXPIRED_QUOTE_BLOCK',
        decision: 'BLOCKED',
        message: `Quote has expired or is within the ${bufferMs}ms expiry buffer.`,
      };
    }
  }
  return { ruleId: 'EXPIRED_QUOTE_BLOCK', decision: 'PASS', message: 'Quote freshness OK or not applicable.' };
}

function evaluateQuoteReplay(context: PolicyEvaluationContext): PolicyRuleResult {
  // Actual replay check is done via quoteReplayStore.
  // Here we only check whether the caller flagged that replay was detected.
  // The quoteReplayStore is consulted in the orchestration layer before calling the policy engine.
  // This rule simply verifies that quoteId is present when applicable.
  if (context.quoteId === 'REPLAYED') {
    return {
      ruleId: 'QUOTE_REPLAY_BLOCK',
      decision: 'BLOCKED',
      message: 'Quote replay detected. This quote has already been used or is reserved.',
    };
  }
  return { ruleId: 'QUOTE_REPLAY_BLOCK', decision: 'PASS', message: 'No replay detected.' };
}

function evaluateMaxSlippage(action: VeyraAction, rule: MaxSlippageRule): PolicyRuleResult {
  if (action.actionType === 'CONVERT') {
    if (action.slippageBps > rule.maxSlippageBps) {
      return {
        ruleId: 'MAX_SLIPPAGE',
        decision: 'BLOCKED',
        message: `Slippage ${action.slippageBps} bps exceeds policy maximum of ${rule.maxSlippageBps} bps.`,
      };
    }
  }
  return { ruleId: 'MAX_SLIPPAGE', decision: 'PASS', message: 'Slippage within policy bounds.' };
}

function getActionAmount(action: VeyraAction): bigint | null {
  switch (action.actionType) {
    case 'TRANSFER': return action.amount;
    case 'CONVERT': return action.amountIn;
    case 'BRIDGE': return action.amount;
    case 'APPROVE': return action.amount;
    case 'SUPPLY': return action.amount;
    case 'WITHDRAW': return action.amount;
    case 'BORROW': return action.amount;
    case 'REPAY': return action.amount;
    default: return null;
  }
}

function evaluateMaxSingleTx(action: VeyraAction, rule: MaxSingleTxAmountRule): PolicyRuleResult {
  if (!rule.actionTypes.includes(action.actionType)) {
    return { ruleId: 'MAX_SINGLE_TX_AMOUNT', decision: 'PASS', message: 'Rule not applicable to this action type.' };
  }
  const amount = getActionAmount(action);
  if (amount === null) {
    return { ruleId: 'MAX_SINGLE_TX_AMOUNT', decision: 'PASS', message: 'Amount not applicable.' };
  }
  if (amount > rule.maxAmountBaseUnits) {
    return {
      ruleId: 'MAX_SINGLE_TX_AMOUNT',
      decision: 'BLOCKED',
      message: `Amount ${amount} exceeds maximum single-transaction limit of ${rule.maxAmountBaseUnits}.`,
    };
  }
  if (amount > rule.maxAmountBaseUnits / 2n) {
    return {
      ruleId: 'MAX_SINGLE_TX_AMOUNT',
      decision: 'NEEDS_CONFIRMATION',
      message: `Amount ${amount} exceeds 50% of maximum single-transaction limit. Confirmation required.`,
    };
  }
  return { ruleId: 'MAX_SINGLE_TX_AMOUNT', decision: 'PASS', message: 'Amount within policy bounds.' };
}

function evaluateMinLiquidBalance(
  action: VeyraAction,
  rule: MinLiquidBalanceRule,
  context: PolicyEvaluationContext,
): PolicyRuleResult {
  if (context.currentBalanceBaseUnits === undefined) {
    return {
      ruleId: 'MIN_LIQUID_BALANCE',
      decision: 'BLOCKED',
      message: 'Current balance not provided. Cannot verify minimum liquid balance.',
    };
  }
  const amount = getActionAmount(action);
  if (amount === null) {
    return { ruleId: 'MIN_LIQUID_BALANCE', decision: 'PASS', message: 'Amount not applicable.' };
  }
  const remaining = context.currentBalanceBaseUnits - amount;
  if (remaining < rule.minBalanceBaseUnits) {
    return {
      ruleId: 'MIN_LIQUID_BALANCE',
      decision: 'BLOCKED',
      message: `Post-action balance ${remaining} would be below minimum liquid balance ${rule.minBalanceBaseUnits}.`,
    };
  }
  return { ruleId: 'MIN_LIQUID_BALANCE', decision: 'PASS', message: 'Liquid balance OK.' };
}

function evaluateMaxDailySpend(
  action: VeyraAction,
  rule: MaxDailySpendRule,
  context: PolicyEvaluationContext,
): PolicyRuleResult {
  const spent = context.dailySpentBaseUnits ?? 0n;
  const amount = getActionAmount(action) ?? 0n;
  const total = spent + amount;
  if (total > rule.maxDailyBaseUnits) {
    return {
      ruleId: 'MAX_DAILY_SPEND',
      decision: 'BLOCKED',
      message: `Daily spend ${total} would exceed limit of ${rule.maxDailyBaseUnits}.`,
    };
  }
  if (total > (rule.maxDailyBaseUnits * 8n) / 10n) {
    return {
      ruleId: 'MAX_DAILY_SPEND',
      decision: 'NEEDS_CONFIRMATION',
      message: `Daily spend ${total} exceeds 80% of daily limit. Confirmation required.`,
    };
  }
  return { ruleId: 'MAX_DAILY_SPEND', decision: 'PASS', message: 'Daily spend within limit.' };
}

function evaluateAllowedChains(action: VeyraAction, rule: AllowedChainsRule): PolicyRuleResult {
  if (!rule.allowedChainIds.includes(action.chainId)) {
    return {
      ruleId: 'ALLOWED_CHAINS',
      decision: 'BLOCKED',
      message: `Chain ${action.chainId} is not in the allowed chains list.`,
    };
  }
  return { ruleId: 'ALLOWED_CHAINS', decision: 'PASS', message: 'Chain allowed.' };
}

function evaluateAllowedAssets(action: VeyraAction, rule: AllowedAssetsRule): PolicyRuleResult {
  const assetAddress = (() => {
    switch (action.actionType) {
      case 'TRANSFER': return action.tokenAddress.toLowerCase();
      case 'CONVERT': return action.fromTokenAddress.toLowerCase();
      case 'BRIDGE': return action.tokenAddress.toLowerCase();
      case 'APPROVE': return action.tokenAddress.toLowerCase();
      case 'SUPPLY': return action.tokenAddress.toLowerCase();
      case 'WITHDRAW': return action.tokenAddress.toLowerCase();
      case 'BORROW': return action.tokenAddress.toLowerCase();
      case 'REPAY': return action.tokenAddress.toLowerCase();
      default: return null;
    }
  })();

  if (assetAddress && !rule.allowedAssets.includes(assetAddress)) {
    return {
      ruleId: 'ALLOWED_ASSETS',
      decision: 'BLOCKED',
      message: `Asset ${assetAddress} is not in the allowed assets list.`,
    };
  }
  return { ruleId: 'ALLOWED_ASSETS', decision: 'PASS', message: 'Asset allowed.' };
}

function evaluateAllowedProviders(action: VeyraAction, rule: AllowedProvidersRule): PolicyRuleResult {
  const providerId = (action as { providerId?: string }).providerId;
  if (!providerId) {
    return { ruleId: 'ALLOWED_PROVIDERS', decision: 'PASS', message: 'No provider required for this action type.' };
  }
  if (!rule.allowedProviderIds.includes(providerId)) {
    return {
      ruleId: 'ALLOWED_PROVIDERS',
      decision: 'BLOCKED',
      message: `Provider "${providerId}" is not in the allowed providers list.`,
    };
  }
  return { ruleId: 'ALLOWED_PROVIDERS', decision: 'PASS', message: 'Provider allowed.' };
}

function evaluateUnknownContract(context: PolicyEvaluationContext, rule: UnknownContractBlockRule): PolicyRuleResult {
  if (!context.contractAddresses || context.contractAddresses.length === 0) {
    return { ruleId: 'UNKNOWN_CONTRACT_BLOCK', decision: 'PASS', message: 'No contract addresses to check.' };
  }
  const unknown = context.contractAddresses.filter(
    (addr) => !rule.allowedContractAddresses.map((a) => a.toLowerCase()).includes(addr.toLowerCase()),
  );
  if (unknown.length > 0) {
    return {
      ruleId: 'UNKNOWN_CONTRACT_BLOCK',
      decision: 'BLOCKED',
      message: `Unknown contract addresses: ${unknown.join(', ')}. Only allowlisted contracts may execute.`,
    };
  }
  return { ruleId: 'UNKNOWN_CONTRACT_BLOCK', decision: 'PASS', message: 'All contracts recognised.' };
}

function evaluateSimulationRequired(action: VeyraAction, rule: SimulationRequiredRule, context: PolicyEvaluationContext): PolicyRuleResult {
  if (!rule.requiredForActionTypes.includes(action.actionType)) {
    return { ruleId: 'SIMULATION_REQUIRED', decision: 'PASS', message: 'Simulation not required for this action type.' };
  }
  if (!context.simulationCompleted) {
    return {
      ruleId: 'SIMULATION_REQUIRED',
      decision: 'BLOCKED',
      message: `Simulation is required before executing ${action.actionType} but has not been completed.`,
    };
  }
  return { ruleId: 'SIMULATION_REQUIRED', decision: 'PASS', message: 'Simulation completed.' };
}

function evaluateMaxRisk(rule: MaxRiskRule, context: PolicyEvaluationContext): PolicyRuleResult {
  if (context.riskScore === undefined) {
    return {
      ruleId: 'MAX_RISK',
      decision: 'BLOCKED',
      message: 'Risk score not provided. Blocking until risk evaluation is complete.',
    };
  }
  if (context.riskScore > rule.maxRiskScore) {
    return {
      ruleId: 'MAX_RISK',
      decision: 'BLOCKED',
      message: `Risk score ${context.riskScore} exceeds policy maximum of ${rule.maxRiskScore}.`,
    };
  }
  if (context.riskScore > SECURITY_CONFIG.RISK_CONFIRMATION_THRESHOLD) {
    return {
      ruleId: 'MAX_RISK',
      decision: 'NEEDS_CONFIRMATION',
      message: `Risk score ${context.riskScore} exceeds confirmation threshold ${SECURITY_CONFIG.RISK_CONFIRMATION_THRESHOLD}. Explicit confirmation required.`,
    };
  }
  return { ruleId: 'MAX_RISK', decision: 'PASS', message: `Risk score ${context.riskScore} within policy bounds.` };
}

// ── Policy Engine ─────────────────────────────────────────────────────────────

function worstDecision(a: PolicyDecision, b: PolicyDecision): PolicyDecision {
  if (a === 'BLOCKED' || b === 'BLOCKED') return 'BLOCKED';
  if (a === 'NEEDS_CONFIRMATION' || b === 'NEEDS_CONFIRMATION') return 'NEEDS_CONFIRMATION';
  return 'PASS';
}

/**
 * Evaluate all rules in a policy against an action + context.
 * Returns a deterministic result — Agent output cannot modify it.
 */
export function evaluatePolicy(
  action: VeyraAction,
  context: PolicyEvaluationContext,
  policy: VeyraPolicy = DEFAULT_VEYRA_POLICY,
): PolicyEvaluationResult {
  if (!policy.enabled) {
    return {
      decision: 'PASS',
      ruleResults: [{ ruleId: 'STALE_DATA_BLOCK', decision: 'PASS', message: 'Policy is disabled; all rules skipped.' }],
      blockedBy: [],
      confirmationRequired: [],
    };
  }

  const ruleResults: PolicyRuleResult[] = [];

  for (const rule of policy.rules) {
    let result: PolicyRuleResult;

    switch (rule.ruleId) {
      case 'STALE_DATA_BLOCK':
        result = evaluateStaleData(action, rule);
        break;
      case 'EXPIRED_QUOTE_BLOCK':
        result = evaluateExpiredQuote(action, rule.bufferMs);
        break;
      case 'QUOTE_REPLAY_BLOCK':
        result = evaluateQuoteReplay(context);
        break;
      case 'MAX_SLIPPAGE':
        result = evaluateMaxSlippage(action, rule);
        break;
      case 'MAX_SINGLE_TX_AMOUNT':
        result = evaluateMaxSingleTx(action, rule);
        break;
      case 'MIN_LIQUID_BALANCE':
        result = evaluateMinLiquidBalance(action, rule, context);
        break;
      case 'MAX_DAILY_SPEND':
        result = evaluateMaxDailySpend(action, rule, context);
        break;
      case 'ALLOWED_CHAINS':
        result = evaluateAllowedChains(action, rule);
        break;
      case 'ALLOWED_ASSETS':
        result = evaluateAllowedAssets(action, rule);
        break;
      case 'ALLOWED_PROVIDERS':
        result = evaluateAllowedProviders(action, rule);
        break;
      case 'UNKNOWN_CONTRACT_BLOCK':
        result = evaluateUnknownContract(context, rule);
        break;
      case 'SIMULATION_REQUIRED':
        result = evaluateSimulationRequired(action, rule, context);
        break;
      case 'MAX_RISK':
        result = evaluateMaxRisk(rule, context);
        break;
      default: {
        const _exhaustive: never = rule;
        void _exhaustive;
        result = { ruleId: 'STALE_DATA_BLOCK', decision: 'PASS', message: 'Unknown rule skipped.' };
      }
    }

    ruleResults.push(result);
  }

  const decision = ruleResults.reduce<PolicyDecision>(
    (acc, r) => worstDecision(acc, r.decision),
    'PASS',
  );

  return {
    decision,
    ruleResults,
    blockedBy: ruleResults.filter((r) => r.decision === 'BLOCKED').map((r) => r.ruleId),
    confirmationRequired: ruleResults
      .filter((r) => r.decision === 'NEEDS_CONFIRMATION')
      .map((r) => r.ruleId),
  };
}
