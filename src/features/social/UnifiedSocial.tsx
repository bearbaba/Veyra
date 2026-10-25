/**
 * Authenticated Social in the existing Veyra financial app.
 * Uses the connected wagmi wallet, identity-purpose EIP-712 and owner API.
 * No browser-persisted bearer, no wallet picker, no transfer authorization.
 */
import {createContext,useCallback,useContext,useEffect,useRef,useState,type ReactNode} from 'react';
import {useAccount} from 'wagmi';
import {normalizeBetaHandle,signReviewedIdentity,type BrowserProvider,type IdentityProfile,type SignedChallenge,ARC_TESTNET_CHAIN_ID} from '../../identity-beta/protocol';
import {bindCurrentIdentityWallet,clearSignedIdentitySession,setSignedIdentitySession} from '../../lib/api/liveIdentitySession';
import {probeIdentityOrigin,type IdentityOriginStatus} from '../../lib/api/identityOriginProbe';
import {rememberVerifiedVeyraId} from '../../lib/api/lastVerifiedVeyraId';

export type SocialFriend={veyraUserId:string;veyraHandle?:string|null;state:'CONNECTED'|'INCOMING_PENDING'|'OUTGOING_PENDING';updatedAt:string};
export type SocialNotice={notificationId:string;kind:string;actorUserId:string|null;createdAt:string;readAt:string|null};
type Session={token:string;profile:IdentityProfile;walletKey:string};
type SocialState={
  session:Session|null;friends:SocialFriend[];notices:SocialNotice[];unreadCount:number;busy:boolean;error:string|null;message:string|null;
  needsRegistration:boolean;connected:boolean;ready:boolean;
  identityOrigin:IdentityOriginStatus;recheckIdentityOrigin:()=>Promise<void>;
  signIn:()=>Promise<void>;register:(handle:string)=>Promise<void>;signOut:()=>void;refresh:()=>Promise<void>;
  invite:(name:string)=>Promise<void>;respond:(id:string,decision:'ACCEPT'|'REJECT')=>Promise<void>;
  block:(id:string)=>Promise<void>;markRead:(id:string)=>Promise<void>;
};
const SocialContext=createContext<SocialState|null>(null);
const USER_ID=/^usr_[1-9A-HJ-NP-Za-km-z]{10,}$/;
export class SocialHttpError extends Error {
  constructor(readonly status:number,readonly code:string){
    super(code==='ORIGIN_NOT_ALLOWED'
      ? 'This Preview URL is not authorized by the Veyra backend. Wallet connection is intact; ID sign-in is unavailable on this domain.'
      : status===404?'Veyra account or resource not found.'
      : status===401?'Your signed session expired. Sign in again.'
      : 'Veyra service error ('+status+'; '+code+').');
  }
}
async function api<T>(path:string,method:'GET'|'POST',token?:string,body?:Record<string,unknown>):Promise<T>{
  if(!/^\/api\/[a-z0-9/?&=._-]+$/i.test(path)||path.includes('..'))throw new Error('Unrecognized Veyra endpoint.');
  const headers:Record<string,string>={Accept:'application/json'};
  if(token)headers.Authorization='Bearer '+token;
  if(body)headers['Content-Type']='application/json';
  let response:Response;
  try{response=await fetch(path,{method,headers,cache:'no-store',credentials:'same-origin',body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(120000)});}
  catch{throw new Error('Identity service is unavailable. No signed request was automatically retried.');}
  const result=(await response.json().catch(()=>({}))) as Record<string,unknown>;
  if(!response.ok||result.ok===false)throw new SocialHttpError(response.status,typeof result.error==='string'&&/^[A-Z_]{2,60}$/.test(result.error)?result.error:'REQUEST_FAILED');
  return result as T;
}
export function normalizeFriendName(value:string):string{
  const raw=value.trim().replace(/^@/,'').replace(/\.veyra$/i,'');
  if(raw.includes('.')||raw.includes('@'))throw new Error('Use @friend.veyra, not an X handle or another domain.');
  return '@'+normalizeBetaHandle(raw)+'.veyra';
}
export function friendLabel(value:SocialFriend):string{
  if(value.veyraHandle){try{return '@'+normalizeBetaHandle(value.veyraHandle)+'.veyra';}catch{/* never claim a malformed handle */}}
  return 'Veyra member · '+value.veyraUserId.slice(-4);
}
export function UnifiedSocialProvider({children}:{children:ReactNode}){
  const {address,chainId,connector,isConnected}=useAccount();
  // Wallet identity is stable across EVM network changes. Token authorization remains wallet+connector-bound.
  // Switching to Arc to pay must not log users out of their Veyra ID.
  const walletKey=(address?.toLowerCase()??'')+':'+(connector?.uid??'');
  // Conservative fail-closed invalidation during render; never grants authority.
  bindCurrentIdentityWallet(walletKey);
  const current=useRef(walletKey);
  const generation=useRef(0),pending=useRef(false);
  const [session,setSession]=useState<Session|null>(null);
  const [friends,setFriends]=useState<SocialFriend[]>([]);
  const [notices,setNotices]=useState<SocialNotice[]>([]);
  const [unreadCount,setUnreadCount]=useState(0),[busy,setBusy]=useState(false);
  const [error,setError]=useState<string|null>(null),[message,setMessage]=useState<string|null>(null);
  const [needsRegistration,setNeedsRegistration]=useState(false);
  const [identityOrigin,setIdentityOrigin]=useState<IdentityOriginStatus>('checking');
  const originRevision=useRef(0);
  const recheckIdentityOrigin=useCallback(async()=>{
    const revision=++originRevision.current;
    setIdentityOrigin('checking');
    const status=await probeIdentityOrigin();
    if(originRevision.current===revision)setIdentityOrigin(status);
  },[]);
  useEffect(()=>{
    void recheckIdentityOrigin();
    return()=>{originRevision.current++;};
  },[recheckIdentityOrigin]);
  const ready=Boolean(isConnected&&address&&connector&&chainId===ARC_TESTNET_CHAIN_ID);
  const signOut=useCallback(()=>{
    generation.current++;clearSignedIdentitySession();setSession(null);setFriends([]);setNotices([]);setUnreadCount(0);
    setNeedsRegistration(false);setError(null);setMessage(null);
  },[]);
  useEffect(()=>{current.current=walletKey;signOut();},[walletKey,signOut]);
  const unchanged=(key:string,rev:number)=>current.current===key&&generation.current===rev;
  async function action(fn:(key:string,rev:number)=>Promise<void>){
    if(pending.current)return;
    const key=current.current,rev=generation.current;
    pending.current=true;setBusy(true);setError(null);setMessage(null);
    try{await fn(key,rev);}
    catch(cause){
      if(!unchanged(key,rev))return;
      if(cause instanceof SocialHttpError&&cause.status===404) setNeedsRegistration(true);
      if(cause instanceof SocialHttpError&&cause.status===401&&session)signOut();
      if(cause instanceof SocialHttpError&&cause.code==='WALLET_ALREADY_BOUND')setNeedsRegistration(false);
      if(cause instanceof SocialHttpError&&cause.code==='ORIGIN_NOT_ALLOWED')setIdentityOrigin('origin_blocked');
      setError(cause instanceof Error?cause.message.slice(0,200):'Veyra request failed.');
    }finally{pending.current=false;setBusy(false);}
  }
  const wallet=async()=>{
    if(!ready||!address||!connector)throw new Error('Connect your existing wallet on Arc Testnet (5042002).');
    const raw:unknown=await connector.getProvider();
    if(!raw||typeof raw!=='object'||!('request' in raw)||typeof raw.request!=='function')
      throw new Error('This wallet cannot sign a reviewed Veyra identity request.');
    return {account:address,provider:raw as BrowserProvider};
  };
  const signIn=()=>action(async(key,rev)=>{
    if(identityOrigin!=='ready')throw new Error('Veyra ID service is not ready for this website. No wallet signature requested.');
    const w=await wallet();
    const c=(await api<{challenge:SignedChallenge}>('/api/auth/wallet-login/challenge','POST',undefined,{walletAddress:w.account,chainId:5042002})).challenge;
    if(!unchanged(key,rev))return;
    const signature=await signReviewedIdentity(w.provider,c,'login',w.account,window.location.origin);
    if(!unchanged(key,rev))return;
    const data=await api<{sessionToken:string;veyraUserId:string}>('/api/auth/wallet-login/complete','POST',undefined,{challengeId:c.challengeId,signature});
    if(!unchanged(key,rev))return;
    const profile=(await api<{profile:IdentityProfile}>('/api/profile/me','GET',data.sessionToken)).profile;
    if(!unchanged(key,rev))return;
    if(profile.veyraUserId!==data.veyraUserId||!USER_ID.test(profile.veyraUserId))throw new Error('Signed identity does not match the returned profile.');
    setSignedIdentitySession(data.sessionToken,key);rememberVerifiedVeyraId(w.account,profile.veyraHandle);
    setSession({token:data.sessionToken,profile,walletKey:key});setNeedsRegistration(false);
    setMessage('Signed in. No financial permissions granted.');
  });
  const register=(name:string)=>action(async(key,rev)=>{
    if(identityOrigin!=='ready')throw new Error('Veyra ID service is not ready for this website. No wallet signature requested.');
    const w=await wallet(),handle=normalizeBetaHandle(name);
    const c=(await api<{challenge:SignedChallenge}>('/api/identity/register/challenge','POST',undefined,{handle,walletAddress:w.account,chainId:5042002})).challenge;
    if(!unchanged(key,rev))return;
    if((c.typedData as {message?:{handle?:string}}).message?.handle!==handle)
      throw new Error('Registration handle changed. No wallet signature requested.');
    const signature=await signReviewedIdentity(w.provider,c,'register',w.account,window.location.origin);
    if(!unchanged(key,rev))return;
    const data=await api<{sessionToken:string;profile:IdentityProfile}>('/api/identity/register/complete','POST',undefined,{claimToken:c.claimToken,signature});
    if(!unchanged(key,rev))return;
    if(!USER_ID.test(data.profile?.veyraUserId??''))throw new Error('Incomplete registration result. Try sign-in before registering again.');
    setSignedIdentitySession(data.sessionToken,key);rememberVerifiedVeyraId(w.account,data.profile.veyraHandle);
    setSession({token:data.sessionToken,profile:data.profile,walletKey:key});setNeedsRegistration(false);
    setMessage('Veyra ID created. You are signed in without a second signature.');
  });
  const refresh=useCallback(async()=>{
    const s=session;if(!s||s.walletKey!==current.current)return;
    const key=s.walletKey,rev=generation.current;
    // Friend data may be live even before deployment of the new notifications
    // migration. Fail closed on missing events, never invent badge counts.
    const [f,n]=await Promise.allSettled([
      api<{items:SocialFriend[]}>('/api/social/friends?limit=20&offset=0','GET',s.token),
      api<{items:SocialNotice[];unreadCount:number}>('/api/notifications?limit=20&offset=0','GET',s.token),
    ]);
    if(!unchanged(key,rev))return;
    if(f.status==='fulfilled')setFriends(f.value.items);
    if(n.status==='fulfilled'){setNotices(n.value.items);setUnreadCount(n.value.unreadCount);}
    const rejected=[f,n].filter(x=>x.status==='rejected');
    if(rejected.some(x=>x.reason instanceof SocialHttpError&&x.reason.status===401)){signOut();return;}
    setError(rejected.length?'Some Social services are unavailable. No events are being inferred.':null);
  },[session,signOut]);
  useEffect(()=>{
    if(!session)return;
    void refresh();
    const timer=setInterval(()=>{if(document.visibilityState==='visible')void refresh();},60000);
    return()=>clearInterval(timer);
  },[session,refresh]);
  const mutate=(fn:(token:string)=>Promise<unknown>)=>action(async(key,rev)=>{
    const s=session;
    if(!s||s.walletKey!==key)throw new Error('Sign in with this wallet before using Social.');
    await fn(s.token);
    if(!unchanged(key,rev))return;
    setMessage('Saved.');await refresh();
  });
  const invite=(name:string)=>mutate(async token=>{
    const r=await api<{resolved:{kind:'WALLET'|'VEYRA_IDENTITY';veyraUserId?:string}}>('/api/identity/resolve','POST',token,{recipient:normalizeFriendName(name)});
    if(r.resolved.kind!=='VEYRA_IDENTITY'||!r.resolved.veyraUserId||!USER_ID.test(r.resolved.veyraUserId)||r.resolved.veyraUserId===session?.profile.veyraUserId)
      throw new Error('Choose another verified Veyra ID.');
    await api('/api/social/friend/request','POST',token,{veyraUserId:r.resolved.veyraUserId});
  });
  const respond=(id:string,decision:'ACCEPT'|'REJECT')=>mutate(token=>api('/api/social/friend/respond','POST',token,{veyraUserId:id,decision}));
  const block=(id:string)=>mutate(token=>api('/api/social/block','POST',token,{veyraUserId:id}));
  const markRead=(id:string)=>mutate(token=>api('/api/notifications/read','POST',token,{notificationId:id}));
  const active=session?.walletKey===walletKey?session:null;
  return <SocialContext.Provider value={{session:active,friends:active?friends:[],notices:active?notices:[],
    unreadCount:active?unreadCount:0,busy,error,message,needsRegistration,connected:isConnected,ready,
    identityOrigin,recheckIdentityOrigin,
    signIn,register,signOut,refresh,invite,respond,block,markRead}}>{children}</SocialContext.Provider>;
}
export function useUnifiedSocial():SocialState{
  const context=useContext(SocialContext);
  if(!context)throw new Error('UnifiedSocialProvider is required.');
  return context;
}
