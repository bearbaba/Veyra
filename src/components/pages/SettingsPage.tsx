/**
 * Veyra Settings — secondary account / identity / safety surface.
 *
 * The primary product stays Home / Pay / Agent / Activity. Settings exposes
 * identity state and deterministic safety without turning the app into a
 * developer dashboard.
 */

import { useState } from 'react';
import { useAccount } from 'wagmi';
import { ConnectKitButton } from 'connectkit';
import { Check, Copy, Link2, Loader2, ShieldCheck, SlidersHorizontal, Wallet } from 'lucide-react';
import { DEFAULT_VEYRA_POLICY } from '@/core/policy/policyEngine';
import { VEYRA_ENV } from '@/lib/env';
import { beginXLink, type MyProfile } from '@/lib/api/identityApi';
import { useVeyraIdentity } from '@/hooks/useVeyraIdentity';
import { PRODUCT_ASSETS, PRODUCT_NETWORKS } from '@/config/productRegistry';
import { RuntimeStatusCard } from '../system/RuntimeStatusCard';
import { BrandLogo } from '../brand/BrandLogo';
import { CreateVeyraIdModal } from '../identity/CreateVeyraIdModal';

export function SettingsPage() {
  const { address, isConnected } = useAccount();
  const identity = useVeyraIdentity();
  const [copied, setCopied] = useState(false);
  const [identityOpen, setIdentityOpen] = useState(false);
  const [xLoading, setXLoading] = useState(false);
  const [xError, setXError] = useState<string | null>(null);

  const profile = identity.profile;

  async function linkX() {
    setXError(null);
    if (!profile) {
      setIdentityOpen(true);
      setXError('Create your Veyra ID first, then link X to the same identity.');
      return;
    }
    if (identity.preview) {
      setXError('X linking requires a real signed Veyra session. Local preview IDs are UI-only.');
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

  function copyAddress() {
    if (!address) return;
    void navigator.clipboard.writeText(address).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }

  function onIdentityCreated(_profile: MyProfile) {
    void identity.refresh();
    setXError(null);
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5 px-4 py-7 md:px-7 md:py-9">
      <div>
        <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em]" style={{ color: 'var(--accent)' }}>
          <SlidersHorizontal className="size-4" /> Account
        </div>
        <h1 className="display mt-2 text-3xl font-black" style={{ color: 'var(--ink)', letterSpacing: '-0.04em' }}>Identity & settings</h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>Your Veyra identity, linked endpoints, and the safety state underneath every action.</p>
      </div>

      <section className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="rounded-3xl p-5 md:p-6" style={{ background: 'var(--surface-strong)', border: '1px solid var(--border-strong)' }}>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex size-12 items-center justify-center rounded-2xl" style={{ background: 'linear-gradient(135deg,#7c3aed,#ec4899)', color: 'white' }}>
                <ShieldCheck className="size-5" />
              </div>
              <div>
                <div className="text-[10px] font-bold uppercase tracking-[0.18em]" style={{ color: 'var(--subtle)' }}>Veyra identity</div>
                <div className="mt-1 text-xl font-bold" style={{ color: 'var(--ink)' }}>{profile ? `@${profile.veyraHandle}` : 'Not created'}</div>
                <div className="mt-0.5 text-xs" style={{ color: 'var(--muted)' }}>{identity.preview ? 'Local preview ID · not reserved' : profile ? 'Canonical identity' : 'Create once, link verified endpoints'}</div>
              </div>
            </div>
            {!profile && (
              <button onClick={() => setIdentityOpen(true)} className="rounded-xl px-3.5 py-2.5 text-xs font-bold" style={{ background: 'linear-gradient(135deg,#c8ff65,#91e9b5)', color: '#0b1b25' }}>
                Create Veyra ID
              </button>
            )}
          </div>

          <div className="mt-5 grid gap-2 sm:grid-cols-3">
            <AccountEndpoint label="Wallet" value={isConnected && address ? shortAddress(address) : 'Not connected'} ready={isConnected} icon={<Wallet className="size-4" />} />
            <AccountEndpoint label="Veyra ID" value={profile ? `@${profile.veyraHandle}` : 'Not created'} ready={Boolean(profile)} icon={<ShieldCheck className="size-4" />} />
            <AccountEndpoint label="X" value={profile?.x?.xHandle ? `@${profile.x.xHandle}` : 'Not linked'} ready={Boolean(profile?.x)} icon={<span className="text-xs font-black">X</span>} />
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {!isConnected && <ConnectKitButton />}
            {isConnected && address && (
              <button onClick={copyAddress} className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold" style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--muted)' }}>
                {copied ? <Check className="size-3.5" style={{ color: 'var(--success)' }} /> : <Copy className="size-3.5" />}
                {copied ? 'Copied wallet' : 'Copy wallet'}
              </button>
            )}
            <button onClick={() => void linkX()} disabled={Boolean(profile?.x) || xLoading} className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold disabled:opacity-50" style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--ink)' }}>
              {xLoading ? <Loader2 className="size-3.5 animate-spin" /> : <Link2 className="size-3.5" />}
              {profile?.x ? 'X linked' : 'Connect X'}
            </button>
          </div>
          {xError && <p className="mt-3 text-xs" style={{ color: 'var(--warning)' }}>{xError}</p>}
        </div>

        <RuntimeStatusCard />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <CapabilityCard title="Networks" subtitle="Recognized by the product registry. Execution is a separate gate.">
          <div className="grid grid-cols-4 gap-3 sm:grid-cols-7">
            {PRODUCT_NETWORKS.map((network) => (
              <CapabilityItem key={network.id} logoKey={network.logoKey} name={network.shortName} active={network.executionEnabled} />
            ))}
          </div>
        </CapabilityCard>
        <CapabilityCard title="Assets" subtitle="Registry recognition never implies that signing is enabled.">
          <div className="grid grid-cols-4 gap-3 sm:grid-cols-5">
            {PRODUCT_ASSETS.slice(0, 5).map((asset) => (
              <CapabilityItem key={asset.id} logoKey={asset.logoKey} name={asset.symbol} active={asset.executionEnabled} />
            ))}
          </div>
          {PRODUCT_ASSETS.length > 5 && <p className="mt-3 text-[11px]" style={{ color: 'var(--subtle)' }}>Also recognized: {PRODUCT_ASSETS.slice(5).map((asset) => asset.symbol).join(', ')}.</p>}
        </CapabilityCard>
      </section>

      <section className="rounded-3xl p-5" style={{ background: 'var(--surface-strong)', border: '1px solid var(--border)' }}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-sm font-bold" style={{ color: 'var(--ink)' }}><ShieldCheck className="size-4" style={{ color: 'var(--accent)' }} /> Safety policy</div>
            <p className="mt-1 max-w-2xl text-xs leading-5" style={{ color: 'var(--muted)' }}>Agent conversation cannot override deterministic policy. Every financial action is re-verified before the wallet is allowed to sign.</p>
          </div>
          <span className="rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider" style={{ background: 'var(--success-muted)', color: 'var(--success)' }}>{DEFAULT_VEYRA_POLICY.displayName}</span>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {DEFAULT_VEYRA_POLICY.rules.slice(0, 6).map((rule) => (
            <span key={rule.ruleId} className="rounded-xl px-2.5 py-1.5 font-mono text-[10px]" style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--subtle)' }}>{rule.ruleId}</span>
          ))}
        </div>
        <div className="mt-4 text-[11px]" style={{ color: 'var(--subtle)' }}>Environment: <span className="font-semibold uppercase" style={{ color: VEYRA_ENV === 'mainnet' ? 'var(--danger)' : 'var(--success)' }}>{VEYRA_ENV}</span></div>
      </section>

      <CreateVeyraIdModal open={identityOpen} onClose={() => setIdentityOpen(false)} onCreated={onIdentityCreated} />
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
