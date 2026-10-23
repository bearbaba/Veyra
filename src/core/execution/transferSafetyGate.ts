/**
 * Deterministic USDC transfer policy/risk check, reused at review and at the
 * final wallet-signature boundary. Only a real ERC-20 eth_call is simulation.
 */
import type {TransferAction} from '../actions/actionSchema';
import {evaluatePolicy,DEFAULT_VEYRA_POLICY} from '../policy/policyEngine';
import {scoreAction,getProviderRiskProfile} from '../risk/riskEngine';
import type {RiskScoringResult} from '../risk/riskTypes';
import type {PolicyEvaluationResult} from '../policy/policyTypes';

export const REVIEWED_TRANSFER_ABI=[{
  name:'transfer',type:'function',stateMutability:'nonpayable',
  inputs:[{name:'to',type:'address'},{name:'value',type:'uint256'}],
  outputs:[{name:'',type:'bool'}],
}] as const;

export interface TransferSafetyDecision {
  policy:PolicyEvaluationResult;
  risk:RiskScoringResult;
  simulated:boolean;
}
export function evaluateTransferSafety(action:TransferAction,simulated:boolean):TransferSafetyDecision {
  const risk=scoreAction({
    providerProfiles:[getProviderRiskProfile('arc-erc20-transfer')],
    chainId:action.chainId,wasSimulated:simulated,
  });
  const policy=evaluatePolicy(action,{
    contractAddresses:[action.tokenAddress],
    riskScore:risk.score,
    simulationCompleted:simulated,
    quoteId:action.provenance.quoteId,
  },DEFAULT_VEYRA_POLICY);
  return {policy,risk,simulated};
}
export function assertTransferSafety(decision:TransferSafetyDecision,confirmed:boolean):void {
  if(!decision.simulated)throw Error('Transfer simulation is required before signing.');
  if(!decision.policy||decision.policy.decision==='BLOCKED')
    throw Error('Transfer policy blocked this action.');
  if(!decision.risk||!Number.isFinite(decision.risk.score)||
     !['LOW','MEDIUM'].includes(decision.risk.level))
    throw Error('Transfer risk is unacceptably high or unavailable.');
  if(decision.policy.decision==='NEEDS_CONFIRMATION'&&!confirmed)
    throw Error('A fresh confirmation is required for this transfer.');
}
