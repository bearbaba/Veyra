import { useEffect, useState } from 'react';
import { CheckCircle2, CircleAlert, ChevronDown, Loader2, RefreshCw, Server } from 'lucide-react';
import {useUnifiedSocial} from '../../features/social/UnifiedSocial';

type Status = 'loading' | 'online' | 'degraded' | 'offline';
interface ReadinessPayload {
  ok?: boolean;
  environment?: string;
  checks?: Array<{ id?: string; ok?: boolean; detail?: string }>;
}

/** Compact, read-only service status: no wallet actions, no transaction approvals. */
export function RuntimeStatusCard() {
  const social=useUnifiedSocial();
  const originBlocked=social.identityOrigin==='origin_blocked';
  const [status,setStatus]=useState<Status>('loading');
  const [environment,setEnvironment]=useState('unknown');
  const [summary,setSummary]=useState('Checking the secure Veyra service…');
  const [attempt,setAttempt]=useState(0);

  useEffect(()=>{
    const controller=new AbortController();
    let active=true;
    // The Render Free backend may cold-start. Three seconds reported false
    // failures during normal sign-in. Bound the request but allow a real boot.
    const timer=window.setTimeout(()=>controller.abort(),15000);
    setStatus('loading');setSummary('Checking the secure Veyra service…');
    void fetch('/api/health/readiness',{
      signal:controller.signal,credentials:'same-origin',cache:'no-store',
      headers:{Accept:'application/json'},
    }).then(async response=>{
      if(!response.ok||!response.headers.get('content-type')?.toLowerCase().includes('application/json'))
        throw new Error('Readiness endpoint unavailable or unexpected response');
      const payload:unknown=await response.json();
      if(!payload||typeof payload!=='object'||Array.isArray(payload)||!('ok' in payload)||
        typeof payload.ok!=='boolean')throw new Error('Invalid readiness response');
      const result=payload as ReadinessPayload;
      if(!active)return;
      setEnvironment(typeof result.environment==='string'?result.environment:'unknown');
      if(result.ok===true){
        setStatus('online');
        setSummary('Infrastructure reachable. Signing and payment verification remain separate checks.');
      }else{
        setStatus('degraded');
        setSummary('Some service checks are unavailable. Wallet funds are unaffected.');
      }
    }).catch(()=>{
      if(!active)return;
      setStatus('offline');
      setSummary('Unable to verify backend readiness. Your wallet remains connected.');
    }).finally(()=>window.clearTimeout(timer));
    return()=>{active=false;window.clearTimeout(timer);controller.abort();};
  },[attempt]);

  const icon=originBlocked?<CircleAlert className="size-4"/>:status==='loading'
    ?<Loader2 className="size-4 animate-spin"/>:status==='online'
      ?<CheckCircle2 className="size-4"/>:<CircleAlert className="size-4"/>;
  const color=originBlocked?'var(--warning)':status==='online'?'var(--success)'
    :status==='loading'?'var(--accent)':'var(--warning)';
  const title=originBlocked?'Veyra ID is blocked on this domain':
    status==='loading'?'Checking connection':
    status==='online'?'Service reachable':
    status==='degraded'?'Service partially available':'Service cannot be verified';

  return <details className="group rounded-2xl border px-4 py-3"
      style={{background:'var(--surface-strong)',borderColor:'var(--border)'}}>
    <summary className="flex cursor-pointer list-none items-center gap-3 rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
      aria-label="Show Veyra service details">
      <span style={{color}}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-semibold" style={{color:'var(--ink)'}}>{title}</span>
        <span className="block text-[11px]" style={{color:'var(--muted)'}}>Connection status · details</span>
      </span>
      <ChevronDown aria-hidden="true" className="size-4 shrink-0 transition-transform group-open:rotate-180"
        style={{color:'var(--muted)'}}/>
    </summary>
    <div role="status" className="mt-3 border-t pt-3" style={{borderColor:'var(--border)'}}>
      <div className="flex items-start gap-2">
        <Server className="mt-0.5 size-4 shrink-0" style={{color:'var(--accent)'}}/>
        <p className="text-xs leading-5" style={{color:'var(--muted)'}}>{originBlocked
          ? 'Backend rejected this Preview origin (403). Veyra ID signing is unavailable; no need to reconnect your wallet.'
          :summary}</p>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px]" style={{color:'var(--subtle)'}}>Environment: {environment}</p>
        <button type="button" onClick={()=>setAttempt(n=>n+1)}
          className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold"
          style={{borderColor:'var(--border)',color:'var(--ink)'}}>
          <RefreshCw className="size-3.5"/> Retry check
        </button>
      </div>
    </div>
  </details>;
}
