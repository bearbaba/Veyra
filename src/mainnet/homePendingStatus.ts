/**
 * Home warnings describe unresolved operations only. Server receipts and terminal
 * Exchange journal stages suppress presentation warnings but never authorize signing
 * or release a financial recovery lock.
 */
import type {LocalOperation} from './localOperations';
import type {ExchangeIntent} from './exchangeIntentJournal';

const terminalStages=new Set<ExchangeIntent['stage']>([
 'DESTINATION_VERIFIED','REFUNDED','SOURCE_REVERTED','CANCELLED_BEFORE_SOURCE',
]);

export function unresolvedHomeOperations(
 operations:readonly LocalOperation[],
 verifiedPayHashes:ReadonlySet<string>,
 exchangeIntents:readonly ExchangeIntent[],
):LocalOperation[]{
 const terminalExchangeHashes=new Set<string>();
 for(const intent of exchangeIntents){
  if(!terminalStages.has(intent.stage))continue;
  if(intent.sourceHash)terminalExchangeHashes.add(intent.sourceHash.toLowerCase());
  if(intent.destinationHash)terminalExchangeHashes.add(intent.destinationHash.toLowerCase());
 }
 return operations.filter(operation=>{
  if(operation.status!=='SUBMITTED')return false;
  const hash=operation.hash.toLowerCase();
  if((operation.type==='Pay'||operation.type==='Settlement')&&verifiedPayHashes.has(hash))
   return false;
  if((operation.type==='Swap'||operation.type==='Bridge')&&terminalExchangeHashes.has(hash))
   return false;
  return operation.type==='Pay'||operation.type==='Settlement'||
   operation.type==='Swap'||operation.type==='Bridge';
 });
}
