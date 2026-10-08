/**
 * Veyra Convert Pipeline
 *
 * USDC ↔ EURC via Circle StableFX
 *
 * Pipeline:
 *   ConvertAction → Policy → Risk → Simulation → Review → User Sign → BFF Trade → Verify → VeyraReceipt
 */

import type { ConvertAction } from '../actions/actionSchema';
import { validateAction } from '../actions/actionSchema';
import { evaluatePolicy, DEFAULT_VEYRA_POLICY } from '../policy/policyEngine';
import { scoreAction, getProviderRiskProfile } from '../risk/riskEngine';
import { simulateConvert } from '../../providers/stablefx/stableFxAdapter';
import type { PolicyEvaluationResult } from '../policy/policyTypes';
import type { RiskScoringResult } from '../risk/riskTypes';
import type { ConvertSimulationResult } from '../../providers/stablefx/stableFxAdapter';

// ── Pipeline status ───────────────────────────────────────────────────────────

export type ConvertPipelineStatus =
  | 'PENDING'
  | 'VALIDATING'
  | 'POLICY_BLOCKED'
  | 'RISK_BLOCKED'
  | 'SIMULATION_FAILED'
  | 'AWAITING_APPROVAL'
  | 'SIGNING'
  | 'BROADCASTING'
  | 'VERIFYING'
  | 'VERIFIED'
  | 'FAILED';

export interface ConvertPipelineEvaluation {
  action: ConvertAction;
  policyResult: PolicyEvaluationResult;
  riskResult: RiskScoringResult;
  simulationResult: ConvertSimulationResult;
  canProceed: boolean;
  blockedReason?: string;
}

// ── Deterministic pre-execution evaluation ────────────────────────────────────

export function evaluateConvertAction(action: ConvertAction): ConvertPipelineEvaluation {
  // 1. Schema
  const schemaResult = validateAction(action);
  if (!schemaResult.valid) {
    const msg = `Schema invalid: ${schemaResult.details.join('; ')}`;
    return {
      action,
      policyResult: { decision: 'BLOCKED', ruleResults: [], blockedBy: [], confirmationRequired: [] },
      riskResult: { score: 100, level: 'CRITICAL', factors: [], providerId: action.providerId, computedAt: Date.now() },
      simulationResult: { ok: false, amountIn: action.amountIn, minAmountOut: action.minAmountOut, quoteRate: '0', detail: msg },
      canProceed: false,
      blockedReason: msg,
    };
  }

  // 2. Risk (compute first — policy MAX_RISK rule needs the score)
  const riskProfile = getProviderRiskProfile(action.providerId);
  const riskResult = scoreAction({
    providerProfiles: [riskProfile],
    chainId: action.chainId,
    wasSimulated: false, // simulation runs next
  });

  // 3. Policy
  const policyResult = evaluatePolicy(action, {
    riskScore: riskResult.score,
    simulationCompleted: false,
    quoteId: action.provenance.quoteId,
    providerId: action.providerId,
  }, DEFAULT_VEYRA_POLICY);

  if (policyResult.decision === 'BLOCKED') {
    return {
      action,
      policyResult,
      riskResult,
      simulationResult: { ok: false, amountIn: action.amountIn, minAmountOut: action.minAmountOut, quoteRate: '0', detail: 'Policy blocked' },
      canProceed: false,
      blockedReason: `Policy blocked: ${policyResult.blockedBy.join(', ')}`,
    };
  }

  if (riskResult.level === 'CRITICAL') {
    return {
      action,
      policyResult,
      riskResult,
      simulationResult: { ok: false, amountIn: action.amountIn, minAmountOut: action.minAmountOut, quoteRate: '0', detail: 'Risk too high' },
      canProceed: false,
      blockedReason: `Risk too high: CRITICAL (${riskResult.score})`,
    };
  }

  // 4. Simulation
  const simulationResult = simulateConvert(action);
  if (!simulationResult.ok) {
    return { action, policyResult, riskResult, simulationResult, canProceed: false, blockedReason: `Simulation failed: ${simulationResult.detail ?? 'unknown'}` };
  }

  return { action, policyResult, riskResult, simulationResult, canProceed: true };
}
