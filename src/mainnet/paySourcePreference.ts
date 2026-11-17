/** Cosmetic wallet-scoped Pay source preference. Not authority for spending. */
import {isAddress,getAddress} from 'viem';
type Store=Pick<Storage,'getItem'|'setItem'>;
export type PaySource='wallet'|'unified';
export const paySourcePreferenceKey=(owner:string)=>
 'veyra:mainnet:pay-source:v1:'+getAddress(owner).toLowerCase();
export function readPaySource(owner:string,store?:Pick<Store,'getItem'>):PaySource{
 if(!isAddress(owner))return 'wallet';
 try{return (store??window.sessionStorage).getItem(paySourcePreferenceKey(owner))==='unified'?
  'unified':'wallet';
 }catch{return 'wallet';}
}
export function writePaySource(owner:string,source:PaySource,store?:Store):boolean{
 if(!isAddress(owner)||!['wallet','unified'].includes(source))return false;
 try{const s=store??window.sessionStorage,key=paySourcePreferenceKey(owner);
  s.setItem(key,source);return s.getItem(key)===source;
 }catch{return false;}
}
