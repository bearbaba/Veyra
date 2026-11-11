/** Explicitly start a new, separately reviewed Bridge while preserving an old
 * source-UNKNOWN request. Never call automatically, never infer failed payment,
 * and never submit or sign a transaction here.
 *
 * A legacy per-mode recovery key is moved to an owner-scoped archive, while the
 * original Exchange timeline remains SOURCE_UNKNOWN. New requests get a fresh
 * intent ID, quote and wallet confirmation.
 */
import {parseUnits} from 'viem';
import {readExchangeIntents,authorizeSeparateExchangeIntent} from './exchangeIntentJournal';
import {circleCctpBridgePair} from './circleBridgePolicy';

export type UnverifiedBridgeRequest={
 owner:string;mode:'swap'|'bridge';amount:string;minimum:string;
 source:number;destination:number;fromToken:'USDC'|'EURC';toToken:'USDC'|'EURC';
 status:'UNKNOWN'|'PENDING'|'VERIFIED'|'REVERTED';intentId?:string;
 hash?:string;burnHash?:string;mintHash?:string;
};
export type BridgeArchive={
 record:UnverifiedBridgeRequest;archivedAt:number;
 /** This is only a browser-local copy, not proof that funds were sent. */
 status:'SOURCE_OUTCOME_UNKNOWN';
};
type Store=Pick<Storage,'getItem'|'setItem'|'removeItem'|'length'|'key'>;
const OWNER=/^0x[0-9a-f]{40}$/i,UUID=/^[0-9a-f-]{36}$/i;
const PREFIX='veyra:mainnet:unknown-bridge-archive:v1:';
export const unverifiedBridgeArchiveKey=(owner:string,id:string)=>PREFIX+owner.toLowerCase()+':'+id.toLowerCase();
export type IndependentBridgeAuthorization={kind:'ready'}|{kind:'blocked';reason:string};

export function authorizeIndependentBridge(args:{
 owner:string;legacyKey:string;record:UnverifiedBridgeRequest;
 archiveId:string;storage:Store;now?:number;
}):IndependentBridgeAuthorization{
 const {owner,legacyKey,record,archiveId,storage}=args,now=args.now??Date.now();
 const blocked=(reason:string):IndependentBridgeAuthorization=>({kind:'blocked',reason});
 if(!OWNER.test(owner)||record.owner!==owner.toLowerCase()||record.mode!=='bridge'||
    !UUID.test(archiveId)||!Number.isSafeInteger(now)||
    !circleCctpBridgePair(record.source,record.destination,'USDC','USDC')||
    record.fromToken!=='USDC'||record.toToken!=='USDC'||
    !['UNKNOWN','PENDING'].includes(record.status)||
    record.hash||record.burnHash||record.mintHash)
  return blocked('The original Bridge has transaction evidence or does not match this wallet.');
 try{
  const amount=parseUnits(record.amount,6),minimum=parseUnits(record.minimum,6);
  if(amount<=0n||minimum<=0n||minimum>amount)return blocked('Original transfer amounts are invalid.');
  const raw=storage.getItem(legacyKey);
  if(!raw)return blocked('Previous Bridge record changed. Reload Bridge.');
  const current:unknown=JSON.parse(raw);
  if(JSON.stringify(current)!==JSON.stringify(record))
   return blocked('Previous Bridge record changed. Reload Bridge before proceeding.');
  const all=readExchangeIntents(owner,storage);
  if(all.kind!=='ready')return blocked('Original Exchange timeline is unavailable.');
  const currentIntent=record.intentId?all.items.find(x=>x.id===record.intentId):undefined;
  if(record.intentId&&(!currentIntent||currentIntent.provider!=='Circle App Kit'||
    currentIntent.mode!=='bridge'||currentIntent.fromChainId!==record.source||
    currentIntent.toChainId!==record.destination||
    currentIntent.amountIn!==record.amount||currentIntent.minimumOut!==record.minimum||
    currentIntent.createdAt>now||now-currentIntent.createdAt<5*60_000||
    !['SOURCE_UNKNOWN','AWAITING_WALLET'].includes(currentIntent.stage)||
    currentIntent.sourceHash||currentIntent.destinationHash||
    currentIntent.steps.some(step=>!!step.hash)))
   return blocked('A source transaction may be underway. The original operation remains protected.');
  // Never bypass another separate unresolved wallet operation.
  if(all.items.some(x=>x.id!==record.intentId&&
    !['DESTINATION_VERIFIED','REFUNDED','SOURCE_REVERTED','CANCELLED_BEFORE_SOURCE'].includes(x.stage)&&
    !x.newTransferAuthorizedAt))
   return blocked('Another unresolved Exchange operation requires its own review.');
  const archiveKey=unverifiedBridgeArchiveKey(owner,record.intentId??archiveId);
  const archive:BridgeArchive={record,archivedAt:now,status:'SOURCE_OUTCOME_UNKNOWN'};
  const encoded=JSON.stringify(archive);
  const oldArchive=storage.getItem(archiveKey);
  if(oldArchive!==null&&oldArchive!==encoded)
   return blocked('An earlier Bridge archive exists. Do not replace financial records.');
  if(oldArchive===null){
   storage.setItem(archiveKey,encoded);
   if(storage.getItem(archiveKey)!==encoded)
    return blocked('Could not safely preserve the original Bridge request.');
  }
  if(record.intentId&&!authorizeSeparateExchangeIntent(owner,record.intentId,storage,now))
   return blocked('Could not preserve the original unresolved Exchange status.');
  // Only the *active UI lock* is cleared; the old request and its uncertainty
  // stay in the append-only archive and Exchange timeline.
  if(storage.getItem(legacyKey)!==raw)return blocked('Original Bridge record changed during archiving.');
  storage.removeItem(legacyKey);
  if(storage.getItem(legacyKey)!==null)return blocked('Original Bridge lock could not be safely updated.');
  return {kind:'ready'};
 }catch{
  return blocked('Browser storage could not preserve the original request. No transaction was started.');
 }
}

export function readUnverifiedBridgeArchives(owner:string,storage:Store):BridgeArchive[]{
 if(!OWNER.test(owner))return [];
 try{
  const prefix=PREFIX+owner.toLowerCase()+':',result:BridgeArchive[]=[];
  for(let i=0;i<storage.length;i++){
   const entry=storage.key(i);
   if(!entry?.startsWith(prefix))continue;
   if(result.length>=60)return [];
   const raw=storage.getItem(entry);
   if(!raw||raw.length>3000)continue;
   const obj:unknown=JSON.parse(raw);
   if(!obj||typeof obj!=='object'||Array.isArray(obj))continue;
   const a=obj as Partial<BridgeArchive>;
   if(a.status!=='SOURCE_OUTCOME_UNKNOWN'||!Number.isSafeInteger(a.archivedAt)||
     a.record?.owner!==owner.toLowerCase()||a.record.mode!=='bridge')continue;
   result.push(a as BridgeArchive);
  }
  return result.sort((a,b)=>b.archivedAt-a.archivedAt);
 }catch{return [];}
}
