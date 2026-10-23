import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {evaluateTransferSafety,assertTransferSafety,REVIEWED_TRANSFER_ABI} from '../core/execution/transferSafetyGate';
import type {TransferAction} from '../core/actions/actionSchema';
import {MANIFEST_CONSTANTS} from '../providers/registry/providerManifest';
const read=(p:string)=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
function action(amt=1_000_000n):TransferAction {
 return {
  actionType:'TRANSFER',actionId:'audit-transfer',createdAt:Date.now(),
  chainId:MANIFEST_CONSTANTS.ARC_TESTNET_CHAIN_ID,
  provenance:{source:'USER_DIRECT',fetchedAt:Date.now()},
  tokenAddress:MANIFEST_CONSTANTS.ARC_TESTNET_USDC.toLowerCase(),
  tokenDecimals:6,amount:amt,
  from:'0x1111111111111111111111111111111111111111',
  to:'0x2222222222222222222222222222222222222222',
 };
}
describe('Transfer must pass real simulation and deterministic policy/risk',()=>{
 it('cannot sign on missing simulation',()=>{
   const d=evaluateTransferSafety(action(),false);
   expect(d.policy.blockedBy).toContain('SIMULATION_REQUIRED');
   expect(()=>assertTransferSafety(d,true)).toThrow('simulation');
 });
 it('provides scored MAX_RISK and genuinely simulated PASS/confirmation',()=>{
   const d=evaluateTransferSafety(action(),true);
   expect(d.policy.blockedBy).not.toContain('MAX_RISK');
   expect(d.policy.blockedBy).not.toContain('SIMULATION_REQUIRED');
   if(d.policy.decision==='PASS')expect(()=>assertTransferSafety(d,false)).not.toThrow();
   else if(d.policy.decision==='NEEDS_CONFIRMATION')expect(()=>assertTransferSafety(d,true)).not.toThrow();
   else throw Error('Fresh small USDC transfer unexpectedly blocked');
 });
 it('blocks over-limit payments and stale quotes even after simulation',()=>{
   const d=evaluateTransferSafety(action(100_000_000_000n),true);
   expect(d.policy.blockedBy).toContain('MAX_SINGLE_TX_AMOUNT');
   expect(()=>assertTransferSafety(d,true)).toThrow('policy');
   const stale=action();stale.provenance.fetchedAt=Date.now()-120_000;
   const s=evaluateTransferSafety(stale,true);
   expect(s.policy.blockedBy).toContain('STALE_DATA_BLOCK');
   expect(()=>assertTransferSafety(s,true)).toThrow('policy');
 });
 it('refuses missing policy, missing risk, high risk and unacknowledged confirmation',()=>{
   const d=evaluateTransferSafety(action(),true);
   expect(()=>assertTransferSafety({...d,policy:null!},true)).toThrow();
   expect(()=>assertTransferSafety({...d,risk:null!},true)).toThrow();
   expect(()=>assertTransferSafety({...d,risk:{...d.risk,level:'CRITICAL',score:99}},true)).toThrow('risk');
   expect(()=>assertTransferSafety({...d,policy:{...d.policy,decision:'NEEDS_CONFIRMATION'}},false)).toThrow('confirmation');
 });
 it('real simulation occurs both before review and immediately before wallet signature',()=>{
   expect(REVIEWED_TRANSFER_ABI[0].name).toBe('transfer');
   const hook=read('hooks/usePipelineEvaluation.ts');
   const exec=read('hooks/useTransferExecution.ts');
   const sheet=read('components/transfer/TransactionReviewSheet.tsx');
   expect(hook).toContain('await client.simulateContract({');
   expect(hook).toContain('evaluateTransferSafety(action,true)');
   expect(exec).toContain('await publicClient.simulateContract({');
   expect(exec).toContain('assertTransferSafety(evaluateTransferSafety(action,true),confirmedAtReview)');
   expect(sheet).toContain('const isBlocked = !policy || !risk');
 });
});
