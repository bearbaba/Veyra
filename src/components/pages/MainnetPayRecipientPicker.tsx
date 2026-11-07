/** Pay recipient chooser. Wallet is the default; friends are selected only after
 * backend-verifying their Veyra ID and current receiving wallet. No signing here.
 */
import {useEffect,useRef,useState,type FormEvent} from 'react';
import {isAddress} from 'viem';
import {Wallet,Users,Search,UserRound,CheckCircle2} from 'lucide-react';
import {useUnifiedSocial,friendLabel,type SocialFriend} from '@/features/social/UnifiedSocial';
import {lookupMainnetRecipient,parseRecipientQuery,createRecipientSearchGuard,type RecipientSearchResult} from '@/mainnet/recipientLookup';
import type {VerifiedMainnetRecipient} from '@/mainnet/verifiedRecipient';

export function MainnetPayRecipientPicker({owner,sessionToken,signedWallet,disabled,recipient,selectedVerified,onWalletChange,onSelected,onClear}:{
 owner:string;sessionToken?:string;signedWallet:boolean;disabled:boolean;recipient:string;
 selectedVerified:VerifiedMainnetRecipient|null;onWalletChange:(value:string)=>void;
 onSelected:(result:RecipientSearchResult)=>void;onClear:()=>void;
}){
 const social=useUnifiedSocial();
 const [tab,setTab]=useState<'wallet'|'people'>(selectedVerified?'people':'wallet');
 const [searchOpen,setSearchOpen]=useState(false);
 const [query,setQuery]=useState('');
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState<string|null>(null);
 const guard=useRef(createRecipientSearchGuard());
 useEffect(()=>{guard.current.invalid();setTab('wallet');setSearchOpen(false);setBusy(false);setError(null);},[owner,sessionToken]);
 useEffect(()=>{if(selectedVerified){guard.current.invalid();setTab('people');setSearchOpen(false);setBusy(false);setError(null);}},[selectedVerified?.snapshotId]);
 function changeTab(next:'wallet'|'people'){
  if(disabled||tab===next)return;
  guard.current.invalid();setTab(next);setSearchOpen(false);setQuery('');setBusy(false);setError(null);onClear();
 }
 async function verifyHandle(input:string,expectedId?:string){
  if(disabled||busy||!owner||!signedWallet||!sessionToken)return;
  let lookup:string;
  try{
   const parsed=parseRecipientQuery(input);
   lookup=parsed.kind==='wallet'?parsed.wallet:parsed.query;
  }catch(e){setError(e instanceof Error?e.message:'Enter a Veyra ID, X handle or wallet.');return;}
  const ticket=guard.current.start();
  setBusy(true);setError(null);
  try{
   const found=await lookupMainnetRecipient(lookup,owner,sessionToken);
   if(!guard.current.isCurrent(ticket))return;
   if(found.kind==='x-unavailable')throw Error(found.inviteText);
   if(expectedId&&(found.kind!=='veyra'||found.person.veyraUserId!==expectedId))
    throw Error('The verified recipient differs from the selected person. Search again.');
   onSelected(found);setSearchOpen(false);setQuery('');
  }catch(e){
   if(guard.current.isCurrent(ticket))setError(e instanceof Error?e.message:'Cannot verify this Veyra ID.');
  }finally{if(guard.current.isCurrent(ticket))setBusy(false);}
 }
 function chooseFriend(friend:SocialFriend){
  if(friend.veyraHandle)void verifyHandle('@'+friend.veyraHandle+'.veyra',friend.veyraUserId);
  else setError('This friend has no valid Veyra ID.');
 }
 function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();void verifyHandle(query);}
 const connected=signedWallet?social.friends.filter(f=>f.state==='CONNECTED'):[];
 return <div className="space-y-3">
  <p className="text-sm font-semibold" style={{color:'var(--ink)'}}>Recipient</p>
  <div role="tablist" aria-label="Recipient type" className="grid grid-cols-2 gap-1 rounded-xl border p-1"
   style={{borderColor:'var(--border)',background:'rgba(2,15,39,.52)'}}>
   <button type="button" role="tab" aria-selected={tab==='wallet'} disabled={disabled}
    data-active={tab==='wallet'} onClick={()=>changeTab('wallet')}
    className="veyra-pay-tab flex min-h-11 items-center justify-center gap-2 rounded-lg text-sm font-semibold disabled:opacity-50">
    <Wallet className="size-4"/> Wallet</button>
   <button type="button" role="tab" aria-selected={tab==='people'} disabled={disabled}
    data-active={tab==='people'} onClick={()=>changeTab('people')}
    className="veyra-pay-tab flex min-h-11 items-center justify-center gap-2 rounded-lg text-sm font-semibold disabled:opacity-50">
    <Users className="size-4"/> Friends</button>
  </div>
  {tab==='wallet'?<div role="tabpanel" aria-label="Wallet address">
   <input aria-label="Wallet address" spellCheck={false} autoComplete="off" maxLength={42}
    disabled={!owner||disabled} value={recipient} onChange={e=>onWalletChange(e.target.value)}
    placeholder="Paste wallet address · 0x…" className="veyra-pay-input w-full rounded-xl border px-4 py-3 text-sm"
    style={{color:'var(--ink)'}}/>
   {recipient&&!isAddress(recipient)&&<p role="status" className="mt-2 text-xs"
    style={{color:'var(--warning)'}}>Enter a valid wallet address.</p>}
   {recipient&&isAddress(recipient)&&<p className="mt-2 text-xs"
    style={{color:'var(--muted)'}}>Confirm this wallet belongs to your recipient.</p>}
  </div>:<div role="tabpanel" aria-label="Friends" className="space-y-2">
   {selectedVerified?<div className="flex items-center gap-3 rounded-xl border p-3"
    style={{borderColor:'var(--border-strong)',background:'var(--accent-muted)'}}>
    {selectedVerified.avatarUrl?<img src={selectedVerified.avatarUrl} alt="" referrerPolicy="no-referrer"
      className="size-10 shrink-0 rounded-full object-cover"/>:
     <span className="flex size-10 shrink-0 items-center justify-center rounded-full" style={{color:'var(--accent)',background:'var(--surface)'}}><UserRound className="size-5"/></span>}
    <div className="min-w-0 flex-1">
     <p className="truncate text-sm font-bold" style={{color:'var(--ink)'}}>{selectedVerified.displayName||'Veyra member'}</p>
     <p className="truncate text-xs" style={{color:'var(--muted)'}}>@{selectedVerified.veyraHandle}.veyra</p>
     <p className="mt-1 flex items-center gap-1 text-[11px]" style={{color:'var(--success)'}}><CheckCircle2 className="size-3"/> Verified</p>
    </div>
    <button type="button" disabled={disabled} onClick={()=>{guard.current.invalid();onClear();}}
      className="rounded-lg border px-3 py-2 text-xs font-semibold disabled:opacity-50"
      style={{color:'var(--accent)',borderColor:'var(--border)'}}>Change</button>
   </div>:<>
    {!signedWallet?<p className="rounded-xl border p-3 text-sm" style={{color:'var(--muted)',borderColor:'var(--border)'}}>Sign in to Veyra ID to see friends.</p>:
     connected.length?<div className="max-h-52 space-y-1 overflow-y-auto" aria-label="Connected friends">
      {connected.map(friend=><button type="button" key={friend.veyraUserId} onClick={()=>chooseFriend(friend)}
       disabled={disabled||busy||!friend.veyraHandle} className="flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left disabled:opacity-50"
       style={{color:'var(--ink)',borderColor:'var(--border)',background:'rgba(11,30,63,.53)'}}>
       <span className="flex size-8 shrink-0 items-center justify-center rounded-full" style={{color:'var(--accent)',background:'var(--accent-muted)'}}><UserRound className="size-4"/></span>
       <span className="min-w-0 flex-1 truncate text-sm font-semibold">{friendLabel(friend)}</span>
       <span className="text-xs" style={{color:'var(--accent)'}}>{busy?'Checking…':'Select'}</span>
      </button>)}
     </div>:<p className="rounded-xl border p-3 text-sm" style={{color:'var(--muted)',borderColor:'var(--border)'}}>No friends yet. You can still pay any verified Veyra ID or linked X account.</p>}
    {signedWallet&&social.friendsHasMore&&<button type="button" disabled={disabled||social.loadingMoreFriends}
      onClick={()=>void social.loadMoreFriends()} className="w-full rounded-lg border py-2 text-xs disabled:opacity-50"
      style={{color:'var(--accent)',borderColor:'var(--border)'}}>{social.loadingMoreFriends?'Loading…':'Load more friends'}</button>}
    <button type="button" aria-expanded={searchOpen} aria-controls="veyra-friend-search"
      onClick={()=>{setSearchOpen(v=>!v);setError(null);}} disabled={!signedWallet||disabled}
      className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border text-sm font-semibold disabled:opacity-50"
      style={{color:'var(--accent)',borderColor:'var(--border-strong)',background:'rgba(30,55,110,.31)'}}>
      <Search className="size-4"/>{searchOpen?'Hide search':'Find by ID / X / wallet'}</button>
    {searchOpen&&<form id="veyra-friend-search" onSubmit={submit} className="flex gap-2">
      <input aria-label="Find by Veyra ID, X handle or wallet" value={query} onChange={e=>setQuery(e.target.value)}
       autoComplete="off" spellCheck={false} maxLength={40} placeholder="@name.veyra · @Xhandle · 0x…"
       className="veyra-pay-input min-w-0 flex-1 rounded-xl border px-3 py-2 text-sm" style={{color:'var(--ink)'}}/>
      <button type="submit" disabled={disabled||busy||!query.trim()} className="rounded-xl border px-4 py-2 text-sm font-semibold disabled:opacity-50"
       style={{color:'var(--accent)',borderColor:'var(--border-strong)'}}>{busy?'Finding…':'Find'}</button>
     </form>}
   </>}
   {error&&<p role="alert" className="text-xs" style={{color:'var(--warning)'}}>{error}</p>}
  </div>}
 </div>;
}
