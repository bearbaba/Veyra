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
export type SocialNotice={notificationId:string;kind:string;actorUserId:string|null;eventRef?:string;createdAt:string;readAt:string|null};
type Session={token:string;profile:IdentityProfile;walletKey:string};
type SocialState={
  session:Session|null;friends:SocialFriend[];notices:SocialNotice[];unreadCount:number;busy:boolean;error:string|null;message:string|null;
  friendsHasMore:boolean;loadingMoreFriends:boolean;loadMoreFriends:()=>Promise<void>;
  noticesHasMore:boolean;loadingMoreNotices:boolean;loadMoreNotices:()=>Promise<void>;
  incomingStatus:'idle'|'checking'|'ready'|'unavailable'|'error';checkIncoming:()=>Promise<void>;
  needsRegistration:boolean;connected:boolean;ready:boolean;
  identityOrigin:IdentityOriginStatus;recheckIdentityOrigin:()=>Promise<void>;
  restoring:boolean;
  signIn:()=>Promise<void>;register:(handle:string)=>Promise<void>;signOut:()=>Promise<boolean>;refresh:()=>Promise<void>;
  invite:(name:string)=>Promise<boolean>;respond:(id:string,decision:'ACCEPT'|'REJECT')=>Promise<boolean>;
  block:(id:string)=>Promise<boolean>;markRead:(id:string)=>Promise<boolean>;
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
async function api<T>(path:string,method:'GET'|'POST',token?:string,body?:Record<string,unknown>,timeoutMs=120000):Promise<T>{
  if(!/^\/api\/[a-z0-9/?&=._-]+$/i.test(path)||path.includes('..'))throw new Error('Unrecognized Veyra endpoint.');
  const headers:Record<string,string>={Accept:'application/json'};
  if(token)headers.Authorization='Bearer '+token;
  if(body)headers['Content-Type']='application/json';
  let response:Response;
  try{response=await fetch(path,{method,headers,cache:'no-store',credentials:'same-origin',body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(timeoutMs)});}
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
  const [friendsNextOffset,setFriendsNextOffset]=useState<number|null>(null);
  const [loadingMoreFriends,setLoadingMoreFriends]=useState(false);
  const [noticesNextOffset,setNoticesNextOffset]=useState<number|null>(null);
  const [loadingMoreNotices,setLoadingMoreNotices]=useState(false);
  const noticePageTicket=useRef<symbol|null>(null);
  const [incomingStatus,setIncomingStatus]=useState<'idle'|'checking'|'ready'|'unavailable'|'error'>('idle');
  const incomingBusy=useRef(false),incomingLastAt=useRef(0),incomingUnavailable=useRef<string|null>(null);
  const friendRefreshEpoch=useRef(0),loadingFriendPage=useRef(false);
  const [unreadCount,setUnreadCount]=useState(0),[busy,setBusy]=useState(false);
  const [error,setError]=useState<string|null>(null),[message,setMessage]=useState<string|null>(null);
  const [needsRegistration,setNeedsRegistration]=useState(false);
  const [restoring,setRestoring]=useState(false);
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
  const resetLocal=useCallback(()=>{
    generation.current++;friendRefreshEpoch.current++;noticePageTicket.current=null;
    incomingBusy.current=false;incomingLastAt.current=0;incomingUnavailable.current=null;setIncomingStatus('idle');
    clearSignedIdentitySession();setSession(null);setFriends([]);setFriendsNextOffset(null);setLoadingMoreFriends(false);
    setNotices([]);setNoticesNextOffset(null);setLoadingMoreNotices(false);setUnreadCount(0);
    setNeedsRegistration(false);setError(null);setMessage(null);
  },[]);
  // Prevent auto-restore from racing an explicit sign-out while the old
  // HttpOnly cookie is still being cleared. A wallet change resets this guard.
  const restoreSuppressedFor=useRef<string|null>(null);
  const restoreAttemptedFor=useRef<string|null>(null);
  const signOut=useCallback(async():Promise<boolean>=>{
    restoreSuppressedFor.current=current.current;
    resetLocal();
    setBusy(true);
    try{
      // Only a backend JSON acknowledgement is proof that the restore
      // cookie was cleared; a Vercel HTML fallback can also return HTTP 200.
      const response=await api<{ok:boolean}>('/api/auth/session/logout','POST',undefined,undefined,20000);
      if(response.ok!==true)throw new Error('Server logout was not acknowledged.');
      return true;
    }catch{
      setError('Signed out locally, but server logout was not confirmed. The browser session may still be valid after a reload.');
      return false;
    }finally{setBusy(false);}
  },[resetLocal]);
  useEffect(()=>{
    if(current.current!==walletKey){
      restoreSuppressedFor.current=null;
      restoreAttemptedFor.current=null;
    }
    current.current=walletKey;resetLocal();
  },[walletKey,resetLocal]);
  const unchanged=(key:string,rev:number)=>current.current===key&&generation.current===rev;
  async function action(fn:(key:string,rev:number)=>Promise<void>){
    if(pending.current)return;
    const key=current.current,rev=generation.current;
    pending.current=true;setBusy(true);setError(null);setMessage(null);
    try{await fn(key,rev);}
    catch(cause){
      if(!unchanged(key,rev))return;
      if(cause instanceof SocialHttpError&&cause.status===404) setNeedsRegistration(true);
      if(cause instanceof SocialHttpError&&cause.status===401&&session)resetLocal();
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
  // On reload the wallet reconnects before this restores the secure browser
  // cookie. No MetaMask popup or browser-persisted bearer is involved.
  useEffect(()=>{
    if(!isConnected||!address||!connector||identityOrigin!=='ready'||session||busy||
       restoreSuppressedFor.current===walletKey||restoreAttemptedFor.current===walletKey)return;
    let cancelled=false;
    const key=walletKey,rev=generation.current;
    // One automatic attempt for this connected wallet. A failed restore must
    // not be retried on every unrelated busy-state transition.
    restoreAttemptedFor.current=key;
    setRestoring(true);
    void api<{veyraUserId:string;sessionToken:string;profile:IdentityProfile}>(
      '/api/auth/session/restore','POST',undefined,{walletAddress:address},30000,
    ).then(data=>{
      if(cancelled||!unchanged(key,rev)||data.profile.veyraUserId!==data.veyraUserId||
        !USER_ID.test(data.veyraUserId))return;
      setSignedIdentitySession(data.sessionToken,key);
      rememberVerifiedVeyraId(address,data.profile.veyraHandle);
      setSession({token:data.sessionToken,profile:data.profile,walletKey:key});
      setNeedsRegistration(false);
    }).catch(()=>{/* No valid cookie: user can explicitly sign in once. */})
      .finally(()=>{if(!cancelled)setRestoring(false);});
    return()=>{cancelled=true;};
  },[walletKey,address,connector,isConnected,identityOrigin,session,busy]);
  const signIn=()=>action(async(key,rev)=>{
    if(restoring)throw new Error('Checking your existing Veyra ID session.');
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
    if(restoring)throw new Error('Checking your existing Veyra ID session.');
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
  type FriendsPage={items:SocialFriend[];hasMore:boolean;nextOffset:number|null};
  const validPage=(value:FriendsPage):boolean=>Array.isArray(value?.items)&&
    typeof value.hasMore==='boolean'&&
    (value.hasMore ? Number.isSafeInteger(value.nextOffset)&&value.nextOffset!==null&&value.nextOffset>0 : value.nextOffset===null);
  type NoticesPage={items:SocialNotice[];unreadCount:number;hasMore:boolean;nextOffset:number|null};
  const validNoticesPage=(value:NoticesPage):boolean=>Array.isArray(value?.items)&&
    Number.isSafeInteger(value.unreadCount)&&value.unreadCount>=0&&
    typeof value.hasMore==='boolean'&&
    (value.hasMore?Number.isSafeInteger(value.nextOffset)&&value.nextOffset!==null&&value.nextOffset>0:
      value.nextOffset===null);
  const refresh=useCallback(async()=>{
    const s=session;if(!s||s.walletKey!==current.current)return;
    const key=s.walletKey,rev=generation.current,request=++friendRefreshEpoch.current;
    // Both collections are authenticated and owner-private. Never synthesize
    // notifications from a pending transfer or a local balance change.
    const [f,n]=await Promise.allSettled([
      api<FriendsPage>('/api/social/friends?limit=20&offset=0','GET',s.token),
      api<NoticesPage>('/api/notifications?limit=20&offset=0','GET',s.token),
    ]);
    // Never let an older refresh overwrite the newer Friends *or* notices
    // after a response delay, manual refresh or wallet/session replacement.
    if(!unchanged(key,rev)||request!==friendRefreshEpoch.current)return;
    if(f.status==='fulfilled'){
      if(validPage(f.value)){
        setFriends(f.value.items);
        setFriendsNextOffset(f.value.hasMore?f.value.nextOffset:null);
      }else{
        setError('Friends service returned an invalid page. Try again.');
        return;
      }
    }
    if(n.status==='fulfilled'){
      if(validNoticesPage(n.value)){
        setNotices(n.value.items);setUnreadCount(n.value.unreadCount);
        setNoticesNextOffset(n.value.hasMore&&n.value.nextOffset!==null&&n.value.nextOffset<=1000?n.value.nextOffset:null);
      }else{
        setError('Notifications service returned invalid data. No events were inferred.');
        return;
      }
    }
    const rejected=[f,n].filter(x=>x.status==='rejected');
    if(rejected.some(x=>x.reason instanceof SocialHttpError&&x.reason.status===401)){resetLocal();return;}
    setError(rejected.length?'Some Social services are unavailable. No events are being inferred.':null);
  },[session,resetLocal]);
  // Only the signed BFF can independently verify inbound on-chain transfers.
  // Polling runs only in visible, authenticated browsers; NOT a 24/7 worker.
  const checkIncoming=useCallback(async()=>{
    const s=session;
    if(!s||s.walletKey!==current.current||identityOrigin!=='ready'||
      incomingBusy.current||incomingUnavailable.current===s.walletKey||
      Date.now()-incomingLastAt.current<70000)return;
    const key=s.walletKey,rev=generation.current;
    incomingBusy.current=true;incomingLastAt.current=Date.now();setIncomingStatus('checking');
    try{
      const result=await api<{ok:boolean;newNotifications:number;scope:string}>(
        '/api/notifications/sync-incoming','POST',s.token,undefined,45000);
      if(!unchanged(key,rev))return;
      if(result.ok!==true||!Number.isSafeInteger(result.newNotifications)||
        result.newNotifications<0||result.scope!=='arc-testnet-usdc')
        throw new Error('Invalid chain-sync response.');
      setIncomingStatus('ready');
      if(result.newNotifications>0)await refresh();
    }catch(error){
      if(!unchanged(key,rev))return;
      if(error instanceof SocialHttpError&&error.status===404){
        incomingUnavailable.current=key;setIncomingStatus('unavailable');
      }else setIncomingStatus('error');
    }finally{incomingBusy.current=false;}
  },[session,identityOrigin,refresh]);
  useEffect(()=>{
    if(!session||identityOrigin!=='ready')return;
    void checkIncoming();
    const timer=window.setInterval(()=>{
      if(document.visibilityState==='visible')void checkIncoming();
    },90000);
    return()=>window.clearInterval(timer);
  },[session,identityOrigin,checkIncoming]);
  const loadMoreFriends=useCallback(async()=>{
    const s=session,offset=friendsNextOffset;
    if(!s||s.walletKey!==current.current||offset===null||busy||loadingFriendPage.current)return;
    const key=s.walletKey,rev=generation.current,request=friendRefreshEpoch.current;
    loadingFriendPage.current=true;setLoadingMoreFriends(true);
    try{
      const page=await api<FriendsPage>('/api/social/friends?limit=20&offset='+offset,'GET',s.token);
      if(!unchanged(key,rev)||request!==friendRefreshEpoch.current)return;
      if(!validPage(page)||page.hasMore&&(page.nextOffset===null||page.nextOffset<=offset))
        throw new Error('Invalid or non-advancing Friends cursor.');
      // A late page may overlap a changed friendship. Keep each ID once.
      setFriends(previous=>{
        const known=new Set(previous.map(item=>item.veyraUserId));
        return [...previous,...page.items.filter(item=>!known.has(item.veyraUserId))];
      });
      setFriendsNextOffset(page.hasMore?page.nextOffset:null);
    }catch{
      if(unchanged(key,rev)&&request===friendRefreshEpoch.current)
        setError('Could not load more friends. Please retry.');
    }finally{
      loadingFriendPage.current=false;
      if(unchanged(key,rev))setLoadingMoreFriends(false);
    }
  },[session,friendsNextOffset,busy]);
  const loadMoreNotices=useCallback(async()=>{
    const s=session,offset=noticesNextOffset;
    if(!s||s.walletKey!==current.current||offset===null||busy||noticePageTicket.current)return;
    const key=s.walletKey,rev=generation.current,epoch=friendRefreshEpoch.current;
    const ticket=Symbol('notification page');
    noticePageTicket.current=ticket;setLoadingMoreNotices(true);
    try{
      const page=await api<NoticesPage>('/api/notifications?limit=20&offset='+offset,'GET',s.token);
      if(!unchanged(key,rev)||epoch!==friendRefreshEpoch.current||noticePageTicket.current!==ticket)return;
      if(!validNoticesPage(page)||page.hasMore&&(page.nextOffset===null||page.nextOffset<=offset))
        throw new Error('Invalid notification cursor.');
      setNotices(previous=>{
        const known=new Set(previous.map(item=>item.notificationId));
        return [...previous,...page.items.filter(item=>!known.has(item.notificationId))];
      });
      setUnreadCount(page.unreadCount);
      setNoticesNextOffset(page.hasMore&&page.nextOffset!==null&&page.nextOffset<=1000?page.nextOffset:null);
    }catch{
      if(unchanged(key,rev)&&epoch===friendRefreshEpoch.current)
        setError('Could not load more notifications. Please retry.');
    }finally{
      if(noticePageTicket.current===ticket){
        noticePageTicket.current=null;
        if(unchanged(key,rev))setLoadingMoreNotices(false);
      }
    }
  },[session,noticesNextOffset,busy]);
  useEffect(()=>{
    if(!session)return;
    void refresh();
    const timer=setInterval(()=>{if(document.visibilityState==='visible')void refresh();},60000);
    const onVisible=()=>{if(document.visibilityState==='visible')void refresh();};
    document.addEventListener('visibilitychange',onVisible);
    return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',onVisible);};
  },[session,refresh]);
  // Expose success to the UI so an invitation field is only cleared on a
  // confirmed server mutation, and a failed friend accept cannot mark its
  // notification as read. The existing identity error handler remains intact.
  const mutate=(fn:(token:string)=>Promise<unknown>,successMessage='Saved.'):Promise<boolean>=>{
    let accepted=false;
    return action(async(key,rev)=>{
      const s=session;
      if(!s||s.walletKey!==key)throw new Error('Sign in with this wallet before using Social.');
      await fn(s.token);
      if(!unchanged(key,rev))return;
      setMessage(successMessage);await refresh();
      accepted=unchanged(key,rev);
    }).then(()=>accepted);
  };
  const invite=(name:string)=>mutate(async token=>{
    const r=await api<{resolved:{kind:'WALLET'|'VEYRA_IDENTITY';veyraUserId?:string}}>('/api/identity/resolve','POST',token,{recipient:normalizeFriendName(name)});
    if(r.resolved.kind!=='VEYRA_IDENTITY'||!r.resolved.veyraUserId||!USER_ID.test(r.resolved.veyraUserId)||r.resolved.veyraUserId===session?.profile.veyraUserId)
      throw new Error('Choose another verified Veyra ID.');
    await api('/api/social/friend/request','POST',token,{veyraUserId:r.resolved.veyraUserId});
  },'Friend invitation sent.');
  const respond=(id:string,decision:'ACCEPT'|'REJECT')=>mutate(
    token=>api('/api/social/friend/respond','POST',token,{veyraUserId:id,decision}),
    decision==='ACCEPT'?'Friend request accepted.':'Friend request declined.');
  const block=(id:string)=>mutate(token=>api('/api/social/block','POST',token,{veyraUserId:id}),'Friend blocked.');
  const markRead=(id:string)=>mutate(token=>api('/api/notifications/read','POST',token,{notificationId:id}),'Notification marked as read.');
  const active=session?.walletKey===walletKey?session:null;
  return <SocialContext.Provider value={{session:active,friends:active?friends:[],notices:active?notices:[],
    friendsHasMore:active?friendsNextOffset!==null:false,loadingMoreFriends,loadMoreFriends,
    noticesHasMore:active?noticesNextOffset!==null:false,loadingMoreNotices,loadMoreNotices,
    incomingStatus:active?incomingStatus:'idle',checkIncoming,
    unreadCount:active?unreadCount:0,busy,error,message,needsRegistration,connected:isConnected,ready,
    identityOrigin,recheckIdentityOrigin,restoring,
    signIn,register,signOut,refresh,invite,respond,block,markRead}}>{children}</SocialContext.Provider>;
}
export function useUnifiedSocial():SocialState{
  const context=useContext(SocialContext);
  if(!context)throw new Error('UnifiedSocialProvider is required.');
  return context;
}
