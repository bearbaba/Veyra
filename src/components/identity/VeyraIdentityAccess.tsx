/**
 * One reusable Veyra ID entry for Settings and Social.
 * A wallet connection is not an ID session: require one purpose-bound EIP-712
 * signature, but do not navigate to another page or open another wallet picker.
 */
import {useState} from 'react';
import {ConnectKitButton} from 'connectkit';
import {useAccount,useSwitchChain} from 'wagmi';
import {ShieldCheck} from 'lucide-react';
import {useUnifiedSocial} from '../../features/social/UnifiedSocial';

export function VeyraIdentityAccess(){
  const social=useUnifiedSocial();
  const {address}=useAccount();
  const {switchChainAsync}=useSwitchChain();
  const [create,setCreate]=useState<boolean | null>(null);
  const [handle,setHandle]=useState('');
  const [switchError,setSwitchError]=useState<string|null>(null);

  if(social.session)return null;

  if(!social.connected){
    return <section className="space-y-3 rounded-2xl border p-4" style={{borderColor:'var(--border)',background:'var(--surface)'}}>
      <p className="text-sm font-semibold">Connect your wallet</p>
      <p className="text-xs" style={{color:'var(--muted)'}}>One wallet connection for Pay, Social and Veyra ID. No second wallet selector.</p>
      <ConnectKitButton/>
    </section>;
  }

  // Connection survives a backend rejection; no more permission prompts.
  if(social.identityOrigin!=='ready'){
    const refused=social.identityOrigin==='origin_blocked';
    const checking=social.identityOrigin==='checking';
    return <section role="status" className="space-y-3 rounded-2xl border p-4"
      style={{borderColor:refused?'var(--warning)':'var(--border)',background:'var(--surface)'}}>
      <p className="text-sm font-semibold">
        {checking?'Checking Veyra ID connection…':refused?'This Preview is not authorized for Veyra ID':'Veyra ID service unavailable'}
      </p>
      <p className="text-xs leading-5" style={{color:'var(--muted)'}}>
        {checking?'Verifying the backend before requesting any wallet signature.'
          :refused?'Your wallet is connected. The backend rejected this website address (403 ORIGIN_NOT_ALLOWED). Use an approved Veyra domain after the server origin is configured. No signature was requested.'
          :'The identity service could not be verified. Your connected wallet remains safe; no signature or payment was submitted.'}
      </p>
      {!checking&&<button type="button" onClick={()=>void social.recheckIdentityOrigin()}
        className="rounded-lg border px-3 py-2 text-xs font-semibold"
        style={{borderColor:'var(--border-strong)',color:'var(--ink)'}}>Retry connection check</button>}
    </section>;
  }

  if(!social.ready){
    return <section className="space-y-3 rounded-2xl border p-4" style={{borderColor:'var(--border)',background:'var(--surface)'}}>
      <p className="text-sm font-semibold">Arc Testnet required for Veyra ID</p>
      <p className="text-xs" style={{color:'var(--muted)'}}>Connected: {address?.slice(0,6)}…{address?.slice(-4)}. Your wallet is already connected; switch network only once, on request.</p>
      <button type="button" disabled={social.busy} onClick={()=>{
        setSwitchError(null);
        void switchChainAsync({chainId:5042002}).catch(()=>{
          setSwitchError('Switch to Arc Testnet (5042002) in your wallet, then try again.');
        });
      }} className="rounded-xl px-3 py-2 text-xs font-semibold disabled:opacity-40"
        style={{background:'var(--accent)',color:'var(--bg)'}}>Switch to Arc Testnet</button>
      {switchError&&<p role="alert" className="text-xs" style={{color:'var(--warning)'}}>{switchError}</p>}
    </section>;
  }

  const needsCreate=create ?? social.needsRegistration;
  return <section className="max-w-lg space-y-3 rounded-2xl border p-4"
    style={{borderColor:'var(--border)',background:'var(--surface)'}}>
    <p className="text-sm font-semibold">Continue with your connected wallet</p>
    <p className="text-xs" style={{color:'var(--muted)'}}>
      {address?.slice(0,6)}…{address?.slice(-4)} · One identity-only signature. No transfer, approval or asset access.
    </p>
    {social.error&&<p role="alert" className="rounded-lg border p-2 text-xs" style={{color:'var(--danger)',borderColor:'var(--danger)'}}>{social.error}</p>}
    {needsCreate?<>
      <label htmlFor="veyra-identity-entry-handle" className="text-xs font-semibold">Create your public Veyra ID</label>
      <input id="veyra-identity-entry-handle" autoComplete="off" maxLength={30}
        value={handle} onChange={e=>setHandle(e.target.value)}
        placeholder="yourname" className="w-full rounded-xl border bg-transparent p-3 text-sm"
        style={{borderColor:'var(--border)'}}/>
      <button type="button" disabled={social.busy||handle.trim().length<3}
        onClick={()=>void social.register(handle)}
        className="w-full rounded-xl px-4 py-3 text-sm font-semibold disabled:opacity-40"
        style={{background:'var(--accent)',color:'var(--bg)'}}>
        {social.busy?'Verifying…':'Create ID with this wallet'}
      </button>
    </>:<button type="button" disabled={social.busy} onClick={()=>void social.signIn()}
      className="w-full rounded-xl px-4 py-3 text-sm font-semibold disabled:opacity-40"
      style={{background:'var(--accent)',color:'var(--bg)'}}>
      {social.busy?'Verifying…':'Sign in to Veyra ID'}
    </button>}
    <button type="button" disabled={social.busy} onClick={()=>setCreate(!needsCreate)}
      className="text-xs underline" style={{color:'var(--muted)'}}>
      {needsCreate?'Already have an ID? Sign in':'New to Veyra? Create an ID'}
    </button>
    <p className="flex items-center gap-2 text-xs" style={{color:'var(--subtle)'}}>
      <ShieldCheck size={14}/> Identity verification never authorizes a payment.
    </p>
  </section>;
}
