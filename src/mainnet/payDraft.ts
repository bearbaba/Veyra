/** Cosmetic, wallet-scoped draft only. This is NEVER evidence of an identity or payment.
 * A draft may survive tab navigation/reload, but is not authorized for signing.
 */
export type MainnetPayDraft={recipient:string;amount:string;note:string};
export const EMPTY_PAY_DRAFT:MainnetPayDraft={recipient:'',amount:'',note:''};
const ownerRe=/^0x[0-9a-fA-F]{40}$/;
const recipientRe=/^(?:|0x[0-9a-fA-F]{0,40})$/;
const amountRe=/^[0-9.]{0,24}$/;
export function payDraftKey(owner:string){return 'veyra:mainnet:pay-draft:v1:'+owner.toLowerCase();}
export function normalizePayDraft(v:unknown):MainnetPayDraft{
 if(!v||typeof v!=='object'||Array.isArray(v))return {...EMPTY_PAY_DRAFT};
 const x=v as Partial<MainnetPayDraft>;
 return {
  recipient:typeof x.recipient==='string'&&recipientRe.test(x.recipient)?x.recipient:'',
  amount:typeof x.amount==='string'&&amountRe.test(x.amount)?x.amount:'',
  note:typeof x.note==='string'?x.note.slice(0,120):'',
 };
}
export function readPayDraft(owner:string,store?:Pick<Storage,'getItem'>):MainnetPayDraft{
 if(!ownerRe.test(owner))return {...EMPTY_PAY_DRAFT};
 try{
  const raw=(store??window.sessionStorage).getItem(payDraftKey(owner));
  return raw&&raw.length<=600?normalizePayDraft(JSON.parse(raw)): {...EMPTY_PAY_DRAFT};
 }catch{return {...EMPTY_PAY_DRAFT};}
}
export function writePayDraft(owner:string,draft:MainnetPayDraft,store?:Pick<Storage,'setItem'|'getItem'>):boolean{
 if(!ownerRe.test(owner))return false;
 try{
  const saved=JSON.stringify(normalizePayDraft(draft));
  const storage=store??window.sessionStorage;
  storage.setItem(payDraftKey(owner),saved);
  return storage.getItem(payDraftKey(owner))===saved;
 }catch{return false;}
}
