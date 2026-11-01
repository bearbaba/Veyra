/**
 * Single Mainnet Pay entry. The route is chosen by the human before any wallet
 * signature. Existing wallet and Settlement signing implementations remain
 * independent and cannot silently switch the reviewed payment method.
 */
import {useEffect,useState} from 'react';
import {ArrowRight,ShieldCheck,Wallet} from 'lucide-react';
import {MainnetPayPage} from './MainnetPayPage';
import {SettlementPage} from './SettlementPage';

type Method='wallet'|'contract';
export function MainnetPayHub({
 initialMethod='wallet',friendHandle,recipientWallet,onRecipientUsed,
}:{
 initialMethod?:Method;friendHandle?:string|null;recipientWallet?:string|null;onRecipientUsed?:()=>void;
}){
 const [method,setMethod]=useState<Method>(initialMethod);
 useEffect(()=>setMethod(initialMethod),[initialMethod]);
 return <main className="mx-auto w-full max-w-4xl space-y-5 px-4 py-7 md:px-7 md:py-9">
  <header>
   <p className="text-xs font-semibold uppercase tracking-wider" style={{color:'var(--accent)'}}>Veyra · Arc Mainnet</p>
   <h1 className="display mt-2 text-3xl font-bold" style={{color:'var(--ink)'}}>Send USDC</h1>
   <p className="mt-2 text-sm" style={{color:'var(--muted)'}}>
    Choose how to send, review the recipient and amount, then confirm in your wallet. Veyra tracks the original transaction in Activity.
   </p>
  </header>
  <div className="grid gap-3 sm:grid-cols-2" role="group" aria-label="Choose payment method">
   <button type="button" aria-pressed={method==='wallet'} onClick={()=>setMethod('wallet')}
    className="rounded-2xl border p-4 text-left transition-colors"
    style={{borderColor:method==='wallet'?'var(--accent)':'var(--border)',
      background:method==='wallet'?'var(--accent-muted)':'var(--surface)',color:'var(--ink)'}}>
    <span className="flex items-center gap-2 text-sm font-bold"><Wallet className="size-5"/>Wallet transfer
     <span className="ml-auto text-[11px] font-semibold" style={{color:'var(--accent)'}}>Simplest</span></span>
    <span className="mt-2 block text-xs leading-5" style={{color:'var(--muted)'}}>
     Send directly to a wallet. One transfer confirmation; no token allowance.
    </span>
   </button>
   <button type="button" aria-pressed={method==='contract'} onClick={()=>setMethod('contract')}
    className="rounded-2xl border p-4 text-left transition-colors"
    style={{borderColor:method==='contract'?'var(--accent)':'var(--border)',
      background:method==='contract'?'var(--accent-muted)':'var(--surface)',color:'var(--ink)'}}>
    <span className="flex items-center gap-2 text-sm font-bold"><ShieldCheck className="size-5"/>Contract payment</span>
    <span className="mt-2 block text-xs leading-5" style={{color:'var(--muted)'}}>
     Through VeyraSettlement. A separate token approval may be required before payment.
    </span>
   </button>
  </div>
  {method==='wallet'?<section aria-label="Wallet transfer">
   <MainnetPayPage embedded friendHandle={friendHandle} recipientWallet={recipientWallet} onRecipientUsed={onRecipientUsed}/>
  </section>:<section aria-label="Contract payment" className="overflow-hidden rounded-2xl border"
   style={{borderColor:'var(--border)',background:'var(--surface)'}}>
   <SettlementPage embedded/>
  </section>}
  <p className="flex items-start gap-2 text-xs leading-5" style={{color:'var(--muted)'}}>
   <ArrowRight className="mt-0.5 size-4 shrink-0"/>
   Neither method moves funds until you approve the exact transaction in your own wallet.
   If a result is uncertain, check Activity instead of submitting another payment.
  </p>
 </main>;
}
