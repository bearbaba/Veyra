import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createBridgeAction, evaluateBridgeAction } from '../core/pipeline/bridgePipeline';
import { matchesCctpSimulation, type BridgeSimulationEvidence } from '../core/execution/cctpSourceSimulation';
import { MANIFEST_CONSTANTS } from '../providers/registry/providerManifest';

const source=readFileSync(new URL('../../server/services/activityReceiptService.ts',import.meta.url),'utf8');
const makeAction=()=>createBridgeAction({
  from:'0x4C7cb73aC8F8999af21cfc9fF4cF2333a9508Dcb',
  to:'0xEE8fB2f35EAAa614286e32b4813D42B5dBb76579',
  amount:10_000_000n,
  sourceChainId:MANIFEST_CONSTANTS.ARC_TESTNET_CHAIN_ID,
  destinationChainId:MANIFEST_CONSTANTS.ETH_SEPOLIA_CHAIN_ID,
  tokenAddress:MANIFEST_CONSTANTS.ARC_TESTNET_USDC,
  tokenDecimals:6,
});

describe('Phase 26: BFF bridge receipt must independently prove CCTP simulation',()=>{
  it('never issues a reviewed receipt when the simulation proof is missing',()=>{
    const a=makeAction();
    expect(evaluateBridgeAction(a).policyResult.blockedBy).toContain('SIMULATION_REQUIRED');
  });

  it('accepts only fresh matching evidence and does not weaken the policy',()=>{
    const a=makeAction();
    const proof:BridgeSimulationEvidence={
      actionId:a.actionId,sender:a.from,recipient:a.to,tokenAddress:a.tokenAddress,
      amount:a.amount,sourceChainId:a.sourceChainId,
      destinationChainId:a.destinationChainId,
      simulatedCall:'CCTP_V2_DEPOSIT_FOR_BURN',checkedAt:Date.now(),
    };
    expect(matchesCctpSimulation(a,proof)).toBe(true);
    expect(evaluateBridgeAction(a,proof).policyResult.blockedBy).not.toContain('SIMULATION_REQUIRED');
    for(const fake of [
      {...proof,actionId:'some-other-route'},
      {...proof,amount:a.amount+1n},
      {...proof,sender:'0x0000000000000000000000000000000000000001'},
      {...proof,recipient:'0x0000000000000000000000000000000000000001'},
      {...proof,sourceChainId:8453},
      {...proof,checkedAt:Date.now()-21_000},
    ]) {
      expect(evaluateBridgeAction(a,fake).policyResult.blockedBy).toContain('SIMULATION_REQUIRED');
    }
  });

  it('server reads chain independently and simulates before calling policy and creating durable receipt',()=>{
    const build=source.indexOf('const sourceClient = createPublicClient(');
    const simulate=source.indexOf('await simulateCctpSourceBurn(sourceClient, action)');
    const evaluate=source.indexOf('const evaluation = evaluateBridgeAction(action, simulation.proof)');
    const receipt=source.indexOf('receiptId = await createReceipt(db, createParams)');
    expect(build).toBeGreaterThan(0);
    expect(simulate).toBeGreaterThan(build);
    expect(evaluate).toBeGreaterThan(simulate);
    expect(receipt).toBeGreaterThan(evaluate);
    expect(source).toContain("simulation.status !== 'READY'");
    expect(source).toContain("'CCTP_ALLOWANCE_REQUIRED'");
    expect(source).toContain("'CCTP_SOURCE_SIMULATION_FAILED'");
    expect(source).toContain('process.env.ARC_TESTNET_RPC_URL');
    expect(source).toContain('retryCount: 0');
    expect(source).not.toContain('evaluateBridgeAction(action);');
  });

  it('ignores browser-provided policy claims when issuing receipt',()=>{
    expect(source).toContain('policyResult?: Record<string, unknown>');
    // A client may include a policy claim, but the server alone creates the
    // persisted policyResult from a verified deterministic evaluation.
    const approval=source.indexOf('policyResult: {\n      decision: evaluation.policyResult.decision');
    expect(approval).toBeGreaterThan(0);
    expect(source.slice(approval,approval+390)).not.toContain('input.policyResult');
  });
});
