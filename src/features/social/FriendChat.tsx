import {useCallback,useEffect,useRef,useState} from 'react';
import {MessageCircle,Send,RefreshCw,X,Heart,ReceiptText} from 'lucide-react';
import {formatUnits} from 'viem';
import {createPeerRequest,cancelPeerRequest,displayRequestUsdc,listPeerRequests,type VeyraPaymentRequest} from '@/lib/api/paymentRequests';
import {validRequestUsdcAmount} from '@/mainnet/paymentRequestRef';
import {listVerifiedMainnetSettlementReceipts,type MainnetSettlementServerReceipt} from '@/lib/api/mainnetSettlementReceipts';
import {friendLabel,type SocialFriend} from './UnifiedSocial';

type ChatMessage={
  messageId:string;senderUserId:string;recipientUserId:string;
  body:string;createdAt:string;
};
type ChatPage={ok:boolean;items:ChatMessage[];hasMore:boolean;nextOffset:number|null};

export function FriendChat({token,ownerId,friend,onClose,onPay,onTip,onPayRequest,requestsReady=false}:{
  token:string;ownerId:string;friend:SocialFriend;onClose:()=>void;
  onPay?:()=>void;onTip?:()=>void;onPayRequest?:(request:VeyraPaymentRequest)=>void;
  requestsReady?:boolean;
}){
  const [messages,setMessages]=useState<ChatMessage[]>([]);
  const [draft,setDraft]=useState('');
  const [requestAmount,setRequestAmount]=useState('');
  const [requests,setRequests]=useState<VeyraPaymentRequest[]>([]);
  const [requestBusy,setRequestBusy]=useState(false);
  const requestCreateRef=useRef<{amount:string;key:string}|null>(null);
  const [verifiedReceipts,setVerifiedReceipts]=useState<MainnetSettlementServerReceipt[]>([]);
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
    const value:unknown=await response.json();
    if(!value||typeof value!=='object'||Array.isArray(value))
      throw new Error('Invalid chat history returned.');
    const page=value as ChatPage;
    if(page.ok!==true||!Array.isArray(page.items)||typeof page.hasMore!=='boolean'||
      !(page.nextOffset===null||Number.isSafeInteger(page.nextOffset))||
      page.items.some(item=>!item||typeof item!=='object'||typeof item.messageId!=='string'||
        typeof item.senderUserId!=='string'||typeof item.recipientUserId!=='string'||
        typeof item.body!=='string'||typeof item.createdAt!=='string'))
      throw new Error('Invalid chat history returned.');
    return page;
  },[friend.veyraUserId,token]);
  const refreshRequests=useCallback(async()=>{
    try{
      const list=await listPeerRequests(token,friend.veyraUserId);
      if(active.current)setRequests(list);
    }catch(e){if(active.current)setError(e instanceof Error?e.message:'Payment requests cannot be loaded.');}
  },[token,friend.veyraUserId]);
  const refreshReceipts=useCallback(async()=>{
    try{
     const rows=await listVerifiedMainnetSettlementReceipts(token);
     if(active.current)setVerifiedReceipts(rows.filter(x=>
      (x.senderUserId===ownerId&&x.recipientUserId===friend.veyraUserId)||
      (x.senderUserId===friend.veyraUserId&&x.recipientUserId===ownerId)));
    }catch{if(active.current)setVerifiedReceipts([]);}
  },[token,ownerId,friend.veyraUserId]);
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
    void refresh();void refreshReceipts();if(requestsReady)void refreshRequests();
    const onFocus=()=>{if(document.visibilityState==='visible'){
      void refresh();void refreshReceipts();if(requestsReady)void refreshRequests();}};
    const interval=window.setInterval(onFocus,12000);
    window.addEventListener('focus',onFocus);
    window.addEventListener('veyra:mainnet:server-receipt',onFocus);
    return()=>{active.current=false;window.clearInterval(interval);
     window.removeEventListener('focus',onFocus);window.removeEventListener('veyra:mainnet:server-receipt',onFocus);};
  },[refresh,refreshReceipts,refreshRequests,requestsReady]);
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
  async function createRequest(){
    const amount=requestAmount.trim();
    if(requestBusy||!validRequestUsdcAmount(amount))return;
    setRequestBusy(true);setError(null);
    const key=requestCreateRef.current?.amount===amount?requestCreateRef.current:
      {amount,key:crypto.randomUUID()};
    requestCreateRef.current=key; // reuse same ID if request result is unknown
    try{
      const created=await createPeerRequest(token,friend.veyraUserId,amount,key.key);
      if(created.requesterUserId!==ownerId||created.payerUserId!==friend.veyraUserId)
        throw Error('Request parties did not match. Recheck history.');
      if(active.current){
        requestCreateRef.current=null;setRequestAmount('');
        await refreshRequests();
      }
    }catch(e){if(active.current)setError(e instanceof Error?e.message:'Request not confirmed. Retry with the same key.');}
    finally{if(active.current)setRequestBusy(false);}
  }
  async function cancelRequest(requestId:string){
    if(requestBusy)return;
    setRequestBusy(true);setError(null);
    try{await cancelPeerRequest(token,requestId);await refreshRequests();}
    catch(e){if(active.current)setError(e instanceof Error?e.message:'Could not cancel the request.');}
    finally{if(active.current)setRequestBusy(false);}
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
    <div className="mt-3 flex flex-wrap gap-2">
      {onPay&&<button type="button" onClick={onPay} className="veyra-btn-secondary rounded-lg px-3 py-2 text-xs font-semibold">Pay</button>}
      {onTip&&<button type="button" onClick={onTip} className="veyra-btn-secondary inline-flex items-center gap-1 rounded-lg px-3 py-2 text-xs font-semibold"><Heart size={13}/>Tip</button>}
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
    {verifiedReceipts.length>0&&<details className="mt-3 rounded-xl border p-3 text-xs" style={{borderColor:'var(--border)'}}>
      <summary className="flex cursor-pointer items-center gap-2 font-semibold"><ReceiptText size={15}/>Verified receipts ({verifiedReceipts.length})</summary>
      <div className="mt-2 space-y-2">{verifiedReceipts.map(receipt=><a key={receipt.txHash}
        href={'https://explorer.arc.io/tx/'+receipt.txHash} target="_blank" rel="noreferrer"
        className="block rounded-lg border p-2 underline" style={{borderColor:'var(--border)'}}>
        {receipt.direction==='sent'?'Sent':'Received'} {formatUnits(BigInt(receipt.netAmountRaw),6)} USDC · {receipt.txHash.slice(0,10)}…
      </a>)}</div>
      <p className="mt-2" style={{color:'var(--muted)'}}>Only independently indexed VeyraSettlement receipts. Chat text is not payment proof.</p>
    </details>}
    {error&&<p role="alert" className="mt-2 text-xs" style={{color:'var(--warning)'}}>{error}</p>}
    <section className="mt-4 space-y-2" aria-label="USDC payment requests">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold">Payment requests</h3>
        <button type="button" onClick={()=>void refreshRequests()} className="text-xs underline">Refresh</button>
      </div>
      {requests.length===0&&<p className="text-xs" style={{color:'var(--muted)'}}>
        Requests sync with your signed Veyra ID. Chat text is not a receipt.</p>}
      {requests.map(request=><article key={request.requestId} className="rounded-xl border p-3 text-xs"
        style={{borderColor:'var(--border)',background:'var(--surface)'}}>
        <div className="flex items-center justify-between gap-2">
          <p className="font-semibold">{displayRequestUsdc(request)} USDC</p>
          <span>{request.status}</span>
        </div>
        <p className="mt-1" style={{color:'var(--muted)'}}>
          {request.requesterUserId===ownerId?'You requested payment from '+friendLabel(friend):
            friendLabel(friend)+' requests payment from you'}
        </p>
        <p className="mt-1" style={{color:'var(--muted)'}}>
          Request {request.requestId.slice(0,13)}… · expires {new Date(request.expiresAt).toLocaleString()}
        </p>
        {request.paymentInProgress&&request.status==='PENDING'&&
          <p className="mt-2 font-semibold" style={{color:'var(--warning)'}}>
            Original wallet attempt is reserved. Only its saved local ID may resume after a confirmed wallet rejection or before signing. UNKNOWN transfers remain locked.
          </p>}
        {request.status==='PAID'&&request.txHash&&
          <a className="mt-2 inline-block underline" href={'https://explorer.arc.io/tx/'+request.txHash}
            target="_blank" rel="noreferrer">View verified Settlement receipt</a>}
        {request.status==='PENDING'&&request.payerUserId===ownerId&&onPayRequest&&
          <button type="button" onClick={()=>onPayRequest(request)}
            className="veyra-btn-primary mt-2 rounded-lg px-3 py-2 font-semibold">
            {request.paymentInProgress?'Recover original attempt':'Pay request · review in Settlement'}</button>}
        {requestsReady&&request.status==='PENDING'&&!request.paymentInProgress&&request.requesterUserId===ownerId&&
          <button type="button" onClick={()=>void cancelRequest(request.requestId)} disabled={requestBusy}
            className="veyra-btn-secondary mt-2 rounded-lg px-3 py-2 font-semibold disabled:opacity-50">
            Cancel request</button>}
      </article>)}
      {!requestsReady&&<p role="status" className="mt-2 text-xs" style={{color:'var(--muted)'}}>
       Payment requests are unavailable until the verified backend migration is ready.
      </p>}
      {onPay&&requestsReady&&<div className="mt-3 flex flex-wrap items-center gap-2">
        <input aria-label="Request USDC amount" value={requestAmount} inputMode="decimal"
          onChange={e=>{setRequestAmount(e.target.value);if(requestCreateRef.current?.amount!==e.target.value.trim())requestCreateRef.current=null;}}
          placeholder="Amount to receive (USDC)"
          className="veyra-field min-w-0 flex-1 rounded-lg border p-2 text-sm"
          style={{borderColor:'var(--border)'}}/>
        <button type="button" disabled={requestBusy||!validRequestUsdcAmount(requestAmount.trim())}
          className="veyra-btn-secondary rounded-lg px-3 py-2 text-xs font-semibold disabled:opacity-50"
          onClick={()=>void createRequest()}>
          {requestBusy?'Saving…':'Request payment'}
        </button>
      </div>}
    </section>
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
