import {useCallback,useEffect,useRef,useState} from 'react';
import {MessageCircle,Send,RefreshCw,X} from 'lucide-react';
import {friendLabel,type SocialFriend} from './UnifiedSocial';

type ChatMessage={
  messageId:string;senderUserId:string;recipientUserId:string;
  body:string;createdAt:string;
};
type ChatPage={ok:boolean;items:ChatMessage[];hasMore:boolean;nextOffset:number|null};

export function FriendChat({token,ownerId,friend,onClose}:{
  token:string;ownerId:string;friend:SocialFriend;onClose:()=>void;
}){
  const [messages,setMessages]=useState<ChatMessage[]>([]);
  const [draft,setDraft]=useState('');
  const [hasMore,setHasMore]=useState(false);
  const [loading,setLoading]=useState(true);
  const [sending,setSending]=useState(false);
  const [olderLoading,setOlderLoading]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const olderOffset=useRef(40);
  const requestRef=useRef<{body:string;id:string}|null>(null);
  const active=useRef(true);
  const fetchPage=useCallback(async(offset:number,signal?:AbortSignal):Promise<ChatPage>=>{
    const params=new URLSearchParams({peerUserId:friend.veyraUserId,limit:'40',offset:String(offset)});
    const response=await fetch('/api/social/chat?'+params.toString(),{
      headers:{Accept:'application/json',Authorization:'Bearer '+token},
      credentials:'same-origin',cache:'no-store',
      signal:signal??AbortSignal.timeout(12000),
    });
    if(!response.ok||!response.headers.get('content-type')?.includes('application/json'))
      throw new Error(response.status===403?'Chat is only available to connected, unblocked friends.':'Unable to load messages.');
    const page:ChatPage=await response.json();
    if(page.ok!==true||!Array.isArray(page.items)||typeof page.hasMore!=='boolean')
      throw new Error('Invalid chat history returned.');
    return page;
  },[friend.veyraUserId,token]);
  const refresh=useCallback(async()=>{
    try{
      const page=await fetchPage(0);
      if(!active.current)return;
      setMessages(previous=>{
        const byId=new Map(previous.map(message=>[message.messageId,message]));
        for(const message of page.items)byId.set(message.messageId,message);
        return [...byId.values()].sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||
          a.messageId.localeCompare(b.messageId));
      });
      setHasMore(previous=>olderOffset.current>40?previous:page.hasMore);
      setError(null);
    }catch(error){
      if(active.current)setError(error instanceof Error?error.message:'Could not load messages.');
    }finally{if(active.current)setLoading(false);}
  },[fetchPage]);
  useEffect(()=>{
    active.current=true;
    void refresh();
    const interval=window.setInterval(()=>{
      if(document.visibilityState==='visible')void refresh();
    },12000);
    return()=>{active.current=false;window.clearInterval(interval);};
  },[refresh]);
  async function loadOlder(){
    if(olderLoading||!hasMore)return;
    setOlderLoading(true);
    try{
      const page=await fetchPage(olderOffset.current);
      if(!active.current)return;
      olderOffset.current+=40;
      setMessages(previous=>{
        const ids=new Set(previous.map(item=>item.messageId));
        return [...page.items.filter(item=>!ids.has(item.messageId)),...previous];
      });
      setHasMore(page.hasMore);setError(null);
    }catch(error){
      if(active.current)setError(error instanceof Error?error.message:'Unable to load older messages.');
    }finally{if(active.current)setOlderLoading(false);}
  }
  async function send(event:React.FormEvent<HTMLFormElement>){
    event.preventDefault();
    const body=draft.trim();
    if(!body||body.length>1000||sending)return;
    setSending(true);setError(null);
    const req=requestRef.current?.body===body?requestRef.current:
      {body,id:crypto.randomUUID()};
    requestRef.current=req; // same key for manual retry after unknown results
    try{
      const response=await fetch('/api/social/chat/send',{
        method:'POST',credentials:'same-origin',cache:'no-store',
        headers:{Accept:'application/json','Content-Type':'application/json',Authorization:'Bearer '+token},
        body:JSON.stringify({peerUserId:friend.veyraUserId,body,clientRequestId:req.id}),
        signal:AbortSignal.timeout(15000),
      });
      const value:unknown=await response.json().catch(()=>null);
      if(!response.ok||!value||typeof value!=='object'||!('ok' in value)||value.ok!==true)
        throw new Error(response.status===403?'This friendship is no longer available.':
          'Message delivery was not confirmed. You can retry safely.');
      if(!active.current)return;
      requestRef.current=null;
      setDraft('');
      await refresh(); // only server-confirmed messages are displayed
    }catch(error){
      if(active.current)setError(error instanceof Error?error.message:'Message delivery was not confirmed.');
    }finally{if(active.current)setSending(false);}
  }
  return <section aria-label={'Conversation with '+friendLabel(friend)}
    className="rounded-3xl border p-4 md:p-5" style={{background:'var(--surface-strong)',borderColor:'var(--border-strong)'}}>
    <div className="flex items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl"
          style={{background:'var(--accent-muted)',color:'var(--accent)'}}><MessageCircle size={18}/></span>
        <div>
          <h2 className="font-bold">{friendLabel(friend)}</h2>
          <p className="text-xs" style={{color:'var(--muted)'}}>Friends-only chat · encrypted on server, not end-to-end</p>
        </div>
      </div>
      <div className="flex gap-2">
        <button type="button" aria-label="Refresh messages" onClick={()=>void refresh()}
          className="rounded-lg border p-2" style={{borderColor:'var(--border)'}}><RefreshCw size={16}/></button>
        <button type="button" aria-label="Close chat" onClick={onClose}
          className="rounded-lg border p-2" style={{borderColor:'var(--border)'}}><X size={16}/></button>
      </div>
    </div>
    <div aria-live="polite" className="mt-4 max-h-80 min-h-40 space-y-2 overflow-y-auto rounded-xl p-3"
      style={{background:'var(--surface)',border:'1px solid var(--border)'}}>
      {loading&&<p className="text-xs" style={{color:'var(--muted)'}}>Loading your conversation…</p>}
      {!loading&&messages.length===0&&<p className="text-sm" style={{color:'var(--muted)'}}>
        No messages yet. Only accepted friends can see this conversation.</p>}
      {hasMore&&<button type="button" onClick={()=>void loadOlder()} disabled={olderLoading}
        className="w-full text-xs underline disabled:opacity-50" style={{color:'var(--muted)'}}>
        {olderLoading?'Loading…':'Load older messages'}</button>}
      {messages.map(item=><div key={item.messageId}
        className={'flex '+(item.senderUserId===ownerId?'justify-end':'justify-start')}>
        <div className="max-w-[85%] rounded-2xl border px-3 py-2 text-sm"
          style={{borderColor:item.senderUserId===ownerId?'var(--accent)':'var(--border)',
            background:item.senderUserId===ownerId?'var(--accent-muted)':'var(--surface-strong)',
            color:'var(--ink)'}}>
          <p className="whitespace-pre-wrap break-words">{item.body}</p>
          <time className="mt-1 block text-[10px]" style={{color:'var(--muted)'}}>
            {new Date(item.createdAt).toLocaleString()}</time>
        </div>
      </div>)}
    </div>
    {error&&<p role="alert" className="mt-2 text-xs" style={{color:'var(--warning)'}}>{error}</p>}
    <form onSubmit={event=>void send(event)} className="mt-3 flex gap-2">
      <input aria-label="Message friend" value={draft} maxLength={1000}
        onChange={event=>{setDraft(event.target.value);if(requestRef.current?.body!==event.target.value.trim())requestRef.current=null;}}
        placeholder="Type a message…" autoComplete="off"
        className="min-w-0 flex-1 rounded-xl border bg-transparent px-3 py-2.5 text-sm"
        style={{borderColor:'var(--border)'}}/>
      <button type="submit" disabled={sending||draft.trim().length===0}
        className="flex items-center gap-2 rounded-xl px-4 text-sm font-semibold disabled:opacity-50"
        style={{background:'var(--accent)',color:'var(--bg)'}}><Send size={16}/>{sending?'Sending…':'Send'}</button>
    </form>
    <p className="mt-2 text-[11px]" style={{color:'var(--subtle)'}}>
      Messages do not authorize payments. Do not share seed phrases, private keys or sensitive credentials.
    </p>
  </section>;
}
