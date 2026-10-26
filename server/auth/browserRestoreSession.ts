/**
 * First-party, wallet-bound Testnet login restoration. This cookie is NOT an API
 * bearer; its signature uses a domain-separated HMAC and cannot be substituted
 * as a VeyraSessionToken. Never include it in JSON or persist it in JS storage.
 */
import {createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import {getAddress} from 'viem';

const NAME='__Secure-veyra-id-restore';
const TTL_SECONDS=12*60*60;
const PATH='/api/auth';
export interface RestoreCookieClaims {
  v:1;sub:string;wallet:string;origin:string;iat:number;exp:number;jti:string;
}
const USER=/^usr_[1-9A-HJ-NP-Za-km-z]{10,}$/;
const BASE=NAME+'=';
const ATTR='; Path='+PATH+'; HttpOnly; Secure; SameSite=Strict';
const digest=(body:string,secret:string)=>createHmac('sha256',secret)
  .update('veyra-browser-restore:v1:'+body).digest('base64url');
export function clearBrowserRestoreCookie():string{
  return BASE+ATTR+'; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT';
}
export function issueBrowserRestoreCookie(userId:string,walletAddress:string,origin:string,secret:string,now=Date.now()):string{
  if(secret.length<32||!USER.test(userId)||!Number.isFinite(now)||
    !/^https:\/\/[a-z0-9.-]+(?::[0-9]{2,5})?$/i.test(origin)||new URL(origin).origin!==origin)
    throw Error('Invalid Testnet restore session issuance');
  const payload:RestoreCookieClaims={
    v:1,sub:userId,wallet:getAddress(walletAddress).toLowerCase(),origin,
    iat:Math.floor(now/1000),exp:Math.floor(now/1000)+TTL_SECONDS,
    jti:randomBytes(16).toString('hex'),
  };
  const body=Buffer.from(JSON.stringify(payload)).toString('base64url');
  return BASE+body+'.'+digest(body,secret)+ATTR+'; Max-Age='+TTL_SECONDS;
}
export function verifyBrowserRestoreCookie(header:string|undefined,secret:string,origin:string,walletAddress:string,now=Date.now()):RestoreCookieClaims|null{
  if(!header||header.length>10000||secret.length<32)return null;
  const raw=header.split(';').map(v=>v.trim()).filter(v=>v.startsWith(BASE));
  if(raw.length!==1)return null;
  const value=raw[0]!.slice(BASE.length);
  if(value.length<20||value.length>1500||!/^[a-zA-Z0-9_.-]+$/.test(value))return null;
  const pieces=value.split('.');
  if(pieces.length!==2)return null;
  const [body,mac]=pieces;
  if(!body||!mac)return null;
  const expected=Buffer.from(digest(body,secret)),actual=Buffer.from(mac);
  if(expected.length!==actual.length||!timingSafeEqual(expected,actual))return null;
  try{
    const p:unknown=JSON.parse(Buffer.from(body,'base64url').toString('utf8'));
    if(!p||typeof p!=='object'||Array.isArray(p))return null;
    const c=p as Partial<RestoreCookieClaims>;
    const wallet=getAddress(walletAddress).toLowerCase();
    const time=Math.floor(now/1000);
    if(c.v!==1||typeof c.sub!=='string'||!USER.test(c.sub)||
      c.wallet!==wallet||c.origin!==origin||
      typeof c.iat!=='number'||!Number.isInteger(c.iat)||
      typeof c.exp!=='number'||!Number.isInteger(c.exp)||
      typeof c.jti!=='string'||!/^[a-f0-9]{32}$/.test(c.jti)||
      c.iat>time+60||c.exp<=time||c.exp-c.iat!==TTL_SECONDS)return null;
    return c as RestoreCookieClaims;
  }catch{return null;}
}
