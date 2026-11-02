/** Fail-closed durable handoff before the Circle SDK can ask for any asset approval
 * or submit the original Exchange transaction.
 *
 * The existing per-mode recovery key is retained for backwards-compatible
 * onchain reconciliation, while the new wallet-scoped journal owns the timeline.
 */
import {createExchangeIntent,advanceExchangeIntent,type ExchangeIntent} from './exchangeIntentJournal';

type RecoveryStorage=Pick<Storage,'getItem'|'setItem'|'removeItem'|'key'|'length'>;
export type ReserveResult={kind:'reserved'}|{kind:'blocked';message:string};
export function reserveCircleExchangeBeforeSigning(args:{
 intent:ExchangeIntent;legacyKey:string;recoveryRecord:string;storage:RecoveryStorage;
}):ReserveResult{
 const {intent,legacyKey,recoveryRecord,storage}=args;
 let created=false,legacySaved=false;
 try{
  if(storage.getItem(legacyKey)!==null)
   return {kind:'blocked',message:'Previous original Exchange operation must be resolved first.'};
  if(!createExchangeIntent(intent,storage))
   return {kind:'blocked',message:'An unresolved Exchange journal exists or storage is unavailable. No wallet trade started.'};
  created=true;
  // No financial signing has happened; a failed local write is safe to roll back.
  storage.setItem(legacyKey,recoveryRecord);
  if(storage.getItem(legacyKey)!==recoveryRecord)throw Error('Recovery record could not be read back.');
  legacySaved=true;
  if(!advanceExchangeIntent(intent.owner,intent.id,'AWAITING_WALLET',{},storage))
   throw Error('Exchange timeline could not be locked before wallet signing.');
  return {kind:'reserved'};
 }catch{
  // A failure to unlock safely leaves the legacy record intact, rather than
  // allowing an unknown second financial action.
  let legacyCleared=!legacySaved;
  if(legacySaved)try{
   if(storage.getItem(legacyKey)===recoveryRecord){
    storage.removeItem(legacyKey);
    legacyCleared=storage.getItem(legacyKey)===null;
   }
  }catch{/* fail closed */}
  if(created&&legacyCleared){
   try{advanceExchangeIntent(intent.owner,intent.id,'CANCELLED_BEFORE_SOURCE',{},storage);}catch{/* fail closed */}
  }
  return {kind:'blocked',message:legacyCleared?
   'Could not persist both Exchange records. No financial signing occurred; inspect storage.':
   'Exchange recovery lock could not be released. Do not retry signing.'};
 }
}
