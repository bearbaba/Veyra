/** Read-only onchain checks for Veyra transactions in the automatic Activity ledger. */
import {buildMainnetPayPlan,reconcileMainnetCanary} from './arcMainnetPay';
import {inspectRecordedSettlement} from './verifyRecordedSettlement';
import type {LocalOperation} from './localOperations';

export type OperationInspection={
 status:'VERIFIED'|'REVERTED'|'PENDING'|'UNVERIFIED'|'UNKNOWN'|'PROVIDER';
 detail:string;
};
export async function inspectRecordedOperation(v:LocalOperation,owner:string):Promise<OperationInspection>{
 if(v.owner.toLowerCase()!==owner.toLowerCase())
  return {status:'UNVERIFIED',detail:'Transaction belongs to a different wallet.'};
 if(v.type==='Pay'){
  if(!v.destination)return {status:'UNVERIFIED',detail:'Original recipient missing. Cannot verify.'};
  try{
   const plan=buildMainnetPayPlan(owner,v.destination,v.amount);
   const result=await reconcileMainnetCanary(plan,v.hash);
   if(result.state==='VERIFIED')
    return {status:'VERIFIED',detail:'The original Arc USDC transfer, recipient, amount, token, receipt and canonical block match.'};
   if(result.state==='REVERTED')
    return {status:'REVERTED',detail:'This original Arc payment reverted. Do not interpret it as funds received.'};
   return {status:'PENDING',detail:'Original payment is awaiting onchain confirmation. No second signature is needed.'};
  }catch(e){
   return {status:'UNVERIFIED',detail:e instanceof Error?e.message:'Original payment could not be verified.'};
  }
 }
 if(v.type==='Settlement'){
  const checked=await inspectRecordedSettlement(v.hash,owner,v.amount,v.destination);
  return {status:checked.status==='VERIFIED'?'VERIFIED':
   checked.status==='REVERTED'?'REVERTED':checked.status==='PENDING'?'PENDING':'UNVERIFIED',
   detail:checked.detail};
 }
 return {status:'PROVIDER',detail:v.status==='SUBMITTED'
  ?'Circle workflow is tracking the original transaction. Open the original route for its provider receipt; do not resubmit.'
  :'Previously recorded by Circle workflow. Full source and destination proof is still handled in that route.'};
}
