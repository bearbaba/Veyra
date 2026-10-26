import {useState} from 'react';
import {Bell,Users,MessageCircle,RefreshCw} from 'lucide-react';
import {friendLabel,useUnifiedSocial} from '../../features/social/UnifiedSocial';
import {VeyraIdentityAccess} from '../identity/VeyraIdentityAccess';

export function SocialPage({onPayFriend}:{onPayFriend:(handle:string)=>void}){
  const social=useUnifiedSocial();
  const [friend,setFriend]=useState('');
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
          <button type="button" onClick={social.signOut} className="rounded-lg border px-3 py-2 text-xs" style={{borderColor:'var(--border)'}}>Sign out</button></div>
      </section>
      <div className="grid gap-4 lg:grid-cols-[1.25fr_0.75fr]">
        <section className="space-y-3 rounded-3xl border p-5" style={{borderColor:'var(--border)',background:'var(--surface-strong)'}}>
          <h2 className="flex items-center gap-2 font-bold"><Users size={18}/> Friends</h2>
          <form onSubmit={event=>{event.preventDefault();void social.invite(friend);}} className="flex gap-2">
            <input value={friend} onChange={event=>setFriend(event.target.value)} placeholder="@friend.veyra" aria-label="Friend Veyra ID"
              className="min-w-0 flex-1 rounded-xl border bg-transparent p-3 text-sm" style={{borderColor:'var(--border)'}}/>
            <button type="submit" disabled={social.busy||friend.trim().length<3}
              className="rounded-xl px-3 text-sm font-semibold disabled:opacity-50" style={{background:'var(--accent)',color:'var(--bg)'}}>Invite</button></form>
          {social.friends.length===0?<p className="text-sm" style={{color:'var(--muted)'}}>No friends yet. Invite a registered Veyra ID above; your friend must accept in their account.</p>:
            social.friends.map(item=><div key={item.veyraUserId} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3" style={{borderColor:'var(--border)'}}>
              <div><b className="text-sm">{friendLabel(item)}</b><p className="text-xs" style={{color:'var(--muted)'}}>{item.state .replace(/_/g,' ').toLowerCase()}</p></div>
              <div className="flex gap-2">{item.state==='INCOMING_PENDING'&&<>
                <button type="button" disabled={social.busy} onClick={()=>void social.respond(item.veyraUserId,'ACCEPT')} className="rounded-lg border px-2 py-1 text-xs" style={{borderColor:'var(--success)'}}>Accept</button>
                <button type="button" disabled={social.busy} onClick={()=>void social.respond(item.veyraUserId,'REJECT')} className="rounded-lg border px-2 py-1 text-xs" style={{borderColor:'var(--border)'}}>Decline</button></>}
                {item.state==='CONNECTED'&&item.veyraHandle&&<button type="button" disabled={social.busy} onClick={()=>onPayFriend(friendLabel(item))}
                  className="rounded-lg border px-2 py-1 text-xs font-semibold" style={{borderColor:'var(--accent)',color:'var(--accent)'}}>Pay</button>}
                {item.state==='CONNECTED'&&<button type="button" disabled={social.busy} onClick={()=>void social.block(item.veyraUserId)} className="rounded-lg border px-2 py-1 text-xs" style={{borderColor:'var(--border)'}}>Block</button>}</div>
            </div>)}
        </section>
        <section className="space-y-3 rounded-3xl border p-5" style={{borderColor:'var(--border)',background:'var(--surface-strong)'}}>
          <h2 className="flex items-center gap-2 font-bold"><Bell size={18}/> Notifications</h2>
          <p className="text-xs" style={{color:'var(--muted)'}}>{social.unreadCount} unread · Authenticated events only</p>
          {social.notices.length===0?<p className="text-sm" style={{color:'var(--muted)'}}>No verified notifications.</p>:
            social.notices.map(item=><div key={item.notificationId} className="rounded-xl border p-3 text-xs" style={{borderColor:'var(--border)'}}>
              <b>{item.kind .replace(/_/g,' ').toLowerCase()}</b><time className="block" style={{color:'var(--muted)'}}>{new Date(item.createdAt).toLocaleString()}</time>
              {!item.readAt&&<button type="button" disabled={social.busy} className="mt-1 underline" onClick={()=>void social.markRead(item.notificationId)}>Mark read</button>}
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
