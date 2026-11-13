import {ArrowLeftRight,Bot} from 'lucide-react';
/** Read-only placeholder for deferred financial/AI modules. */
export function MainnetSoonPage({feature}:{feature:'Exchange'|'Agent'}){
 const Icon=feature==='Exchange'?ArrowLeftRight:Bot;
 return <main className="mx-auto flex min-h-[55vh] w-full max-w-xl items-center px-4 py-10">
  <section className="w-full rounded-3xl border p-7 text-center"
   style={{background:'linear-gradient(135deg,#0c2854,#0b1c44 68%,#211746)',borderColor:'var(--border-strong)',color:'var(--ink)'}}>
   <span className="mx-auto flex size-14 items-center justify-center rounded-2xl" style={{background:'var(--accent-muted)',color:'var(--accent)'}}><Icon className="size-7"/></span>
   <h1 className="display mt-5 text-2xl font-bold">{feature}</h1>
   <p className="mt-2 text-sm font-semibold" style={{color:'var(--accent)'}}>Coming soon</p>
   <p className="mx-auto mt-3 max-w-sm text-sm leading-6" style={{color:'var(--muted)'}}>{feature==='Exchange'?'Unified Exchange will open after Swap and Bridge are fully verified.':'Agent will return after core payments and transfers are stable.'}</p>
  </section>
 </main>;
}