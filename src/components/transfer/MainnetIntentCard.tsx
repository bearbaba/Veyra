/** Mainnet Agent intention — a proposal, not an executable transaction. */
import {ArrowRight,ShieldCheck,AlertTriangle} from 'lucide-react';
import type {IntentResult} from '@/core/intent/intentSchema';
import {MAINNET_ROUTES,routeLabel,type MainnetRoute} from '@/mainnet/mainnetProduct';
import type {VeyraPage} from '../layout/AppShell';
export function MainnetIntentCard({intent,onNavigate}:{
 intent:IntentResult;onNavigate:(page:VeyraPage)=>void;
}){
 const candidate=intent.candidates[0];
 if(!candidate)return null;
 const route:MainnetRoute|null=candidate.actionType==='TRANSFER'?'pay':
  candidate.actionType==='CONVERT'?'swap':candidate.actionType==='BRIDGE'?'bridge':null;
 const cap=route?MAINNET_ROUTES[route]:null;
 const text=[candidate.sourceChainRaw?.raw,candidate.destinationChainRaw?.raw].filter(Boolean).join(' ').toLowerCase();
 const explicitTestnet=/testnet|sepolia|goerli|devnet/.test(text);
 const needsInput=intent.status!=='RESOLVED';
 const blocked=!cap||explicitTestnet||needsInput;
 const reason=explicitTestnet?'Request mentions a Testnet. Mainnet routes will not substitute its network.':
  needsInput?'Review the missing details before choosing a route.':
  !cap?'No signed Mainnet route is available for this request.':'';
 return <div className="overflow-hidden rounded-2xl border" style={{borderColor:'var(--border)',background:'var(--surface)'}}>
  <div className="border-b px-4 py-4" style={{borderColor:'var(--border)'}}>
   <p className="text-sm font-semibold" style={{color:'var(--ink)'}}>
    {cap?cap.title:'Proposed action'} · Arc Mainnet
   </p>
   <p className="mt-1 text-xs" style={{color:'var(--muted)'}}>
    {blocked?'Needs clarification':cap?routeLabel(route!):'Not available'}
   </p>
  </div>
  <div className="grid gap-3 p-4 text-xs sm:grid-cols-2">
   {candidate.amountRaw&&<div><p style={{color:'var(--muted)'}}>Amount requested</p><strong style={{color:'var(--ink)'}}>{candidate.amountRaw.raw}</strong></div>}
   {candidate.tokenRaw&&<div><p style={{color:'var(--muted)'}}>Asset</p><strong style={{color:'var(--ink)'}}>{candidate.tokenRaw.raw}</strong></div>}
   {candidate.recipientRaw&&<div><p style={{color:'var(--muted)'}}>Recipient — unverified draft</p><strong className="break-all" style={{color:'var(--ink)'}}>{candidate.recipientRaw.raw}</strong></div>}
   <div><p style={{color:'var(--muted)'}}>Execution network</p><strong style={{color:'var(--ink)'}}>{cap?.network??'Not selected'}</strong></div>
  </div>
  <p className="flex items-start gap-2 border-t px-4 py-3 text-xs leading-5"
   style={{borderColor:'var(--border)',color:blocked?'var(--warning)':'var(--muted)'}}>
   {blocked?<AlertTriangle className="mt-0.5 size-4 shrink-0"/>:<ShieldCheck className="mt-0.5 size-4 shrink-0"/>}
   {reason||'This is a draft. Open the canonical route, review address, amounts and fees there, then sign in your wallet. Draft inputs are not auto-submitted.'}
  </p>
  {!blocked&&cap&&<div className="border-t p-3" style={{borderColor:'var(--border)'}}>
   <button type="button" onClick={()=>onNavigate(cap.destination)}
    className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold"
    style={{background:'var(--accent)',color:'#0d1b2f'}}>
    Open {cap.title} review <ArrowRight className="size-4"/>
   </button>
  </div>}
 </div>;
}
