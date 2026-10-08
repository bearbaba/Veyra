/**
 * Veyra Pipeline Evaluation Hook
 *
 * Runs Policy + Risk evaluation deterministically against a VeyraAction.
 * Used by the Transaction Review Sheet before presenting the action to the user.
 */

import { useState, useEffect, useCallback } from 'react';
import type { VeyraAction } from '@/core/actions/actionSchema';
import { evaluatePolicy, DEFAULT_VEYRA_POLICY } from '@/core/policy/policyEngine';
import { scoreAction, getProviderRiskProfile } from '@/core/risk/riskEngine';
import type { PolicyEvaluationResult } from '@/core/policy/policyTypes';
import type { RiskScoringResult } from '@/core/risk/riskTypes';

export interface PipelineEvaluation {
  policy: PolicyEvaluationResult | null;
  risk: RiskScoringResult | null;
  loading: boolean;
  error: string | null;
}

export function usePipelineEvaluation(action: VeyraAction | null): PipelineEvaluation {
  const [policy, setPolicy]   = useState<PolicyEvaluationResult | null>(null);
  const [risk, setRisk]       = useState<RiskScoringResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const evaluate = useCallback((a: VeyraAction) => {
    setLoading(true);
    setError(null);
    setPolicy(null);
    setRisk(null);

    try {
      // Known safe contracts on Arc Testnet
      const knownContracts = [
        '0x3600000000000000000000000000000000000000', // Arc Testnet USDC ERC-20
      ];

      const policyCtx = {
        contractAddresses: knownContracts,
        simulationCompleted: false,
      };

      const policyResult = evaluatePolicy(a, policyCtx, DEFAULT_VEYRA_POLICY);
      setPolicy(policyResult);

      const profile = getProviderRiskProfile('arc-erc20-transfer');
      const riskResult = scoreAction({
        providerProfiles: [profile],
        chainId: a.chainId,
        wasSimulated: false,
      });
      setRisk(riskResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Pipeline evaluation failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!action) {
      setPolicy(null);
      setRisk(null);
      setError(null);
      return;
    }
    evaluate(action);
  }, [action, evaluate]);

  return { policy, risk, loading, error };
}
