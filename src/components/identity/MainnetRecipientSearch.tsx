/** One recipient lookup interface used in both People and Pay.
 * Search is read-only; selecting a result never authorizes a transaction.
 */
import {useEffect,useRef,useState} from 'react';
import {Search,ShieldCheck,Wallet,ExternalLink} from 'lucide-react';
import {lookupMainnetRecipient,createRecipientSearchGuard,type RecipientSearchResult} from '@/mainnet/recipientLookup';

export function MainnetRecipientSearch({
 owner,sessionToken,initialQuery='',onSelection,onQueryEdit,label='Find a recipient',
}:{
 owner:string|null|undefined;sessionToken?:string;initialQuery?:string;
 onSelection:(result:RecipientSearchResult|null)=>void;onQueryEdit?:()=>void;label?:string;
}){
 const [value,setValue]=useState(initialQuery);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState<string|null>(null);
 const [result,setResult]=useState<RecipientSearchResult|null>(null);
 const guard=useRef(createRecipientSearchGuard());
 const current=useRef(onSelection);current.current=onSelection;
 useEffect(()=>{
  guard.current.invalid();setResult(null);setError(null);setBusy(false);
  current.current(null);
 },[owner,sessionToken]);
 useEffect(()=>{setValue(initialQuery);guard.current.invalid();setResult(null);setError(null);setBusy(false);},[initialQuery]);
 async function search(raw=value){
  const ticket=guard.current.start();setBusy(true);setError(null);setResult(null);
  current.current(null);
  try{
   const found=await lookupMainnetRecipient(raw,owner??'',sessionToken);
   if(!guard.current.isCurrent(ticket))return;
   setResult(found);
   if(found.kind!=='x-unavailable')current.current(found);
  }catch(e){
   if(guard.current.isCurrent(ticket))setError(e instanceof Error?e.message:'Recipient lookup is unavailable.');
  }finally{if(guard.current.isCurrent(ticket))setBusy(false);}
 }
 function edit(next:string){
  guard.current.invalid();setValue(next);setResult(null);setError(null);setBusy(false);current.current(null);onQueryEdit?.();
 }
 const address=result?.kind==='wallet'?result.wallet:result?.kind==='veyra'?result.person.wallet:null;
 return <div className="space-y-3">
  <label className="block text-sm font-semibold" style={{color:'var(--ink)'}}>{label}</label>
  <div className="flex min-w-0 flex-wrap gap-2">
   <input aria-label={label} autoComplete="off" spellCheck={false} value={value}
    maxLength={90} onChange={e=>edit(e.target.value)}
    onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();void search();}}}
    placeholder="@person.veyra · @Xhandle · 0x…"
    className="min-w-0 flex-1 rounded-xl border px-4 py-3 text-sm"
    style={{background:'var(--surface-raised)',borderColor:'var(--border)',color:'var(--ink)'}}/>
   <button type="button" disabled={busy||!value.trim()} onClick={()=>void search()}
    className="inline-flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold disabled:opacity-40"
    style={{background:'var(--accent)',color:'#0d1b2f'}}>
    <Search className="size-4"/>{busy?'Finding…':'Find'}
   </button>
  </div>
  {error&&<p role="alert" className="text-xs" style={{color:'var(--warning)'}}>{error}</p>}
  {result?.kind==='veyra'&&<section aria-label="Verified Veyra recipient" className="rounded-xl border p-3"
    style={{borderColor:'var(--border)',background:'var(--surface)'}}>
    <div className="flex items-center gap-3">
     <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-full"
      style={{color:'var(--accent)',background:'var(--accent-muted)'}}>
      {result.person.avatarUrl?<img src={result.person.avatarUrl} alt="" className="size-12 object-cover" referrerPolicy="no-referrer"/>:<ShieldCheck className="size-6"/>}
     </div>
     <div className="min-w-0 flex-1">
      <p className="font-semibold" style={{color:'var(--ink)'}}>{result.person.displayName||'Veyra member'}</p>
      <p className="text-sm" style={{color:'var(--muted)'}}>@{result.person.veyraHandle}.veyra</p>
     </div>
    </div>
    <p className="mt-3 text-xs" style={{color:'var(--accent)'}}>Veyra ID found · receiving wallet independently verified for Arc Mainnet</p>
    <details className="mt-2 text-xs" style={{color:'var(--muted)'}}>
     <summary className="cursor-pointer">Receiving wallet · full address</summary>
     <p className="mt-1 break-all font-mono">{address}</p>
    </details>
    <p className="mt-2 text-xs" style={{color:'var(--muted)'}}>
     Wallet and Veyra ID are verified for this payment review. This does not verify real-world identity.
    </p>
  </section>}
  {result?.kind==='wallet'&&<div className="rounded-xl border p-3 text-xs"
    style={{borderColor:'var(--border)',color:'var(--muted)'}}>
    <p className="flex items-center gap-2 font-semibold" style={{color:'var(--ink)'}}><Wallet className="size-4"/>Wallet address</p>
    <p className="mt-2 break-all font-mono">{address}</p>
    <p className="mt-2">Address format checked only · not a verified Veyra account. Confirm ownership independently.</p>
   </div>}
  {result?.kind==='x-unavailable'&&<div role="status" className="rounded-xl border p-3 text-xs"
    style={{borderColor:'var(--border)',color:'var(--muted)'}}>
    <p className="font-semibold" style={{color:'var(--ink)'}}>@{result.handle} · X search</p>
    <p className="mt-1">No receiving wallet can be verified for this X handle in Mainnet V1.
     An X name alone never proves wallet ownership. No payment was prepared.</p>
    <button type="button" className="mt-2 inline-flex items-center gap-1 font-semibold"
     style={{color:'var(--accent)'}} onClick={()=>void navigator.clipboard?.writeText(result.inviteText)}>
     <ExternalLink className="size-3.5"/>Copy Veyra invitation
    </button>
   </div>}
 </div>;
}
