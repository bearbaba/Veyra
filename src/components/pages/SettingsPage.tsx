/**
 * Veyra Settings — secondary account / identity / safety surface.
 *
 * The primary product stays Home / Pay / Agent / Activity. Settings exposes
 * identity state and deterministic safety without turning the app into a
 * developer dashboard.
 */

import { useEffect,useState } from 'react';
import { useAccount, useDisconnect } from 'wagmi';
import { ConnectKitButton } from 'connectkit';
import { Check, ChevronDown, Copy, Link2, Loader2, ShieldCheck, SlidersHorizontal, Wallet, LogOut } from 'lucide-react';
import { DEFAULT_VEYRA_POLICY } from '@/core/policy/policyEngine';
import { VEYRA_ENV } from '@/lib/env';
import { beginXLink, getXLinkCapability } from '@/lib/api/identityApi';
import { useVeyraIdentity } from '@/hooks/useVeyraIdentity';
import { PRODUCT_ASSETS, PRODUCT_NETWORKS } from '@/config/productRegistry';
import { RuntimeStatusCard } from '../system/RuntimeStatusCard';
import { BrandLogo } from '../brand/BrandLogo';
import { useUnifiedSocial } from '../../features/social/UnifiedSocial';
import { VeyraIdentityAccess } from '../identity/VeyraIdentityAccess';

export function SettingsPage({ onOpenSocial }: { onOpenSocial: () => void }) {
  const { address, isConnected } = useAccount();
  const {disconnectAsync}=useDisconnect();
  const identity = useVeyraIdentity();
  const social = useUnifiedSocial();
  const [copied, setCopied] = useState(false);
  const [idCopied,setIdCopied]=useState(false);
  const [disconnecting,setDisconnecting]=useState(false);
  const [logoutWarning,setLogoutWarning]=useState<string|null>(null);
  const [xLoading, setXLoading] = useState(false);
  const [xError, setXError] = useState<string | null>(null);
  // Fail closed until the exact, owner-trusted Testnet BFF reports it has
  // X OAuth credentials and a pinned callback. No redirect on mere "BFF online".
  const [xCapability,setXCapability]=useState<'checking'|'available'|'unavailable'>('unavailable');
  const profile = identity.profile;
  const signedToken=social.session?.token;
  useEffect(()=>{
    if(!signedToken||social.identityOrigin!=='ready'||profile?.x){
      setXCapability('unavailable');return;
    }
    let cancelled=false;
    setXCapability('checking');
    void getXLinkCapability().then(allowed=>{
      if(!cancelled)setXCapability(allowed?'available':'unavailable');
    }).catch(()=>{if(!cancelled)setXCapability('unavailable');});
    return()=>{cancelled=true;};
  },[signedToken,social.identityOrigin,profile?.x]);
  const xAvatar = profile?.x?.avatarUrl;
  const approvedXAvatar = typeof xAvatar==='string' &&
    /^https:\/\/pbs\.twimg\.com\/profile_images\/[0-9]+\/[A-Za-z0-9_-]+(?:\.[A-Za-z0-9]+)?(?:\?.*)?$/.test(xAvatar)
    ? xAvatar : null;

  async function linkX() {
    setXError(null);
    if (xCapability!=='available') {
      setXError('X linking is not configured for this trusted Veyra domain. Your Veyra ID and wallet are unchanged.');
      return;
    }
    if (!profile || !social.session) {
      setXError('Sign in below with your connected wallet before linking X. Your Veyra ID will not change.');
      return;
    }
    if (profile.x) return;
    setXLoading(true);
    try {
      const authorizeUrl = await beginXLink('/settings');
      window.location.assign(authorizeUrl);
    } catch (error) {
      setXError(error instanceof Error ? error.message : 'Unable to start X linking');
      setXLoading(false);
    }
  }

  async function copyId(){
    const handle=profile?.veyraHandle ?? identity.lastUsedHandle;
    if(!handle)return;
    try{await navigator.clipboard.writeText('@'+handle+'.veyra');setIdCopied(true);}
    catch{setLogoutWarning('Copy failed. Select the Veyra ID above to copy it manually.');}
  }
  async function disconnectWallet(){
    if(disconnecting)return;
    setDisconnecting(true);setLogoutWarning(null);
    // One awaited server logout: avoid duplicate requests and a cookie
    // restore racing with the wallet disconnect.
    const serverLogout=await social.signOut();
    try{await disconnectAsync();}
    catch{setLogoutWarning('Wallet extension did not disconnect. Check MetaMask and retry.');}
    if(!serverLogout)setLogoutWarning('Server sign-out was not confirmed. An unexpired session might be restored when reconnecting the same wallet.');
    setDisconnecting(false);
  }
  function copyAddress() {
    if (!address) return;
    void navigator.clipboard.writeText(address).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5 px-4 py-7 md:px-7 md:py-9">
      <div>
        <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em]" style={{ color: 'var(--accent)' }}>
          <SlidersHorizontal className="size-4" /> Account
        </div>
        <h1 className="display mt-2 text-3xl font-black" style={{ color: 'var(--ink)', letterSpacing: '-0.04em' }}>Identity & settings</h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>Your wallet, Veyra ID and connected accounts in one place.</p>
      </div>

      <section className="space-y-3">
        <div className="rounded-3xl p-5 md:p-6" style={{ background: 'var(--surface-strong)', border: '1px solid var(--border-strong)' }}>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex size-12 items-center justify-center rounded-2xl" style={{ background: 'linear-gradient(135deg,#7c3aed,#ec4899)', color: 'white' }}>
                {approvedXAvatar?<img src={approvedXAvatar} alt="Verified linked X profile avatar"
                  referrerPolicy="no-referrer" loading="lazy" className="size-full rounded-2xl object-cover"/>:
                  <ShieldCheck className="size-5" />}
              </div>
              <div>
                <div className="text-[10px] font-bold uppercase tracking-[0.18em]" style={{ color: 'var(--subtle)' }}>Veyra identity</div>
                <div className="mt-1 text-xl font-bold" style={{ color: 'var(--ink)' }}>{profile ? `@${profile.veyraHandle}.veyra` : identity.lastUsedHandle ? `@${identity.lastUsedHandle}.veyra` : 'Not signed in'}</div>
                <div className="mt-0.5 text-xs" style={{ color: 'var(--muted)' }}>{profile ? 'Verified for your connected wallet' : identity.lastUsedHandle ? 'Last used ID · Sign in to verify' : 'Sign in with the connected wallet on this page'}</div>
              </div>
            </div>
            {profile && (
              <button type="button" onClick={onOpenSocial}
                className="rounded-xl border px-3.5 py-2.5 text-xs font-semibold"
                style={{ borderColor:'var(--border-strong)', color:'var(--ink)' }}>Open Friends</button>
            )}
          </div>

          {!profile && <div className="mt-4"><VeyraIdentityAccess/></div>}

          <div className="mt-5 grid gap-2 sm:grid-cols-3">
            <AccountEndpoint label="Wallet" value={isConnected && address ? shortAddress(address) : 'Not connected'} ready={isConnected} icon={<Wallet className="size-4" />} />
            <AccountEndpoint label="Veyra ID" value={profile ? `@${profile.veyraHandle}.veyra` : identity.lastUsedHandle ? `@${identity.lastUsedHandle}.veyra (last used)` : 'Not signed in'} ready={Boolean(profile)} icon={<ShieldCheck className="size-4" />} />
            <AccountEndpoint label="X" value={profile?.x?.xHandle ? `@${profile.x.xHandle}` : 'Not linked'} ready={Boolean(profile?.x)} icon={<span className="text-xs font-black">X</span>} />
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {(profile||identity.lastUsedHandle)&&<button type="button" onClick={()=>void copyId()}
              className="flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold"
              style={{borderColor:'var(--border)',color:'var(--ink)'}}>
              {idCopied?<Check size={14}/>:<Copy size={14}/>}
              {idCopied?'Veyra ID copied':'Copy Veyra ID'}
            </button>}
            {!isConnected && <ConnectKitButton />}
            {isConnected && address && (
              <button onClick={copyAddress} className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold" style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--muted)' }}>
                {copied ? <Check className="size-3.5" style={{ color: 'var(--success)' }} /> : <Copy className="size-3.5" />}
                {copied ? 'Copied wallet' : 'Copy wallet'}
              </button>
            )}
            {isConnected&&<button type="button" disabled={disconnecting}
              onClick={()=>void disconnectWallet()}
              className="flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold disabled:opacity-50"
              style={{borderColor:'var(--border)',color:'var(--ink)'}}>
              <LogOut size={14}/>{disconnecting?'Disconnecting…':'Disconnect wallet'}
            </button>}
            <button onClick={() => void linkX()} disabled={xCapability!=='available' || social.identityOrigin !== 'ready' || !social.session || Boolean(profile?.x) || xLoading} className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold disabled:opacity-50" style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--ink)' }}>
              {xLoading ? <Loader2 className="size-3.5 animate-spin" /> : <Link2 className="size-3.5" />}
              {profile?.x ? 'X linked' : xCapability==='checking' ? 'Checking X…' : xCapability==='unavailable' ? 'X linking unavailable' : 'Connect X'}
            </button>
          </div>
          {logoutWarning&&<p role="alert" className="mt-3 text-xs" style={{color:"var(--warning)"}}>{logoutWarning}</p>}
          {xCapability==='unavailable'&&!profile?.x && <p role="status" className="mt-3 text-xs" style={{color:'var(--muted)'}}>Connect X will become available after the account-link service is verified. Your Veyra ID stays the same.</p>}
          {xError && <p className="mt-3 text-xs" style={{ color: 'var(--warning)' }}>{xError}</p>}
        </div>

        <RuntimeStatusCard />
      </section>

      <section className="rounded-3xl border p-5" style={{background:'var(--surface-strong)',borderColor:'var(--border)'}}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-4" style={{color:'var(--success)'}}/>
            <div>
              <h2 className="text-sm font-bold" style={{color:'var(--ink)'}}>Transaction protection</h2>
              <p className="mt-1 text-xs leading-5" style={{color:'var(--muted)'}}>
                Every payment is reviewed before wallet approval. Testnet funds only.
              </p>
            </div>
          </div>
          <span className="rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider"
            style={{background:'var(--success-muted)',color:'var(--success)'}}>{DEFAULT_VEYRA_POLICY.displayName}</span>
        </div>
        <details className="group mt-3 border-t pt-3" style={{borderColor:'var(--border)'}}>
          <summary className="flex cursor-pointer items-center gap-2 text-xs font-semibold"
            style={{color:'var(--muted)'}}>View protection rules and environment
            <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" aria-hidden="true"/>
          </summary>
          <p className="mt-3 text-xs leading-5" style={{color:'var(--muted)'}}>
            Agent conversation cannot override transaction safeguards. Network, amount, recipient and route are verified before signing.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {DEFAULT_VEYRA_POLICY.rules.slice(0, 6).map(rule=>
              <span key={rule.ruleId} className="rounded-xl border px-2.5 py-1.5 font-mono text-[10px]"
                style={{borderColor:'var(--border)',color:'var(--muted)'}}>{rule.ruleId}</span>)}
          </div>
          <p className="mt-3 text-[11px]" style={{color:'var(--subtle)'}}>Environment:
            <span className="ml-1 font-semibold uppercase"
              style={{color:VEYRA_ENV==='mainnet'?'var(--danger)':'var(--success)'}}>{VEYRA_ENV}</span>
          </p>
        </details>
      </section>

      <details className="group rounded-3xl border p-5"
        style={{background:'var(--surface-strong)',borderColor:'var(--border)'}}>
        <summary className="flex cursor-pointer items-center gap-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-bold" style={{color:'var(--ink)'}}>Networks & assets</span>
            <span className="mt-1 block text-xs leading-5" style={{color:'var(--muted)'}}>
              Arc Testnet USDC is enabled. Other listings are not available for sending yet.
            </span>
          </span>
          <ChevronDown className="size-4 shrink-0 transition-transform group-open:rotate-180"
            style={{color:'var(--muted)'}} aria-hidden="true"/>
        </summary>
        <div className="mt-4 grid gap-4 border-t pt-4 lg:grid-cols-2" style={{borderColor:'var(--border)'}}>
          <CapabilityCard title="Networks" subtitle="Listed networks are not automatically supported payment routes.">
            <div className="grid grid-cols-4 gap-3 sm:grid-cols-7">
              {PRODUCT_NETWORKS.map(network=>
                <CapabilityItem key={network.id} logoKey={network.logoKey} name={network.shortName} active={network.executionEnabled}/>)}
            </div>
          </CapabilityCard>
          <CapabilityCard title="Assets" subtitle="Displayed assets are not spendable until a verified route is enabled.">
            <div className="grid grid-cols-4 gap-3 sm:grid-cols-5">
              {PRODUCT_ASSETS.slice(0,5).map(asset=>
                <CapabilityItem key={asset.id} logoKey={asset.logoKey} name={asset.symbol} active={asset.executionEnabled}/>)}
            </div>
            {PRODUCT_ASSETS.length>5&&<p className="mt-3 text-[11px]" style={{color:'var(--subtle)'}}>
              Also recognized: {PRODUCT_ASSETS.slice(5).map(asset=>asset.symbol).join(', ')}.
            </p>}
          </CapabilityCard>
        </div>
      </details>

    </div>
  );
}

function AccountEndpoint({ label, value, ready, icon }: { label: string; value: string; ready: boolean; icon: React.ReactNode }) {
  return (
    <div className="rounded-2xl p-3" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
      <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider" style={{ color: ready ? 'var(--success)' : 'var(--subtle)' }}>{icon}{label}</div>
      <div className="mt-2 truncate text-xs font-semibold" style={{ color: ready ? 'var(--ink-2)' : 'var(--subtle)' }}>{value}</div>
    </div>
  );
}

function CapabilityCard({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="rounded-3xl p-5" style={{ background: 'var(--surface-strong)', border: '1px solid var(--border)' }}>
      <h2 className="text-sm font-bold" style={{ color: 'var(--ink)' }}>{title}</h2>
      <p className="mt-0.5 text-xs leading-5" style={{ color: 'var(--subtle)' }}>{subtitle}</p>
      <div className="mt-4">{children}</div>
    </div>
  );
}

function CapabilityItem({ logoKey, name, active }: { logoKey: string; name: string; active: boolean }) {
  return (
    <div className="min-w-0 text-center">
      <div className="relative mx-auto w-fit">
        <BrandLogo logoKey={logoKey} size={36} />
        {active && <span className="absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2" style={{ background: 'var(--success)', borderColor: '#13243a' }} />}
      </div>
      <div className="mt-2 truncate text-[10px] font-semibold" style={{ color: 'var(--ink-2)' }}>{name}</div>
    </div>
  );
}

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
