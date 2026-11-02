/** Commit verified original proof to one Exchange timeline in deterministic order.
 * This function is called ONLY after source + destination onchain verification.
 * It never initiates a transfer or treats an SDK success message as settlement.
 */
import {advanceExchangeIntent,readExchangeIntents,type ExchangeIntent} from './exchangeIntentJournal';
type Store=Pick<Storage,'getItem'|'setItem'|'removeItem'|'key'|'length'>;
export type VerifiedExchangeProof={
 owner:string;intentId:string;sourceHash:string;destinationHash:string;
 sourceChainId:number;destinationChainId:number;sourceToken:string;destinationToken:string;
 checkedAt:number;
};
export type RecordVerifiedExchangeResult=
 | {kind:'recorded'}
 | {kind:'blocked';reason:string};
const HASH=/^0x[0-9a-f]{64}$/i;
export function recordVerifiedExchangeProof(proof:VerifiedExchangeProof,s?:Store):RecordVerifiedExchangeResult{
 if(!HASH.test(proof.sourceHash)||!HASH.test(proof.destinationHash)||
  !Number.isSafeInteger(proof.sourceChainId)||!Number.isSafeInteger(proof.destinationChainId))
  return {kind:'blocked',reason:'Invalid original proof hash or network.'};
 const all=readExchangeIntents(proof.owner,s);
 if(all.kind!=='ready')return {kind:'blocked',reason:'Exchange recovery journal is unavailable.'};
 const entry=all.items.find(v=>v.id===proof.intentId);
 if(!entry||entry.owner.toLowerCase()!==proof.owner.toLowerCase()||
  entry.fromChainId!==proof.sourceChainId||entry.toChainId!==proof.destinationChainId||
  entry.tokenIn!==proof.sourceToken||entry.tokenOut!==proof.destinationToken)
  return {kind:'blocked',reason:'Original Exchange selection does not match destination proof.'};
 if(entry.sourceHash&&entry.sourceHash.toLowerCase()!==proof.sourceHash.toLowerCase())
  return {kind:'blocked',reason:'Original source hash changed. Do not retry.'};
 if(entry.destinationHash&&entry.destinationHash.toLowerCase()!==proof.destinationHash.toLowerCase())
  return {kind:'blocked',reason:'Destination hash conflicts with original evidence.'};
 if(entry.stage==='DESTINATION_VERIFIED')return {kind:'recorded'};
 if(entry.stage==='REFUNDED'||entry.stage==='CANCELLED_BEFORE_SOURCE')
  return {kind:'blocked',reason:'Exchange was already closed or refunded.'};

 const change=(next:ExchangeIntent['stage'],changes:Parameters<typeof advanceExchangeIntent>[3])=>
  advanceExchangeIntent(entry.owner,entry.id,next,changes,s,proof.checkedAt);
 let stage=entry.stage;
 if(stage==='AWAITING_WALLET'){
  // Proofs are already verified onchain: attach original hash first.
  if(!change('SOURCE_UNKNOWN',{message:'Reconstructing original source proof after reconnect.'}))
   return {kind:'blocked',reason:'Cannot persist recovered source state.'};
  stage='SOURCE_UNKNOWN';
 }
 if(stage==='SOURCE_UNKNOWN'){
  if(!change('SOURCE_SUBMITTED',{sourceHash:proof.sourceHash,steps:[
   {stage:'source',chainId:proof.sourceChainId,token:proof.sourceToken,status:'verified',
    hash:proof.sourceHash,checkedAt:proof.checkedAt}]}))
   return {kind:'blocked',reason:'Cannot persist original transaction evidence.'};
  stage='SOURCE_SUBMITTED';
 }
 if(stage==='SOURCE_SUBMITTED'){
  if(!change('SOURCE_CONFIRMED',{sourceHash:proof.sourceHash}))
   return {kind:'blocked',reason:'Cannot persist confirmed source evidence.'};
  stage='SOURCE_CONFIRMED';
 }
 if(!(['SOURCE_CONFIRMED','DESTINATION_PENDING','PARTIAL'] as string[]).includes(stage))
  return {kind:'blocked',reason:'Unexpected Exchange stage. Never overwrite original journal.'};
 const success=change('DESTINATION_VERIFIED',{
  sourceHash:proof.sourceHash,destinationHash:proof.destinationHash,
  message:'Destination token transfer verified onchain; original source proof retained.',
  steps:[{stage:'source',chainId:proof.sourceChainId,token:proof.sourceToken,
   status:'verified',hash:proof.sourceHash,checkedAt:proof.checkedAt},
   {stage:'destination',chainId:proof.destinationChainId,token:proof.destinationToken,
    status:'verified',hash:proof.destinationHash,checkedAt:proof.checkedAt}]});
 return success?{kind:'recorded'}:{kind:'blocked',reason:'Verified transfer was not saved to Exchange history.'};
}
