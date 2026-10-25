/**
 * A non-authoritative, wallet-scoped public Veyra ID display hint.
 * Browser storage can be modified by the visitor: NEVER use this hint for
 * authorization, payment recipients, signing, or a "verified" badge.
 * Store no bearer tokens, signatures, private data or user IDs.
 */
import {normalizeBetaHandle} from '../../identity-beta/protocol';

const PREFIX='veyra:last-verified-public-id:v1:';
const TTL=30*24*60*60*1000;
const ACCOUNT=/^0x[0-9a-f]{40}$/i;

export function readLastVerifiedVeyraId(wallet:string|undefined|null):string|null{
  if(!wallet||!ACCOUNT.test(wallet))return null;
  try{
    const raw=localStorage.getItem(PREFIX+wallet.toLowerCase());
    if(!raw||raw.length>512)return null;
    const value:unknown=JSON.parse(raw);
    if(!value||typeof value!=='object'||Array.isArray(value))return null;
    const obj=value as Record<string,unknown>;
    if(obj.wallet!==wallet.toLowerCase()||typeof obj.handle!=='string'||
       typeof obj.savedAt!=='number'||!Number.isFinite(obj.savedAt)||
       obj.savedAt>Date.now()||Date.now()-obj.savedAt>TTL)return null;
    return normalizeBetaHandle(obj.handle)===obj.handle?obj.handle:null;
  }catch{return null;}
}

export function rememberVerifiedVeyraId(wallet:string,handle:string):void{
  if(!ACCOUNT.test(wallet))return;
  try{
    const clean=normalizeBetaHandle(handle);
    localStorage.setItem(PREFIX+wallet.toLowerCase(),
      JSON.stringify({wallet:wallet.toLowerCase(),handle:clean,savedAt:Date.now()}));
  }catch{/* Browser storage may be disabled; signed login must still work. */}
}
