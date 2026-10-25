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
  retry: () => void;
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
  const [retryGeneration,setRetryGeneration]=useState(0);
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
        if(!cancelled){
          const details=cause instanceof Error?cause.message:'Simulation unavailable';
          const rpcFailure=/HTTP request failed|fetch failed|timeout|rate limit|\b429\b|\b50[0234]\b|network error|CORS|Failed to fetch/i.test(details);
          setError(rpcFailure
            ? 'Arc Testnet connection is temporarily unavailable. No funds were sent. Retry the safety check.'
            : 'Transfer simulation failed. '+details.split('\n')[0].slice(0,155));
        }
      }finally{if(!cancelled)setLoading(false);}
    })();
    return()=>{cancelled=true;};
  },[action,client,retryGeneration]);
  return {policy,risk,loading,error,retry:()=>setRetryGeneration(n=>n+1)};
}
