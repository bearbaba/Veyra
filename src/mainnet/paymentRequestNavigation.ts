/** Saved navigation hint, never proof of identity or a signed payment.
 * Reload must re-review the request and independently re-resolve the payee.
 */
import {isAddress,getAddress} from 'viem';
import {PAYMENT_REQUEST_ID} from './paymentRequestRef';
const HANDLE=/^[a-z0-9_-]{2,32}$/i;
const USER=/^usr_[1-9A-HJ-NP-Za-km-z]{10,}$/;
export type SavedPaymentRequestNavigation={
 version:1;owner:string;requestId:string;requesterHandle:string;
 requesterUserId:string;payerUserId:string;savedAt:number;
};
type Store=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
export const requestNavigationKey=(owner:string)=>
 'veyra:mainnet:request-navigation:v1:'+getAddress(owner).toLowerCase();
export function validRequestNavigation(x:unknown,owner:string,now=Date.now()):
 x is SavedPaymentRequestNavigation{
 if(!isAddress(owner)||!x||typeof x!=='object'||Array.isArray(x))return false;
 const r=x as Partial<SavedPaymentRequestNavigation>;
 return r.version===1&&r.owner===getAddress(owner).toLowerCase()&&
  typeof r.requestId==='string'&&PAYMENT_REQUEST_ID.test(r.requestId)&&
  typeof r.requesterHandle==='string'&&HANDLE.test(r.requesterHandle)&&
  typeof r.requesterUserId==='string'&&USER.test(r.requesterUserId)&&
  typeof r.payerUserId==='string'&&USER.test(r.payerUserId)&&
  r.requesterUserId!==r.payerUserId&&
  typeof r.savedAt==='number'&&Number.isSafeInteger(r.savedAt)&&r.savedAt>0&&
  r.savedAt<=now+5000&&now-r.savedAt<=7*24*60*60*1000;
}
export function saveRequestNavigation(input:SavedPaymentRequestNavigation,
 store?:Store):boolean{
 if(!validRequestNavigation(input,input.owner))return false;
 try{
  const storage=store??window.sessionStorage,raw=JSON.stringify(input);
  storage.setItem(requestNavigationKey(input.owner),raw);
  return storage.getItem(requestNavigationKey(input.owner))===raw;
 }catch{return false;}
}
export function readRequestNavigation(owner:string,store?:Pick<Store,'getItem'>):
 SavedPaymentRequestNavigation|null{
 if(!isAddress(owner))return null;
 try{
  const raw=(store??window.sessionStorage).getItem(requestNavigationKey(owner));
  if(!raw||raw.length>550)return null;
  const input:unknown=JSON.parse(raw);
  return validRequestNavigation(input,owner)?input:null;
 }catch{return null;}
}
export function clearRequestNavigation(owner:string,store?:Store):boolean{
 if(!isAddress(owner))return false;
 try{
  const storage=store??window.sessionStorage;
  storage.removeItem(requestNavigationKey(owner));
  return storage.getItem(requestNavigationKey(owner))===null;
 }catch{return false;}
}
