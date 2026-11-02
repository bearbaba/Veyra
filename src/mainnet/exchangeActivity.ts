/** Browser-local grouping of one Exchange request with source/destination proof references.
 * UI projection only. It never authorizes a transaction or substitutes for
 * verifying chain receipts or persisted server-side history.
 */
export type ExchangeActivity={
 owner:string;mode:'swap'|'bridge';source:number;destination:number;
 tokenIn:string;tokenOut:string;amountIn:string;minOut:string;
 originalHash:string;destinationHash?:string;
 status:'SUBMITTED'|'DESTINATION_VERIFIED';createdAt:number;verifiedAt?:number;
};
const HASH=/^0x[0-9a-f]{64}$/i,OWNER=/^0x[0-9a-f]{40}$/i;
const PREFIX='veyra:mainnet:exchange-activity:v1:';
export const exchangeActivityKey=(owner:string,hash:string)=>
 PREFIX+owner.toLowerCase()+':'+hash.toLowerCase();
type Store=Pick<Storage,'getItem'|'setItem'|'key'|'length'>;
function valid(x:unknown,owner:string):x is ExchangeActivity{
 if(!x||typeof x!=='object'||Array.isArray(x))return false;
 const v=x as Partial<ExchangeActivity>;
 return v.owner?.toLowerCase()===owner.toLowerCase()&&
   (v.mode==='swap'||v.mode==='bridge')&&
   (v.source===5042||v.source===8453)&&(v.destination===5042||v.destination===8453)&&
   typeof v.tokenIn==='string'&&typeof v.tokenOut==='string'&&
   typeof v.amountIn==='string'&&typeof v.minOut==='string'&&
   typeof v.originalHash==='string'&&HASH.test(v.originalHash)&&
   (v.destinationHash===undefined||HASH.test(v.destinationHash))&&
   (v.status==='SUBMITTED'||v.status==='DESTINATION_VERIFIED')&&
   (v.status!=='DESTINATION_VERIFIED'||!!v.destinationHash)&&
   typeof v.createdAt==='number'&&Number.isFinite(v.createdAt);
}
export function readExchangeActivities(owner:string,storage?:Store):ExchangeActivity[]{
 if(!OWNER.test(owner))return [];
 try{
  const s=storage??window.localStorage,keys:string[]=[];
  const prefix=PREFIX+owner.toLowerCase()+':';
  for(let i=0;i<s.length;i++){const key=s.key(i);if(key?.startsWith(prefix))keys.push(key);}
  if(keys.length>60)return [];
  const found:ExchangeActivity[]=[];
  for(const key of keys){
   const raw=s.getItem(key);
   if(!raw||raw.length>2000)continue;
   const value:unknown=JSON.parse(raw);
   if(valid(value,owner)&&exchangeActivityKey(owner,value.originalHash)===key)found.push(value);
  }
  return found.sort((a,b)=>b.createdAt-a.createdAt);
 }catch{return [];}
}
export function recordExchangeActivity(input:ExchangeActivity,storage?:Store):boolean{
 if(!OWNER.test(input.owner)||!valid(input,input.owner))return false;
 try{
  const s=storage??window.localStorage;
  const key=exchangeActivityKey(input.owner,input.originalHash);
  const old=s.getItem(key);
  let createdAt=input.createdAt;
  if(old){
   const prior:unknown=JSON.parse(old);
   if(!valid(prior,input.owner)||prior.mode!==input.mode||
      prior.source!==input.source||prior.destination!==input.destination||
      prior.amountIn!==input.amountIn||prior.tokenIn!==input.tokenIn||prior.tokenOut!==input.tokenOut||
      prior.minOut!==input.minOut||prior.status==='DESTINATION_VERIFIED'&&input.status!=='DESTINATION_VERIFIED')
    return false;
   createdAt=prior.createdAt;
  }
  const encoded=JSON.stringify({...input,createdAt,owner:input.owner.toLowerCase(),
   originalHash:input.originalHash.toLowerCase(),
   ...(input.destinationHash?{destinationHash:input.destinationHash.toLowerCase()}:{})});
  s.setItem(key,encoded);
  const confirmed=s.getItem(key)===encoded;
  if(confirmed)try{window.dispatchEvent(new Event('veyra:mainnet:exchange-activity'));}catch{/* no UI context */}
  return confirmed;
 }catch{return false;}
}
