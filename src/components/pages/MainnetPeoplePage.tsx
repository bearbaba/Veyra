/** People is backed by signed identity; local contacts are never portrayed as verified. */
import {useEffect,useState} from 'react';
import {useAccount} from 'wagmi';
import {isAddress} from 'viem';
import {UserRoundCheck,Search,Send,ShieldAlert,RefreshCw} from 'lucide-react';
import {useUnifiedSocial,friendLabel} from '../../features/social/UnifiedSocial';
import {VeyraIdentityAccess} from '../identity/VeyraIdentityAccess';
import {MainnetContactsPage} from './MainnetContactsPage';
import {preparePaymentRecipient,verifyPaymentRecipient} from '@/lib/api/identityApi';
import {validVerifiedRecipient,type VerifiedMainnetRecipient} from '@/mainnet/verifiedRecipient';
const HANDLE=/^@?[a-z0-9_-]{2,32}(?:\.veyra)?$/i;
export function MainnetPeoplePage({onPayVerified,onPayWallet}:{
 onPayVerified:(value:VerifiedMainnetRecipient)=>void;onPayWallet:(wallet:string)=>void;
}){
 const {address}=useAccount(),social=useUnifiedSocial();
 const [name,setName]=useState(''),[busy,setBusy]=useState(false);
 const [error,setError]=useState<string|null>(null);
 const [selected,setSelected]=useState<VerifiedMainnetRecipient|null>(null);
 useEffect(()=>{setSelected(null);setError(null);},[address,social.session?.token]);
 const ready=!!address&&social.identityOrigin==='ready'&&!!social.session?.token;
 async function find(value=name){
  if(!ready||!address||!social.session?.token||busy)return;
  if(!HANDLE.test(value.trim())){setError('Enter a complete Veyra ID such as @alex.veyra.');return;}
  setBusy(true);setSelected(null);setError(null);
  try{
   const normalized='@'+value.trim().replace(/^@/,'').replace(/\.veyra$/i,'')+'.veyra';
   const data=await preparePaymentRecipient(normalized,5042,social.session.token);
   if(data.kind!=='VEYRA_IDENTITY'||data.chainId!==5042||!data.snapshot||
       !isAddress(data.resolvedAddress))
    throw Error('This Veyra ID does not have a server-verified Arc Mainnet receiving wallet.');
   const x=data.snapshot;
   const verified:VerifiedMainnetRecipient={owner:address,wallet:data.resolvedAddress,
    walletId:x.walletId,veyraUserId:x.veyraUserId,veyraHandle:x.veyraHandle,
    displayName:x.displayName,snapshotId:x.snapshotId,reviewToken:x.reviewToken,expiresAt:x.expiresAt};
   if(!validVerifiedRecipient(verified,address,data.resolvedAddress))
    throw Error('The recipient snapshot is invalid or expired. Please look up this ID again.');
   // This call is read-only and rechecked again at payment review + before wallet signing.
   await verifyPaymentRecipient({snapshotId:verified.snapshotId,expectedWalletId:verified.walletId,
    expectedWalletAddress:verified.wallet,expectedChainId:5042,reviewToken:verified.reviewToken},social.session.token);
   setSelected(verified);
  }catch(e){setError((e instanceof Error?e.message:'Veyra recipient unavailable')+
    ' No recipient was selected or money sent. Mainnet ID Pay requires an approved backend.');}
  finally{setBusy(false);}
 }
 return <main className="mx-auto w-full max-w-4xl space-y-5 px-4 py-7 md:px-7 md:py-9">
  <header>
   <p className="text-xs font-bold uppercase tracking-wider" style={{color:'var(--accent)'}}>People</p>
   <h1 className="display mt-2 text-3xl font-bold" style={{color:'var(--ink)'}}>Send money to people.</h1>
   <p className="mt-2 text-sm" style={{color:'var(--muted)'}}>A verified Veyra ID shows the receiving wallet before you sign. Local contacts are separate.</p>
  </header>
  {social.session&&social.identityOrigin==='ready'?<section className="rounded-xl border p-4" style={{borderColor:'var(--border)',background:'var(--surface)'}}>
   <div className="flex items-center gap-3">
    <div className="flex size-12 items-center justify-center rounded-full" style={{background:'var(--accent-muted)',color:'var(--accent)'}}><UserRoundCheck className="size-6"/></div>
    <div className="min-w-0 flex-1">
     <p className="text-sm font-semibold" style={{color:'var(--ink)'}}>{'@'+social.session.profile.veyraHandle+'.veyra'}</p>
     <p className="text-xs" style={{color:'var(--muted)'}}>Wallet-authenticated profile · {address?.slice(0,8)}…{address?.slice(-5)}</p>
    </div>
    <span className="text-xs" style={{color: 'var(--muted)'}}>X: {social.session.profile.x?.xHandle?'@'+social.session.profile.x.xHandle:'Not linked'}</span>
   </div>
  </section>:<VeyraIdentityAccess/>}
  {ready&&<section className="rounded-xl border p-4 sm:p-5" style={{borderColor:'var(--border)',background:'var(--surface)'}}>
   <h2 className="text-base font-semibold" style={{color:'var(--ink)'}}>Find by Veyra ID</h2>
   <div className="mt-3 flex flex-wrap gap-2">
    <input aria-label="Find Veyra ID" value={name} onChange={e=>{setName(e.target.value);setSelected(null);setError(null);}}
     placeholder="@friend.veyra" maxLength={40} autoComplete="off"
     className="min-w-0 flex-1 rounded-xl border px-3 py-3 text-sm"
     style={{borderColor:'var(--border)',background:'var(--surface-raised)',color:'var(--ink)'}}/>
    <button type="button" disabled={busy} onClick={()=>void find()}
     className="flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-40"
     style={{background:'var(--accent)',color:'#0d1b2f'}}>{busy?<RefreshCw className="size-4 animate-spin"/>:<Search className="size-4"/>}Verify</button>
   </div>
   {error&&<p role="alert" className="mt-3 text-sm" style={{color:'var(--warning)'}}>{error}</p>}
   {selected&&<div className="mt-4 rounded-xl border p-4" style={{borderColor:'var(--border-strong)'}}>
    <p className="font-semibold" style={{color:'var(--ink)'}}>{'@'+selected.veyraHandle+'.veyra'}</p>
    <p className="mt-1 text-xs" style={{color:'var(--muted)'}}>Receiving wallet verified for this request. Review the full address before signing.</p>
    <p className="mt-3 break-all font-mono text-sm" style={{color:'var(--ink)'}}>{selected.wallet}</p>
    <p className="mt-2 text-xs" style={{color:'var(--muted)'}}>Snapshot expires {new Date(selected.expiresAt).toLocaleTimeString()}. Recipient will be rechecked before signing.</p>
    <div className="mt-3 flex flex-wrap gap-2">
     <button type="button" onClick={()=>onPayVerified(selected)} className="flex items-center gap-2 rounded-lg px-4 py-3 text-sm font-semibold"
      style={{background:'var(--accent)',color:'#0d1b2f'}}><Send className="size-4"/>Send USDC</button>
     <button type="button" disabled className="rounded-lg border px-4 py-3 text-sm opacity-50" style={{borderColor:'var(--border)',color:'var(--muted)'}}>Request · coming later</button>
    </div>
   </div>}
   <div className="mt-5 border-t pt-4" style={{borderColor:'var(--border)'}}>
    <div className="flex items-center justify-between">
     <h3 className="text-sm font-semibold" style={{color:'var(--ink)'}}>Friends</h3>
     <button type="button" onClick={()=>void social.refresh()} className="text-xs" style={{color:'var(--accent)'}}>Refresh</button>
    </div>
    {social.friends.filter(x=>x.state==='CONNECTED').length===0?
      <p className="mt-2 text-sm" style={{color:'var(--muted)'}}>No connected friends yet. Search a verified Veyra ID to send.</p>:
      <div className="mt-2 space-y-2">{social.friends.filter(x=>x.state==='CONNECTED').map(x=><button key={x.veyraUserId}
       onClick={()=>{const id=friendLabel(x);setName(id);void find(id);}} type="button"
       className="flex w-full items-center justify-between rounded-lg border px-3 py-3 text-sm"
       style={{borderColor:'var(--border)',color:'var(--ink)'}}>{friendLabel(x)}<span style={{color:'var(--accent)'}}>Verify to send</span></button>)}</div>}
   </div>
  </section>}
  {social.identityOrigin!=='ready'&&<p className="flex items-start gap-2 text-xs" style={{color:'var(--muted)'}}>
   <ShieldAlert className="size-4 shrink-0"/>Mainnet Veyra ID actions require server-origin approval. A reachable backend alone does not enable sign-in.
  </p>}
  <details className="rounded-xl border p-4" style={{borderColor:'var(--border)',background:'var(--surface)'}}>
   <summary className="cursor-pointer text-sm font-semibold" style={{color:'var(--ink)'}}>Local wallet contacts (not verified Veyra IDs)</summary>
   <MainnetContactsPage onPay={onPayWallet}/>
  </details>
 </main>;
}
