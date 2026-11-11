/** Durable per-wallet Exchange intent. Created before provider/wallet signing.
 * Browser journal supports recovery, NOT independent financial proof.
 * Never treat a missing response hash as permission to submit a second transaction.
 */
export type ExchangeIntentStage=
 'REVIEWED'|'AWAITING_WALLET'|'SOURCE_UNKNOWN'|'SOURCE_SUBMITTED'|
 'SOURCE_CONFIRMED'|'DESTINATION_PENDING'|'PARTIAL'|'DESTINATION_VERIFIED'|
 'REFUND_PENDING'|'REFUNDED'|'SOURCE_REVERTED'|'CANCELLED_BEFORE_SOURCE';
export type ExchangeStep={
 stage:'approval'|'source'|'destination'|'refund';chainId:number;token:string;
 status:'unknown'|'submitted'|'verified'|'needs-attention';
 hash?:string;checkedAt?:number;
};
export type ExchangeIntent={
 id:string;owner:string;provider:'Circle App Kit'|'Across';
 mode:'swap'|'bridge'|'swap-bridge';
 fromChainId:number;toChainId:number;
 tokenIn:string;tokenOut:string;
 amountIn:string;minimumOut:string;createdAt:number;updatedAt:number;
 stage:ExchangeIntentStage;sourceHash?:string;destinationHash?:string;
 holdingChainId?:number;holdingToken?:string;message?:string;
 /** The user explicitly opted to start a distinct, separately signed transfer.
  * The earlier request remains SOURCE_UNKNOWN, not completed or reverted. */
 newTransferAuthorizedAt?:number;
 steps:ExchangeStep[];
};
type Store=Pick<Storage,'getItem'|'setItem'|'removeItem'|'length'|'key'>;
const PREFIX='veyra:mainnet:exchange-intent:v1:';
const OWNER=/^0x[0-9a-f]{40}$/i,ID=/^[0-9a-f-]{36}$/i,HASH=/^0x[0-9a-f]{64}$/i;
const stages:readonly ExchangeIntentStage[]=['REVIEWED','AWAITING_WALLET','SOURCE_UNKNOWN','SOURCE_SUBMITTED',
 'SOURCE_CONFIRMED','DESTINATION_PENDING','PARTIAL','DESTINATION_VERIFIED','REFUND_PENDING','REFUNDED','SOURCE_REVERTED','CANCELLED_BEFORE_SOURCE'];
const NEXT:Record<ExchangeIntentStage,readonly ExchangeIntentStage[]>={
 REVIEWED:['AWAITING_WALLET','CANCELLED_BEFORE_SOURCE'],
 AWAITING_WALLET:['SOURCE_UNKNOWN','SOURCE_SUBMITTED','CANCELLED_BEFORE_SOURCE'],
 SOURCE_UNKNOWN:['SOURCE_SUBMITTED','PARTIAL','SOURCE_REVERTED'],
 SOURCE_SUBMITTED:['SOURCE_CONFIRMED','PARTIAL','REFUND_PENDING','SOURCE_REVERTED'],
 SOURCE_CONFIRMED:['DESTINATION_PENDING','DESTINATION_VERIFIED','PARTIAL','REFUND_PENDING'],
 DESTINATION_PENDING:['DESTINATION_VERIFIED','PARTIAL','REFUND_PENDING'],
 PARTIAL:['DESTINATION_PENDING','DESTINATION_VERIFIED','REFUND_PENDING','REFUNDED'],
 DESTINATION_VERIFIED:[],REFUND_PENDING:['REFUNDED','PARTIAL'],REFUNDED:[],SOURCE_REVERTED:[],
 CANCELLED_BEFORE_SOURCE:[],
};
const key=(owner:string,id:string)=>PREFIX+owner.toLowerCase()+':'+id.toLowerCase();
export const exchangeIntentKey=key;
function valid(x:unknown,owner:string,id:string):x is ExchangeIntent{
 if(!x||typeof x!=='object'||Array.isArray(x))return false;
 const v=x as Partial<ExchangeIntent>;
 return OWNER.test(owner)&&ID.test(id)&&v.id?.toLowerCase()===id.toLowerCase()&&
 v.owner?.toLowerCase()===owner.toLowerCase()&&
 ['Circle App Kit','Across'].includes(v.provider??'')&&
 ['swap','bridge','swap-bridge'].includes(v.mode??'')&&
 typeof v.fromChainId==='number'&&Number.isSafeInteger(v.fromChainId)&&v.fromChainId>0&&
 typeof v.toChainId==='number'&&Number.isSafeInteger(v.toChainId)&&v.toChainId>0&&
 typeof v.tokenIn==='string'&&v.tokenIn.length>0&&v.tokenIn.length<85&&
 typeof v.tokenOut==='string'&&v.tokenOut.length>0&&v.tokenOut.length<85&&
 typeof v.amountIn==='string'&&v.amountIn.length>0&&v.amountIn.length<85&&
 typeof v.minimumOut==='string'&&v.minimumOut.length>0&&v.minimumOut.length<85&&
 typeof v.createdAt==='number'&&Number.isSafeInteger(v.createdAt)&&
 typeof v.updatedAt==='number'&&Number.isSafeInteger(v.updatedAt)&&
 stages.includes(v.stage!)&&
 (v.sourceHash===undefined||HASH.test(v.sourceHash))&&
 (v.destinationHash===undefined||HASH.test(v.destinationHash))&&
 (v.holdingChainId===undefined||Number.isSafeInteger(v.holdingChainId))&&
 (v.holdingToken===undefined||typeof v.holdingToken==='string'&&v.holdingToken.length<85)&&
 (v.message===undefined||typeof v.message==='string'&&v.message.length<=300)&&
 (v.newTransferAuthorizedAt===undefined||Number.isSafeInteger(v.newTransferAuthorizedAt)&&v.newTransferAuthorizedAt>=v.createdAt)&&
 Array.isArray(v.steps)&&v.steps.length<=12&&v.steps.every(s=>
  s&&['approval','source','destination','refund'].includes(s.stage)&&
  Number.isSafeInteger(s.chainId)&&typeof s.token==='string'&&s.token.length<85&&
  ['unknown','submitted','verified','needs-attention'].includes(s.status)&&
  (s.hash===undefined||HASH.test(s.hash)))&&
 (v.stage!=='DESTINATION_VERIFIED'||!!v.destinationHash)&&
 (v.stage!=='SOURCE_CONFIRMED'||!!v.sourceHash)&&
 (v.stage!=='PARTIAL'||v.holdingChainId!==undefined&&!!v.holdingToken);
}
export type ExchangeIntentRead={kind:'ready';items:ExchangeIntent[]}|{kind:'blocked';items:[]};
export function readExchangeIntents(owner:string,s?:Store):ExchangeIntentRead{
 if(!OWNER.test(owner))return {kind:'blocked',items:[]};
 try{
  const store=s??window.localStorage,paths:string[]=[];
  const prefix=PREFIX+owner.toLowerCase()+':';
  for(let i=0;i<store.length;i++){const k=store.key(i);if(k?.startsWith(prefix))paths.push(k);}
  if(paths.length>60)return {kind:'blocked',items:[]};
  const items:ExchangeIntent[]=[];
  for(const p of paths){
   const id=p.slice(prefix.length),raw=store.getItem(p);
   if(!raw||raw.length>5000)return {kind:'blocked',items:[]};
   const obj:unknown=JSON.parse(raw);
   if(!valid(obj,owner,id))return {kind:'blocked',items:[]};
   items.push(obj);
  }
  return {kind:'ready',items:items.sort((a,b)=>b.createdAt-a.createdAt)};
 }catch{return {kind:'blocked',items:[]};}
}
export function createExchangeIntent(intent:ExchangeIntent,s?:Store):boolean{
 if(!valid(intent,intent.owner,intent.id)||intent.stage!=='REVIEWED'||intent.steps.length!==0)return false;
 try{
  const store=s??window.localStorage,all=readExchangeIntents(intent.owner,store);
  if(all.kind!=='ready'||all.items.length>=60||
    all.items.some(v=>!['DESTINATION_VERIFIED','REFUNDED','SOURCE_REVERTED','CANCELLED_BEFORE_SOURCE'].includes(v.stage)&&!v.newTransferAuthorizedAt))return false;
  const k=key(intent.owner,intent.id);
  if(store.getItem(k)!==null)return false;
  const raw=JSON.stringify({...intent,owner:intent.owner.toLowerCase(),id:intent.id.toLowerCase()});
  store.setItem(k,raw);
  return store.getItem(k)===raw;
 }catch{return false;}
}
export function advanceExchangeIntent(owner:string,id:string,next:ExchangeIntentStage,
 changes:Partial<Pick<ExchangeIntent,'sourceHash'|'destinationHash'|'holdingChainId'|'holdingToken'|'message'|'steps'>>,
 s?:Store,now=Date.now()):boolean{
 if(!OWNER.test(owner)||!ID.test(id))return false;
 try{
  const store=s??window.localStorage,k=key(owner,id),raw=store.getItem(k);
  if(!raw)return false;
  const prior:unknown=JSON.parse(raw);
  if(!valid(prior,owner,id)||!NEXT[prior.stage].includes(next))return false;
  const updated:ExchangeIntent={...prior,...changes,stage:next,updatedAt:now};
  if(!valid(updated,owner,id)||next==='PARTIAL'&&(!updated.sourceHash||!updated.holdingToken))
   return false;
  const encoded=JSON.stringify(updated);
  store.setItem(k,encoded);return store.getItem(k)===encoded;
 }catch{return false;}
}

/** Explicit new-payment authorization, not a settlement verdict or cancellation.
 * An UNKNOWN original may still settle later. Never invoke automatically.
 */
export function authorizeSeparateExchangeIntent(owner:string,id:string,s?:Store,now=Date.now()):boolean{
 if(!OWNER.test(owner)||!ID.test(id)||!Number.isSafeInteger(now))return false;
 try{
  const store=s??window.localStorage,k=key(owner,id),raw=store.getItem(k);
  if(!raw)return false;
  const prior:unknown=JSON.parse(raw);
  if(!valid(prior,owner,id))return false;
  if(prior.newTransferAuthorizedAt!==undefined)return true;
  if(!['SOURCE_UNKNOWN','AWAITING_WALLET'].includes(prior.stage)||
     prior.sourceHash||prior.destinationHash||prior.steps.some(step=>step.hash))
   return false;
  if(now<prior.createdAt)return false;
  const next:ExchangeIntent={...prior,newTransferAuthorizedAt:now,updatedAt:now,
   message:'Earlier source outcome remains unknown. User explicitly authorized a separate new transfer; do not automatically retry the earlier operation.'};
  if(!valid(next,owner,id))return false;
  const encoded=JSON.stringify(next);store.setItem(k,encoded);
  return store.getItem(k)===encoded;
 }catch{return false;}
}
