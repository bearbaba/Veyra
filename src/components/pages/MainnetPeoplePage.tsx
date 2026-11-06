/** People is backed by signed identity; local contacts are never portrayed as verified. */
import {useEffect,useState} from 'react';
import {useAccount} from 'wagmi';
import {isMainnetSessionForWallet} from '@/mainnet/signedWalletReceiptScope';
import {UserRoundCheck,Send,ShieldAlert,Copy,Search,ChevronDown,MessageCircle,Heart} from 'lucide-react';
import {FriendChat} from '../../features/social/FriendChat';
import {lookupMainnetRecipient} from '@/mainnet/recipientLookup';
import {reviewPeerRequest,type VeyraPaymentRequest} from '@/lib/api/paymentRequests';
import {useUnifiedSocial,friendLabel} from '../../features/social/UnifiedSocial';
import {VeyraIdentityAccess} from '../identity/VeyraIdentityAccess';
import {MainnetContactsPage} from './MainnetContactsPage';
import type {VerifiedMainnetRecipient} from '@/mainnet/verifiedRecipient';
import {MainnetRecipientSearch} from '../identity/MainnetRecipientSearch';
import type {RecipientSearchResult} from '@/mainnet/recipientLookup';
export function MainnetPeoplePage({onPayVerified,onPayRequest,onPayWallet,initialQuery=''}:{
 onPayVerified:(value:VerifiedMainnetRecipient,intent?:'pay'|'tip')=>void;
 onPayRequest:(value:VerifiedMainnetRecipient,request:VeyraPaymentRequest)=>void;
 onPayWallet:(wallet:string)=>void;initialQuery?:string;
}){
 const {address,connector}=useAccount(),social=useUnifiedSocial();
 const [friendLookup,setFriendLookup]=useState(initialQuery);
 const [findOpen,setFindOpen]=useState(!!initialQuery);
 const [selected,setSelected]=useState<VerifiedMainnetRecipient|null>(null);
 const [walletTarget,setWalletTarget]=useState<string|null>(null);
 const [friendActionBusy,setFriendActionBusy]=useState(false);
 const [chatPeer,setChatPeer]=useState<string|null>(null);
 const [chatReady,setChatReady]=useState(false);
 const [requestsReady,setRequestsReady]=useState(false);
 const [paymentBusy,setPaymentBusy]=useState(false);
 const ready=!!address&&social.identityOrigin==='ready'&&!!social.session?.token&&
  isMainnetSessionForWallet(social.session,address,connector?.uid);
 const [friendActionError,setFriendActionError]=useState<string|null>(null);
 useEffect(()=>{setSelected(null);setWalletTarget(null);setFriendActionError(null);setChatPeer(null);setChatReady(false);setRequestsReady(false);},[address,social.session?.token]);
 useEffect(()=>{
  const token=social.session?.token;if(!token||!ready)return;
  let live=true;
  void fetch('/api/social/chat/capability',{headers:{Authorization:'Bearer '+token,Accept:'application/json'},
   credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(12000)})
   .then(async response=>response.ok&&response.headers.get('content-type')?.includes('application/json')?await response.json() as unknown:null)
   .then(raw=>{if(live){
     const data=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw as Record<string,unknown>:null;
     setChatReady(data?.available===true);
     setRequestsReady(data?.available===true&&data.requestAvailable===true);
   }})
   .catch(()=>{if(live){setChatReady(false);setRequestsReady(false);}});
  return()=>{live=false;};
 },[social.session?.token,ready]);

 async function payFriend(id:string,intent:'pay'|'tip'){
  const peer=social.friends.find(x=>x.veyraUserId===id&&x.state==='CONNECTED');
  if(!peer?.veyraHandle||!address||!social.session?.token||paymentBusy)return;
  setPaymentBusy(true);setFriendActionError(null);
  try{
   const found=await lookupMainnetRecipient('@'+peer.veyraHandle+'.veyra',address,social.session.token);
   if(found.kind!=='veyra'||found.person.veyraUserId!==id)throw Error('Recipient identity changed. Search again.');
   onPayVerified(found.person,intent);
  }catch(e){setFriendActionError(e instanceof Error?e.message:'Recipient verification unavailable.');}
  finally{setPaymentBusy(false);}
 }
 async function payRequested(request:VeyraPaymentRequest){
  const ownerId=social.session?.profile.veyraUserId;
  const peer=social.friends.find(x=>x.veyraUserId===request.requesterUserId&&x.state==='CONNECTED');
  if(!peer?.veyraHandle||!address||!social.session?.token||!ownerId||paymentBusy||!ready)return;
  if(request.payerUserId!==ownerId||request.requesterUserId!==chatPeer)return;
  setPaymentBusy(true);setFriendActionError(null);
  try{
   const checked=await reviewPeerRequest(social.session.token,request.requestId);
   if(checked.status!=='PENDING'||checked.paymentInProgress||checked.payerUserId!==ownerId||
    checked.requesterUserId!==peer.veyraUserId||Date.parse(checked.expiresAt)<=Date.now())
    throw Error('This request is no longer payable. Refresh the conversation.');
   const found=await lookupMainnetRecipient('@'+peer.veyraHandle+'.veyra',address,social.session.token);
   if(found.kind!=='veyra'||found.person.veyraUserId!==peer.veyraUserId||
    found.person.wallet.toLowerCase()!==checked.recipientWallet.toLowerCase())
    throw Error('The payment receiver has changed. This request must be replaced.');
   onPayRequest(found.person,checked);
  }catch(e){setFriendActionError(e instanceof Error?e.message:'Payment request cannot be verified.');}
  finally{setPaymentBusy(false);}
 }
 function select(result:RecipientSearchResult|null){
  setSelected(result?.kind==='veyra'?result.person:null);
  setWalletTarget(result?.kind==='wallet'?result.wallet:null);
 }
 const relation=selected?social.friends.find(x=>x.veyraUserId===selected.veyraUserId):undefined;
 async function connectSelected(){
  if(!selected||!ready||friendActionBusy||relation)return;
  setFriendActionBusy(true);setFriendActionError(null);
  try{
   if(!await social.invite('@'+selected.veyraHandle+'.veyra'))
    throw Error('Friend invitation was not confirmed. Try again.');
  }catch(e){setFriendActionError(e instanceof Error?e.message:'Could not send invitation.');}
  finally{setFriendActionBusy(false);}
 }
 async function acceptFriend(userId:string,decision:'ACCEPT'|'REJECT'){
  if(!ready||friendActionBusy)return;
  setFriendActionBusy(true);setFriendActionError(null);
  try{
   if(!await social.respond(userId,decision))
    throw Error('Friend response was not confirmed.');
  }catch(e){setFriendActionError(e instanceof Error?e.message:'Could not respond to friend request.');}
  finally{setFriendActionBusy(false);}
 }
 return <main className="veyra-page mx-auto w-full max-w-3xl space-y-4 px-4 py-5 md:px-7 md:py-8">
  <header>
   <p className="veyra-eyebrow">VEYRA</p>
   <h1 className="veyra-page-title">Friends</h1>
   <p className="veyra-page-subtitle">Your contacts, one tap away.</p>
  </header>
  {ready&&social.session?<details className="veyra-card rounded-2xl p-4">
   <summary className="flex cursor-pointer items-center justify-between text-sm font-semibold" style={{color:'var(--ink)'}}>
    My Veyra ID <ChevronDown className="size-4" style={{color:'var(--muted)'}}/>
   </summary><div className="mt-4">
   <div className="flex items-center gap-3">
    <div className="flex size-12 items-center justify-center rounded-full" style={{background:'var(--accent-muted)',color:'var(--accent)'}}><UserRoundCheck className="size-6"/></div>
    <div className="min-w-0 flex-1">
     <p className="text-sm font-semibold" style={{color:'var(--ink)'}}>{'@'+social.session.profile.veyraHandle+'.veyra'}</p>
     <p className="text-xs" style={{color:'var(--muted)'}}>Wallet-authenticated profile · {address?.slice(0,8)}…{address?.slice(-5)}</p>
    </div>
    <div className="flex flex-col items-end gap-2 text-xs" style={{color:'var(--muted)'}}>
     <span>{social.session.profile.x?.xHandle?'X account linked · @'+social.session.profile.x.xHandle:'X · not linked'}</span>
     <button type="button" className="inline-flex items-center gap-1 font-semibold" style={{color:'var(--accent)'}}
      onClick={()=>void navigator.clipboard?.writeText('https://veyra-seven-beta.vercel.app/?veyra='+encodeURIComponent('@'+social.session!.profile.veyraHandle+'.veyra'))}>
      <Copy className="size-3.5"/>Copy profile link
     </button>
    </div>
   </div>
  </div></details>:<VeyraIdentityAccess/>}
  {ready&&<section className="veyra-card p-4 sm:p-5" aria-label="Friends list">
   <div className="space-y-2">
    <div className="flex items-center justify-between">
     <h2 className="veyra-section-title">Your friends</h2>
     <button type="button" onClick={()=>void social.refresh()} className="text-xs" style={{color:'var(--accent)'}}>Refresh</button>
    </div>
    {social.friends.some(x=>x.state==='INCOMING_PENDING')&&<div className="mt-3 space-y-2">
     <p className="text-xs font-semibold" style={{color:'var(--muted)'}}>Friend invitations</p>
     {social.friends.filter(x=>x.state==='INCOMING_PENDING').map(x=><div key={x.veyraUserId}
       className="flex flex-wrap items-center gap-2 rounded-lg border p-3" style={{borderColor:'var(--border)'}}>
       <span className="min-w-0 flex-1 text-sm font-medium" style={{color:'var(--ink)'}}>{friendLabel(x)}</span>
       <button type="button" disabled={friendActionBusy} onClick={()=>void acceptFriend(x.veyraUserId,'ACCEPT')}
        className="veyra-btn-primary rounded-lg px-3 py-2 text-xs font-semibold disabled:opacity-50"
        >Accept</button>
       <button type="button" disabled={friendActionBusy} onClick={()=>void acceptFriend(x.veyraUserId,'REJECT')}
        className="rounded-lg border px-3 py-2 text-xs disabled:opacity-50"
        style={{borderColor:'var(--border)',color:'var(--muted)'}}>Decline</button>
      </div>)}
    </div>}
    {social.friends.filter(x=>x.state==='CONNECTED').length===0?
      <p className="mt-2 text-sm" style={{color:'var(--muted)'}}>{social.friendsHasMore?'No connected friends on this page. Load more to find your contacts.':'No connected friends yet. Find a Veyra ID and send an invitation.'}</p>:
      <div className="mt-2 space-y-2">{social.friends.filter(x=>x.state==='CONNECTED').map(x=><button key={x.veyraUserId}
       onClick={()=>{if(!x.veyraHandle)return;setFriendLookup('@'+x.veyraHandle+'.veyra');setFindOpen(true);}}
       disabled={!x.veyraHandle} type="button"
       className="flex w-full items-center justify-between rounded-lg border px-3 py-3 text-sm disabled:opacity-50"
       style={{borderColor:'var(--border)',color:'var(--ink)'}}>{friendLabel(x)}<span style={{color:'var(--accent)'}}>
        {x.veyraHandle?'Choose':'No verified handle'}
       </span></button>)}</div>}
    {social.friendsHasMore&&<button type="button" disabled={social.loadingMoreFriends}
     onClick={()=>void social.loadMoreFriends()}
     className="mt-3 w-full rounded-lg border px-3 py-2 text-sm font-medium disabled:opacity-50"
     style={{borderColor:'var(--border)',color:'var(--accent)'}}>
      {social.loadingMoreFriends?'Loading friends…':'Load more friends'}
    </button>}
   </div>
   <button type="button" onClick={()=>{setFindOpen(v=>!v);if(findOpen)setFriendLookup('');}}
    aria-expanded={findOpen} aria-controls="veyra-friends-search"
    className="veyra-btn-secondary mt-4 flex w-full items-center justify-center gap-2">
    <Search className="size-4"/>{findOpen?'Hide search':'Find friends'}
   </button>
   {findOpen&&<div id="veyra-friends-search" className="mt-4 rounded-xl border p-3 sm:p-4"
    style={{borderColor:'var(--border)',background:'var(--surface-raised)'}}>
   <MainnetRecipientSearch key={friendLookup||'new'} owner={address} sessionToken={ready?social.session?.token:undefined} initialQuery={friendLookup}
     label="Find by Veyra ID" onSelection={select}/>
   {(selected||walletTarget)&&<div className="mt-3 flex flex-wrap gap-2">
    {selected&&<button type="button" onClick={()=>onPayVerified(selected,'pay')}
     className="veyra-btn-primary inline-flex items-center gap-2 rounded-lg px-4 py-3 text-sm font-semibold"
     ><Send className="size-4"/>Send USDC</button>}
    {selected&&<button type="button" onClick={()=>onPayVerified(selected,'tip')}
     className="veyra-btn-secondary inline-flex items-center gap-2 rounded-lg px-4 py-3 text-sm font-semibold">
     <Heart className="size-4"/>Tip USDC</button>}
    {walletTarget&&<button type="button" onClick={()=>onPayWallet(walletTarget)}
     className="veyra-btn-primary inline-flex items-center gap-2 rounded-lg px-4 py-3 text-sm font-semibold"
     ><Send className="size-4"/>Send to wallet</button>}
    {selected&&selected.veyraUserId!==social.session?.profile.veyraUserId&&
     <button type="button" disabled={friendActionBusy||!!relation} onClick={()=>void connectSelected()}
      className="rounded-lg border px-4 py-3 text-sm font-semibold disabled:opacity-50"
      style={{borderColor:'var(--border)',color:'var(--ink)'}}>
      {relation?.state==='CONNECTED'?'Friends':relation?.state==='OUTGOING_PENDING'?'Invitation sent':
       relation?.state==='INCOMING_PENDING'?'Respond below':'Add friend'}
     </button>}
   </div>}
   {friendActionError&&<p role="alert" className="mt-3 text-sm" style={{color:'var(--warning)'}}>{friendActionError}</p>}

   </div>}

  </section>}
  {!ready&&<p className="flex items-start gap-2 text-xs" style={{color:'var(--muted)'}}>
   <ShieldAlert className="size-4 shrink-0"/>Sign in with your Veyra ID to manage friends.
  </p>}
  <details className="veyra-card p-4">
   <summary className="cursor-pointer text-sm font-semibold" style={{color:'var(--ink)'}}>Saved wallet contacts · Details</summary>
   <MainnetContactsPage onPay={onPayWallet}/>
  </details>
   {ready&&<section className="veyra-card p-4" aria-label="Veyra ID Chat">
    <div className="flex items-center justify-between gap-2">
     <h2 className="veyra-section-title">Chat</h2>
     <span className="text-xs" style={{color:'var(--muted)'}}>Signed Veyra ID · synced messages</span>
    </div>
    <div className="mt-3 flex flex-wrap gap-2">
     {social.friends.filter(x=>x.state==='CONNECTED').map(peer=><button key={peer.veyraUserId}
      type="button" disabled={!chatReady||!peer.veyraHandle}
      onClick={()=>setChatPeer(peer.veyraUserId)}
      className="veyra-btn-secondary inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold disabled:opacity-50">
      <MessageCircle className="size-4"/>{friendLabel(peer)}
     </button>)}
    </div>
    {!chatReady&&<p className="mt-2 text-xs" style={{color:'var(--muted)'}}>
     Chat requires the encrypted backend and a connected friend. Pay and Tip do not require friendship.
    </p>}
    {chatPeer&&chatReady&&social.session&&social.friends.some(x=>x.veyraUserId===chatPeer&&x.state==='CONNECTED')&&
     <div className="mt-4"><FriendChat key={chatPeer+':'+social.session.profile.veyraUserId}
      token={social.session.token} ownerId={social.session.profile.veyraUserId}
      friend={social.friends.find(x=>x.veyraUserId===chatPeer)!} onClose={()=>setChatPeer(null)}
      onPay={()=>void payFriend(chatPeer,'pay')} onTip={()=>void payFriend(chatPeer,'tip')}
      onPayRequest={requestsReady?request=>void payRequested(request):undefined}
      requestsReady={requestsReady}/></div>}
    {paymentBusy&&<p role="status" className="text-xs" style={{color:'var(--muted)'}}>Verifying recipient…</p>}
   </section>}
 </main>;
}
