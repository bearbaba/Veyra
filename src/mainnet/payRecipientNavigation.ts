/** Wallet-scoped human recipient bookmark. Never a signed identity proof:
 * after reload the BFF must verify the Veyra handle, immutable user ID and
 * exact current receiving wallet before showing a verified person.
 */
import {isAddress,getAddress} from 'viem';
const HANDLE=/^[a-z0-9_-]{2,32}$/i;
const USER=/^usr_[1-9A-HJ-NP-Za-km-z]{10,}$/;
type Store=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
export type SavedPayRecipient={version:1;owner:string;userId:string;
 handle:string;wallet:string;savedAt:number};
export function payRecipientNavigationKey(owner:string){
 return 'veyra:mainnet:pay-recipient:v1:'+getAddress(owner).toLowerCase();
}
export function validSavedPayRecipient(x:unknown,owner:string,now=Date.now()):x is SavedPayRecipient{
 if(!isAddress(owner)||!x||typeof x!=='object'||Array.isArray(x))return false;
 const v=x as Partial<SavedPayRecipient>;
 return v.version===1&&v.owner===getAddress(owner).toLowerCase()&&
  typeof v.userId==='string'&&USER.test(v.userId)&&
  typeof v.handle==='string'&&HANDLE.test(v.handle)&&
  typeof v.wallet==='string'&&isAddress(v.wallet)&&
  typeof v.savedAt==='number'&&Number.isSafeInteger(v.savedAt)&&v.savedAt>0&&
  v.savedAt<=now+5000&&now-v.savedAt<=7*24*60*60*1000;
}
export function savePayRecipient(input:SavedPayRecipient,store?:Store):boolean{
 if(!validSavedPayRecipient(input,input.owner))return false;
 try{const s=store??window.sessionStorage,key=payRecipientNavigationKey(input.owner),
  packed=JSON.stringify(input);s.setItem(key,packed);return s.getItem(key)===packed;
 }catch{return false;}
}
export function readPayRecipient(owner:string,store?:Pick<Store,'getItem'>):SavedPayRecipient|null{
 if(!isAddress(owner))return null;
 try{
  const raw=(store??window.sessionStorage).getItem(payRecipientNavigationKey(owner));
  if(!raw||raw.length>420)return null;
  const decoded:unknown=JSON.parse(raw);
  return validSavedPayRecipient(decoded,owner)?decoded:null;
 }catch{return null;}
}
export function clearPayRecipient(owner:string,store?:Store):boolean{
 if(!isAddress(owner))return false;
 try{const s=store??window.sessionStorage,key=payRecipientNavigationKey(owner);
  s.removeItem(key);return s.getItem(key)===null;
 }catch{return false;}
}

/** A restored bookmark is not the recipient snapshot. The backend's fresh
 * signed result MUST agree with every immutable human identity field and the
 * existing wallet draft before the Pay surface can call it verified.
 */
export function matchesSavedPayRecipient(saved:SavedPayRecipient,
 current:{veyraUserId:string;veyraHandle:string;wallet:string},
 draftRecipient:string):boolean{
 return saved.userId===current.veyraUserId&&
  saved.handle.toLowerCase()===current.veyraHandle.toLowerCase()&&
  saved.wallet.toLowerCase()===current.wallet.toLowerCase()&&
  draftRecipient.toLowerCase()===saved.wallet.toLowerCase();
}
