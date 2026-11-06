/** One owner's Unified operation checkpoint, not a cross-device account receipt.
 * No automatic retry and no status upgrade based solely on an SDK return.
 */
import {useEffect,useState} from 'react';
import {useAccount} from 'wagmi';
import {Clock3,ExternalLink} from 'lucide-react';
import {readGatewayMainnetOperation,type GatewayMainnetOperation} from '@/mainnet/gatewayMainnetJournal';
export function MainnetUnifiedActivity(){
 const {address}=useAccount();
 const [entry,setEntry]=useState<GatewayMainnetOperation|null|'blocked'>(null);
 useEffect(()=>{
  if(!address){setEntry(null);return;}
  const check=()=>setEntry(readGatewayMainnetOperation(address));
  check();window.addEventListener('focus',check);
  window.addEventListener('storage',check);window.addEventListener('veyra:gateway:mainnet',check);
  return()=>{window.removeEventListener('focus',check);
   window.removeEventListener('storage',check);window.removeEventListener('veyra:gateway:mainnet',check);};
 },[address]);
 if(!entry)return null;
 const label=entry==='blocked'?'Unknown checkpoint':entry.kind==='deposit'?'Unified deposit':'Unified transfer';
 const explorer=entry==='blocked'?null:entry.chainId===1?'https://etherscan.io/tx/':'https://basescan.org/tx/';
 return <section aria-label="Unified operation history" className="veyra-card p-4">
  <div className="flex items-center gap-2">
   <Clock3 className="size-4 shrink-0" style={{color:'var(--warning)'}}/>
   <div className="min-w-0 flex-1">
    <p className="font-semibold" style={{color:'var(--ink)'}}>{label}</p>
    <p className="mt-1 text-xs" style={{color:'var(--muted)'}}>
     {entry==='blocked'?'Stored operation could not be verified; do not resend.':
      entry.amount+' USDC · '+(entry.chainId===1?'Ethereum':'Base')+
      ' · '+(entry.status==='UNKNOWN'?'Wallet outcome unknown':
       entry.status==='CREDIT_OBSERVED'?'Gateway credit observed · final verification required':
       'Submitted · outcome unverified')}
    </p>
   </div>
  </div>
  {entry!=='blocked'&&<details className="mt-3 border-t pt-3 text-xs"
   style={{borderColor:'var(--border)',color:'var(--muted)'}}>
   <summary className="cursor-pointer">Details · original request</summary>
   <div className="mt-2 space-y-1">
    <p>Owner: {entry.owner}</p><p>Recipient: {entry.recipient}</p>
    {entry.destinationChainId&&<p>Destination chain: {entry.destinationChainId===1?'Ethereum':'Base'}</p>}
    <p>Started: {new Date(entry.createdAt).toLocaleString()}</p>
    {entry.sourceHash&&explorer&&<a href={explorer+entry.sourceHash} target="_blank" rel="noreferrer"
     className="inline-flex items-center gap-1 break-all underline"
     style={{color:'var(--accent)'}}><ExternalLink className="size-3"/>Source transaction · {entry.sourceHash}</a>}
    {entry.transferId&&<p className="break-all">Gateway transfer reference: {entry.transferId}</p>}
   </div>
  </details>}
  <p className="mt-3 text-xs leading-5" style={{color:'var(--warning)'}}>
   This record is stored only in this browser. SDK submission or a source approval is NOT destination settlement proof; no automatic replay.
  </p>
 </section>;
}
