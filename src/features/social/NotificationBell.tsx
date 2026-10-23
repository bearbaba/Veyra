import {useEffect,useRef,useState} from 'react';
import {Bell} from 'lucide-react';
import {useUnifiedSocial} from './UnifiedSocial';
export function NotificationBell({openSocial}:{openSocial:()=>void}){
  const social=useUnifiedSocial();
  const [open,setOpen]=useState(false);
  const box=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    if(!open)return;
    const outside=(e:MouseEvent)=>{if(box.current&&!box.current.contains(e.target as Node))setOpen(false);};
    const escape=(e:KeyboardEvent)=>{if(e.key==='Escape')setOpen(false);};
    document.addEventListener('mousedown',outside);document.addEventListener('keydown',escape);
    return()=>{document.removeEventListener('mousedown',outside);document.removeEventListener('keydown',escape);};
  },[open]);
  useEffect(()=>{if(!social.session)setOpen(false);},[social.session]);
  if(!social.session)return null;
  return <div className="relative" ref={box}>
    <button type="button" aria-label={`Notifications: ${social.unreadCount} unread`} aria-expanded={open} onClick={()=>setOpen(!open)}
      className="relative rounded-xl border p-2" style={{borderColor:'var(--border)',background:'var(--surface)'}}><Bell size={18}/>
      {social.unreadCount>0&&<span className="absolute -right-1 -top-2 min-w-5 rounded-full px-1 text-center text-[10px] font-bold" style={{background:'var(--accent)',color:'var(--bg)'}}>{social.unreadCount>99?'99+':social.unreadCount}</span>}
    </button>
    {open&&<div role="dialog" aria-label="Veyra notifications" className="absolute right-0 top-12 z-50 w-[min(330px,calc(100vw-24px))] space-y-3 rounded-xl border p-4 shadow-xl" style={{background:'var(--bg)',borderColor:'var(--border-strong)'}}>
      <h2 className="font-bold">Notifications</h2>
      <div className="max-h-56 overflow-y-auto">{social.notices.length===0?<p className="text-xs" style={{color:'var(--muted)'}}>No verified events.</p>:
        social.notices.map(item=><div key={item.notificationId} className="flex items-center justify-between gap-2 border-t py-2 text-xs" style={{borderColor:'var(--border)'}}>
          <span>{item.kind.replaceAll('_',' ').toLowerCase()}</span>
          {!item.readAt&&<button type="button" className="underline" onClick={()=>void social.markRead(item.notificationId)} disabled={social.busy}>Read</button>}
        </div>)}</div>
      <button type="button" onClick={()=>{setOpen(false);openSocial();}} className="w-full rounded-lg border px-3 py-2 text-xs" style={{borderColor:'var(--border)'}}>Open Social inbox</button>
    </div>}
  </div>;
}
