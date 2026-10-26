import {useState} from 'react';
import {Bell,Users,MessageCircle,RefreshCw,MoreHorizontal} from 'lucide-react';
import {friendLabel,useUnifiedSocial} from '../../features/social/UnifiedSocial';
import {actionableFriendRequest,notificationActorName,notificationDescription,notificationTitle} from '../../features/social/notificationPresentation';
import {VeyraIdentityAccess} from '../identity/VeyraIdentityAccess';

export function SocialPage({onPayFriend}:{onPayFriend:(handle:string)=>void}){
  const social=useUnifiedSocial();
  const [friend,setFriend]=useState('');
  const [profileId,setProfileId]=useState<string|null>(null);
  const [optionsId,setOptionsId]=useState<string|null>(null);
  const [confirmBlockId,setConfirmBlockId]=useState<string|null>(null);
  const [friendFilter,setFriendFilter]=useState<'all'|'connected'|'pending'>('all');
  const filteredFriends=social.friends.filter(item=>
    friendFilter==='all'||(friendFilter==='connected'?item.state==='CONNECTED':item.state!=='CONNECTED'));
  const incomingCount=social.friends.filter(item=>item.state==='INCOMING_PENDING').length;
  const connectedCount=social.friends.filter(item=>item.state==='CONNECTED').length;
  return <div className="mx-auto max-w-5xl space-y-5 px-4 py-7 md:px-7 md:py-9">
    <header><p className="text-xs font-bold uppercase tracking-widest" style={{color:'var(--accent)'}}>Veyra Social</p>
      <h1 className="display mt-2 text-3xl font-black">Friends & notifications</h1>
      <p className="mt-2 text-sm" style={{color:'var(--muted)'}}>Invite by Veyra ID, accept requests and pay connected friends. X import and private messaging are not enabled yet.</p></header>
    {social.error&&<p role="alert" className="rounded-xl border p-3 text-sm" style={{borderColor:'var(--danger)',color:'var(--danger)'}}>{social.error}</p>}
    {social.message&&<p role="status" className="rounded-xl border p-3 text-sm" style={{borderColor:'var(--success)',color:'var(--success)'}}>{social.message}</p>}
    {!social.session?<VeyraIdentityAccess/>:<>

      <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-4" style={{borderColor:'var(--border)',background:'var(--surface)'}}>
        <div><span className="text-xs" style={{color:'var(--muted)'}}>Verified Veyra ID</span><p className="font-bold">@{social.session.profile.veyraHandle}.veyra</p></div>
        <div className="flex gap-2"><button type="button" disabled={social.busy} onClick={()=>void social.refresh()} aria-label="Refresh social" className="rounded-lg border p-2" style={{borderColor:'var(--border)'}}><RefreshCw size={16}/></button>
          <button type="button" disabled={social.busy} onClick={()=>void social.signOut()} className="rounded-lg border px-3 py-2 text-xs disabled:opacity-50" style={{borderColor:'var(--border)'}}>Sign out</button></div>
      </section>
      <div className="grid gap-4 lg:grid-cols-[1.25fr_0.75fr]">
        <section className="space-y-3 rounded-3xl border p-5" style={{borderColor:'var(--border)',background:'var(--surface-strong)'}}>
          <h2 className="flex items-center gap-2 font-bold"><Users size={18}/> Friends</h2>
          <form onSubmit={event=>{event.preventDefault();void social.invite(friend);}} className="flex gap-2">
            <input value={friend} onChange={event=>setFriend(event.target.value)} placeholder="@friend.veyra" aria-label="Friend Veyra ID"
              className="min-w-0 flex-1 rounded-xl border bg-transparent p-3 text-sm" style={{borderColor:'var(--border)'}}/>
            <button type="submit" disabled={social.busy||friend.trim().length<3}
              className="rounded-xl px-3 text-sm font-semibold disabled:opacity-50" style={{background:'var(--accent)',color:'var(--bg)'}}>Invite</button></form>
          <div role="group" aria-label="Friend filters" className="flex flex-wrap gap-2">
            {([{id:'all',label:'All'},{id:'connected',label:'Friends'},{id:'pending',label:'Requests'}] as const).map(tab=>
              <button key={tab.id} type="button" onClick={()=>setFriendFilter(tab.id)}
                aria-pressed={friendFilter===tab.id}
                className="rounded-lg border px-3 py-1.5 text-xs font-semibold"
                style={{borderColor:friendFilter===tab.id?'var(--accent)':'var(--border)',color:friendFilter===tab.id?'var(--accent)':'var(--muted)'}}>
                {tab.label}{tab.id==='connected'?' · '+connectedCount:tab.id==='pending'&&incomingCount>0?' · '+incomingCount:''}
              </button>)}
          </div>
          {filteredFriends.length===0?<p className="text-sm" style={{color:'var(--muted)'}}>
            {friendFilter==='all'?'No friends yet. Invite a registered Veyra ID above; your friend must accept in their account.':
              friendFilter==='connected'?'No accepted friends yet. Pending invitations appear under Requests.':'No pending invitations.'}
          </p>:
            filteredFriends.map(item=><div key={item.veyraUserId} className="rounded-xl border p-3" style={{borderColor:'var(--border)'}}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <button type="button" onClick={()=>{setProfileId(profileId===item.veyraUserId?null:item.veyraUserId);setOptionsId(null);setConfirmBlockId(null);}}
                  aria-expanded={profileId===item.veyraUserId} aria-label={'Open friend profile '+friendLabel(item)}
                  className="min-w-0 text-left">
                  <b className="text-sm">{friendLabel(item)}</b>
                  <p className="text-xs" style={{color:'var(--muted)'}}>{item.state.replace(/_/g,' ').toLowerCase()}</p>
                </button>
                <div className="flex gap-2">
                  {item.state==='INCOMING_PENDING'&&<>
                    <button type="button" disabled={social.busy} onClick={()=>void social.respond(item.veyraUserId,'ACCEPT')} className="rounded-lg border px-2 py-1 text-xs" style={{borderColor:'var(--success)'}}>Accept</button>
                    <button type="button" disabled={social.busy} onClick={()=>void social.respond(item.veyraUserId,'REJECT')} className="rounded-lg border px-2 py-1 text-xs" style={{borderColor:'var(--border)'}}>Decline</button>
                  </>}
                  {item.state==='CONNECTED'&&item.veyraHandle&&<>
                    <button type="button" disabled={social.busy} onClick={()=>onPayFriend(friendLabel(item))}
                      className="rounded-lg border px-3 py-1.5 text-xs font-semibold" style={{borderColor:'var(--accent)',color:'var(--accent)'}}>Pay</button>
                    <button type="button" disabled title="Private messaging requires a verified, encrypted backend. It is not enabled yet."
                      className="rounded-lg border px-3 py-1.5 text-xs opacity-50" style={{borderColor:'var(--border)'}}>Chat</button>
                  </>}
                </div>
              </div>
              {profileId===item.veyraUserId&&<div className="mt-3 border-t pt-3 text-xs" style={{borderColor:'var(--border)'}}>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold">{friendLabel(item)}</p>
                    <p style={{color:'var(--muted)'}}>Friendship actions do not authorize wallet transfers.</p>
                  </div>
                  {item.state==='CONNECTED'&&<button type="button" aria-label="Friend options" aria-expanded={optionsId===item.veyraUserId}
                    onClick={()=>{setOptionsId(optionsId===item.veyraUserId?null:item.veyraUserId);setConfirmBlockId(null);}}
                    className="rounded-lg border p-2" style={{borderColor:'var(--border)'}}><MoreHorizontal size={16}/></button>}
                </div>
                {optionsId===item.veyraUserId&&<div className="mt-2">
                  <button type="button" disabled={social.busy} onClick={()=>setConfirmBlockId(item.veyraUserId)}
                    className="rounded-lg border px-3 py-2 text-xs" style={{borderColor:'var(--danger)',color:'var(--danger)'}}>Block this friend…</button>
                  {confirmBlockId===item.veyraUserId&&<div className="mt-2 flex flex-wrap items-center gap-2">
                    <span>Remove the friendship and block this Veyra ID?</span>
                    <button type="button" disabled={social.busy} onClick={()=>{setConfirmBlockId(null);setOptionsId(null);setProfileId(null);void social.block(item.veyraUserId);}}
                      className="rounded-lg border px-3 py-1.5 font-semibold" style={{borderColor:'var(--danger)',color:'var(--danger)'}}>Confirm block</button>
                    <button type="button" onClick={()=>setConfirmBlockId(null)} className="rounded-lg border px-3 py-1.5" style={{borderColor:'var(--border)'}}>Cancel</button>
                  </div>}
                </div>}
              </div>}
            </div>)}
          {social.friendsHasMore&&<button type="button" disabled={social.loadingMoreFriends||social.busy}
            onClick={()=>void social.loadMoreFriends()} className="w-full rounded-xl border px-3 py-2 text-xs font-semibold disabled:opacity-50"
            style={{borderColor:'var(--border)'}}>{social.loadingMoreFriends?'Loading friends…':'Load more friends'}</button>}
        </section>
        <section className="space-y-3 rounded-3xl border p-5" style={{borderColor:'var(--border)',background:'var(--surface-strong)'}}>
          <h2 className="flex items-center gap-2 font-bold"><Bell size={18}/> Notifications</h2>
          <p className="text-xs" style={{color:'var(--muted)'}}>{social.unreadCount} unread · Authenticated events only</p>
          {social.notices.length===0?<p className="text-sm" style={{color:'var(--muted)'}}>No verified notifications.</p>:
            social.notices.map(item=><div key={item.notificationId} className="rounded-xl border p-3 text-xs" style={{borderColor:'var(--border)'}}>
              <b>{notificationTitle(item.kind)}</b>
              {notificationActorName(item,social.friends)&&<span className="ml-2" style={{color:'var(--muted)'}}>{notificationActorName(item,social.friends)}</span>}
              <p className="mt-1" style={{color:'var(--muted)'}}>{notificationDescription(item.kind)}</p>
              <time className="block mt-1" style={{color:'var(--subtle)'}}>{new Date(item.createdAt).toLocaleString()}</time>
              {actionableFriendRequest(item,social.friends)&&<button type="button" disabled={social.busy}
                className="mt-2 rounded-lg border px-3 py-1.5 font-semibold" style={{borderColor:'var(--success)'}}
                onClick={()=>void social.respond(item.actorUserId!,'ACCEPT')}>Accept friend</button>}
              {!item.readAt&&<button type="button" disabled={social.busy} className="ml-2 mt-2 underline" onClick={()=>void social.markRead(item.notificationId)}>Mark read</button>}
            </div>)}
        </section>
      </div>
      <section className="rounded-2xl border p-5" style={{borderColor:'var(--border)',background:'var(--surface)'}}>
        <h2 className="flex items-center gap-2 font-bold"><MessageCircle size={18}/> Private conversations</h2>
        <p className="mt-2 text-sm" style={{color:'var(--muted)'}}>Messaging is not enabled: authenticated encryption, key recovery and abuse protections must pass testing first. No messages are fabricated or transmitted here.</p>
      </section>
    </>}
  </div>;
}
