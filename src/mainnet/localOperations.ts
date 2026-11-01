/**
 * Wallet-scoped, browser-local pointers to Mainnet transactions.
 * These are NEVER used as proof of success or to authorize repeat signing.
 * Activity must recheck chain/provider receipts before showing "Verified".
 */
export type OperationKind='Pay'|'Settlement'|'Swap'|'Bridge'|'Gateway';
export type LocalOperation={
  type:OperationKind; hash:string; owner:string; amount:string; asset:string;
  chainId:number; status:'SUBMITTED'|'RECORDED'|'REVERTED'; updatedAt:number;
  destination?:string;
};
const HASH=/^0x[0-9a-fA-F]{64}$/;
const ADDRESS=/^0x[0-9a-fA-F]{40}$/;
export const operationKey=(owner:string)=>'veyra:mainnet:activity:v1:'+owner.toLowerCase();
export function readLocalOperations(owner:string):LocalOperation[]{
  if(!ADDRESS.test(owner))return [];
  try{
    const parsed:unknown=JSON.parse(window.localStorage.getItem(operationKey(owner))??'[]');
    if(!Array.isArray(parsed))return [];
    return parsed.filter((v:unknown):v is LocalOperation=>{
      if(!v||typeof v!=='object'||Array.isArray(v))return false;
      const a=v as Partial<LocalOperation>;
      return typeof a.owner==='string'&&a.owner.toLowerCase()===owner.toLowerCase()&&
        typeof a.hash==='string'&&HASH.test(a.hash)&&
        ['Pay','Settlement','Swap','Bridge','Gateway'].includes(a.type??'')&&
        typeof a.amount==='string'&&typeof a.asset==='string'&&
        (a.chainId===5042||a.chainId===8453)&&
        (a.status==='SUBMITTED'||a.status==='RECORDED'||a.status==='REVERTED')&&
        typeof a.updatedAt==='number'&&Number.isFinite(a.updatedAt);
    }).slice(0,60);
  }catch{return [];}
}
export function recordLocalOperation(input:Omit<LocalOperation,'updatedAt'>):boolean{
  if(!ADDRESS.test(input.owner)||!HASH.test(input.hash))return false;
  try{
    const next:LocalOperation={...input,owner:input.owner.toLowerCase(),updatedAt:Date.now()};
    const existing=readLocalOperations(input.owner).filter(v=>
      !(v.hash.toLowerCase()===input.hash.toLowerCase()&&v.type===input.type));
    const packed=JSON.stringify([next,...existing].slice(0,60));
    window.localStorage.setItem(operationKey(input.owner),packed);
    const saved=window.localStorage.getItem(operationKey(input.owner))===packed;
    if(saved&&typeof window.dispatchEvent==='function')window.dispatchEvent(new Event('veyra:mainnet:operation'));
    return saved;
  }catch{return false;}
}
