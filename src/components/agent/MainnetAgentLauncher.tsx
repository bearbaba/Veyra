/** Mainnet-safe Agent shortcuts — no shadow Testnet form or duplicate signer. */
import {ArrowLeftRight,ArrowRight,Route,SendHorizontal,ShieldCheck} from 'lucide-react';
import {MAINNET_ROUTES,routeLabel,type MainnetRoute} from '@/mainnet/mainnetProduct';
import type {VeyraPage} from '../layout/AppShell';

const actions:{route:MainnetRoute;icon:React.ReactNode}[]=[
 {route:'pay',icon:<SendHorizontal className="size-4"/>},
 {route:'swap',icon:<ArrowLeftRight className="size-4"/>},
 {route:'bridge',icon:<Route className="size-4"/>},

];
export function MainnetAgentLauncher({onNavigate,compact=false}:{
 onNavigate:(page:VeyraPage)=>void;compact?:boolean;
}){
 return <div className={'mx-auto w-full max-w-3xl '+(compact?'pb-4':'py-5')}>
  {!compact&&<div className="mb-4">
   <h2 className="display text-xl font-bold" style={{color:'var(--ink)'}}>What would you like to do?</h2>
   <p className="mt-1 text-sm" style={{color:'var(--muted)'}}>
    Tell Veyra what you need, or choose a route to review in the same Mainnet transaction form.
   </p>
  </div>}
  <div className="grid gap-2 sm:grid-cols-3">
   {actions.map(({route,icon})=>{
    const cap=MAINNET_ROUTES[route];
    return <button key={route} type="button" onClick={()=>onNavigate(cap.destination)}
     className="flex min-w-0 flex-col items-start rounded-xl border p-4 text-left transition-colors hover:bg-white/5"
     style={{borderColor:'var(--border)',background:'var(--surface)'}}>
      <span className="flex items-center gap-2 text-sm font-bold" style={{color:'var(--ink)'}}>{icon}{cap.title}
       <ArrowRight className="ml-auto size-4" style={{color:'var(--muted)'}}/></span>
      <span className="mt-2 text-xs" style={{color:'var(--muted)'}}>{cap.network} · {routeLabel(route)}</span>
     </button>;
   })}
  </div>
  <p className="mt-3 text-xs" style={{color:'var(--muted)'}}>
   Agent prepares intentions; only your wallet can authorize transactions. No Testnet route on this Mainnet page.
  </p>
 </div>;
}
