/** Do not silently route a Mainnet wallet to Testnet Swap or Bridge. */
import { Lock, ArrowLeftRight, Route } from 'lucide-react';
export function MainnetFeatureStatus({feature}:{feature:'swap'|'bridge'}){
  const swap=feature==='swap';
  return <div className="mx-auto w-full max-w-2xl space-y-5 px-4 py-7 md:px-7 md:py-9">
    <p className="text-xs font-bold uppercase" style={{color:'var(--accent)'}}>Arc Mainnet · 5042</p>
    <h1 className="display text-3xl font-bold" style={{color:'var(--ink)'}}>{swap?'Swap':'Bridge'}</h1>
    <div className="rounded-2xl border p-6 sm:p-8" style={{background:'var(--surface)',borderColor:'var(--border)'}}>
      <div className="flex items-center gap-3">
        {swap?<ArrowLeftRight className="size-6" style={{color:'var(--accent)'}}/>:<Route className="size-6" style={{color:'var(--accent)'}}/>}
        <h2 className="text-lg font-semibold" style={{color:'var(--ink)'}}>
          Mainnet {swap?'Swap':'Bridge'} · Not activated
        </h2>
      </div>
      <p className="mt-4 text-sm leading-6" style={{color:'var(--muted)'}}>
        Your live Arc Mainnet wallet balance is displayed above. This route requires a verified
        Mainnet liquidity or CCTP provider and successful settlement tests. Veyra will not
        redirect real money to a Testnet transaction.
      </p>
      <div className="mt-5 flex items-center gap-2 rounded-xl border p-3 text-sm"
        style={{borderColor:'var(--border)',color:'var(--muted)'}}>
        <Lock className="size-4"/> Signing is disabled for this route until verified.
      </div>
    </div>
  </div>;
}
