import { useState, useEffect } from 'react';
import {usePublicClient} from 'wagmi';
import type { VeyraAction } from '@/core/actions/actionSchema';
import type { PolicyEvaluationResult } from '@/core/policy/policyTypes';
import type { RiskScoringResult } from '@/core/risk/riskTypes';
import { MANIFEST_CONSTANTS } from '@/providers/registry/providerManifest';
import { evaluateTransferSafety, REVIEWED_TRANSFER_ABI, assertSuccessfulTransferSimulation } from '@/core/execution/transferSafetyGate';

export interface PipelineEvaluation {
  policy: PolicyEvaluationResult | null;
  risk: RiskScoringResult | null;
  loading: boolean;
  error: string | null;
}
/**
 * Only a successful real Arc Testnet ERC-20 eth_call can mark a transfer
 * simulated. A placeholder simulationCompleted flag is never accepted.
 * Late results from a superseded action must not enable a stale review.
 */
export function usePipelineEvaluation(action: VeyraAction | null): PipelineEvaluation {
  const client=usePublicClient({chainId:MANIFEST_CONSTANTS.ARC_TESTNET_CHAIN_ID});
  const [policy,setPolicy]=useState<PolicyEvaluationResult|null>(null);
  const [risk,setRisk]=useState<RiskScoringResult|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState<string|null>(null);
  useEffect(()=>{
    let cancelled=false;
    setLoading(true);setPolicy(null);setRisk(null);setError(null);
    if(!action){setLoading(false);return;}
    void (async()=>{
      try{
        if(action.actionType!=='TRANSFER'||action.chainId!==MANIFEST_CONSTANTS.ARC_TESTNET_CHAIN_ID||!client)
          throw Error('Transfer review requires an Arc Testnet RPC simulator.');
        const simulation=await client.simulateContract({
          address:action.tokenAddress as `0x${string}`,
          abi:REVIEWED_TRANSFER_ABI,functionName:'transfer',
          args:[action.to as `0x${string}`,action.amount],
          account:action.from as `0x${string}`,
        });
        assertSuccessfulTransferSimulation(simulation.result);
        if(cancelled)return;
        const result=evaluateTransferSafety(action,true);
        setRisk(result.risk);setPolicy(result.policy);
      }catch(cause){
        if(!cancelled)setError(cause instanceof Error
          ? 'Transfer simulation failed: '+cause.message.slice(0,180)
          : 'Transfer simulation failed. Signing is blocked.');
      }finally{if(!cancelled)setLoading(false);}
    })();
    return()=>{cancelled=true;};
  },[action,client]);
  return {policy,risk,loading,error};
}
