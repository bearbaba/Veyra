import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import type { PublicClient } from 'viem';
import { createBridgeAction, evaluateBridgeAction } from '../core/pipeline/bridgePipeline';
import { simulateCctpSourceBurn, simulateExactCctpApproval, matchesCctpSimulation } from '../core/execution/cctpSourceSimulation';
import { cctpDepositForBurnCall } from '../providers/cctp/cctpV2Adapter';
import { MANIFEST_CONSTANTS } from '../providers/registry/providerManifest';

const action=()=>createBridgeAction({
  from:'0x4C7cb73aC8F8999af21cfc9fF4cF2333a9508Dcb',
  to:'0xEE8fB2f35EAAa614286e32b4813D42B5dBb76579',
  amount:10_000_000n,
  sourceChainId:MANIFEST_CONSTANTS.ARC_TESTNET_CHAIN_ID,
  destinationChainId:MANIFEST_CONSTANTS.ETH_SEPOLIA_CHAIN_ID,
  tokenAddress:MANIFEST_CONSTANTS.ARC_TESTNET_USDC,
  tokenDecimals:6,
});
const fake=(allowance=10_000_000n, balance=20_000_000n)=>{
  const calls:unknown[]=[];
  const client={
    getChainId:vi.fn((): Promise<number> => Promise.resolve(MANIFEST_CONSTANTS.ARC_TESTNET_CHAIN_ID)),
    readContract:vi.fn((query:{functionName:string})=>Promise.resolve(query.functionName==='balanceOf'?balance:allowance)),
    getCode:vi.fn(()=>Promise.resolve('0x1234')),
    simulateContract:vi.fn((params:unknown)=>{calls.push(params);return Promise.resolve({request:params});}),
  };
  return {client:client as unknown as PublicClient,calls, mocks:client};
};
const read=(p:string)=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');

describe('Phase 23 — actual CCTP deposit simulation and explicit approval gate',()=>{
  it('never marks Bridge policy simulated merely from a provider quote',()=>{
    const a=action();
    const result=evaluateBridgeAction(a);
    expect(result.canProceed).toBe(false);
    expect(result.policyResult.blockedBy).toContain('SIMULATION_REQUIRED');
  });
  it('allows policy review only after exact source-chain deposit eth_call',async()=>{
    const a=action();const f=fake();
    const result=await simulateCctpSourceBurn(f.client,a);
    expect(result.status).toBe('READY');
    if(result.status!=='READY')return;
    expect(f.mocks.simulateContract).toHaveBeenCalledTimes(1);
    const call=f.calls[0] as ReturnType<typeof cctpDepositForBurnCall>;
    expect(call.functionName).toBe('depositForBurn');
    expect(call.address.toLowerCase()).toBe(MANIFEST_CONSTANTS.CCTP_V2_TOKEN_MESSENGER.toLowerCase());
    expect(call.args).toEqual(cctpDepositForBurnCall(a).args);
    expect(call.account.toLowerCase()).toBe(a.from.toLowerCase());
    expect(matchesCctpSimulation(a,result.proof)).toBe(true);
    const evaluation=evaluateBridgeAction(a,result.proof);
    expect(evaluation.policyResult.blockedBy).not.toContain('SIMULATION_REQUIRED');
  });
  it('rejects stale proof and any changed amount, recipient, route or wallet',async()=>{
    const a=action(),f=fake();
    const sim=await simulateCctpSourceBurn(f.client,a);
    if(sim.status!=='READY')throw new Error('Fixture simulation failed');
    expect(matchesCctpSimulation(a,{...sim.proof,checkedAt:Date.now()-25_000})).toBe(false);
    expect(matchesCctpSimulation({...a,amount:a.amount+1n},sim.proof)).toBe(false);
    expect(matchesCctpSimulation({...a,to:'0x0000000000000000000000000000000000000001'},sim.proof)).toBe(false);
    expect(matchesCctpSimulation({...a,sourceChainId:8453},sim.proof)).toBe(false);
    expect(matchesCctpSimulation({...a,from:'0x0000000000000000000000000000000000000001'},sim.proof)).toBe(false);
    expect(evaluateBridgeAction(a,{...sim.proof,checkedAt:Date.now()-25_000}).canProceed).toBe(false);
  });
  it('does not claim burn simulation when allowance is missing',async()=>{
    const f=fake(0n),result=await simulateCctpSourceBurn(f.client,action());
    expect(result).toEqual({status:'APPROVAL_REQUIRED',allowance:0n});
    expect(f.mocks.simulateContract).not.toHaveBeenCalled();
  });
  it('blocks insufficient funds, source RPC mismatch and eth_call failures',async()=>{
    const low=fake(10_000_000n,1_000_000n);
    const result=await simulateCctpSourceBurn(low.client,action());
    expect(result.status).toBe('BLOCKED');
    expect(low.mocks.simulateContract).not.toHaveBeenCalled();
    const mismatch=fake();mismatch.mocks.getChainId.mockResolvedValue(8453);
    expect((await simulateCctpSourceBurn(mismatch.client,action())).status).toBe('BLOCKED');
    const revert=fake();revert.mocks.simulateContract.mockRejectedValue(new Error('revert'));
    expect((await simulateCctpSourceBurn(revert.client,action())).status).toBe('BLOCKED');
  });
  it('requires actual exact-amount approve simulation without treating it as a burn',async()=>{
    const f=fake(0n);const a=action();
    await simulateExactCctpApproval(f.client,a);
    expect(f.mocks.simulateContract).toHaveBeenCalledTimes(1);
    const request=f.calls[0] as {functionName:string;args:readonly unknown[]};
    expect(request.functionName).toBe('approve');
    expect(request.args[0]).toBe(MANIFEST_CONSTANTS.CCTP_V2_TOKEN_MESSENGER);
    expect(request.args[1]).toBe(10_000_000n);
    expect(evaluateBridgeAction(a).canProceed).toBe(false);
  });
  it('holds blocked-origin Preview and checks simulation again before irreversible burn',()=>{
    const page=read('src/components/pages/BridgePage.tsx');
    const hook=read('src/hooks/useBridgeExecution.ts');
    const adapter=read('src/providers/cctp/cctpV2Adapter.ts');
    expect(page).toContain("social.identityOrigin !== 'ready'");
    expect(page).toContain("phase: 'APPROVAL_REQUIRED'");
    expect(page).toContain('simulateExactCctpApproval(sourcePublicClient,action)');
    expect(page).toContain('simulateCctpSourceBurn(sourcePublicClient, executionAction)');
    expect(hook).toContain('const burnSimulation = await simulateCctpSourceBurn(sourcePublicClient, action)');
    expect(hook.indexOf('const burnSimulation = await simulateCctpSourceBurn')).toBeLessThan(
      hook.indexOf('markActionExecutionSubmissionStarted(action.actionId)'));
    expect(adapter).toContain('cctpDepositForBurnCall(action)');
    expect(page).not.toContain("simulationCompleted: true");
    expect(page).not.toContain('walletClient.signTransaction');
  });
});
