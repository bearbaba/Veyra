import { useMemo, useState } from 'react';
import { useAccount, useReadContract } from 'wagmi';
import { formatUnits } from 'viem';
import { ConnectKitButton } from 'connectkit';
import {
  Activity,
  ArrowRight,
  AtSign,
  Bot,
  CheckCircle2,
  Copy,
  RefreshCw,
  SendHorizontal,
  ShieldCheck,
  Sparkles,
  Wallet,
} from 'lucide-react';
import { requireChain, getUsdc, buildTxExplorerUrl } from '@/onchain-facts';
import { useReceiptStore } from '@/hooks/useReceiptStore';
import { useVeyraIdentity } from '@/hooks/useVeyraIdentity';
import { beginXLink, type MyProfile } from '@/lib/api/identityApi';
import { PRODUCT_ASSETS, PRODUCT_NETWORKS, REGISTRY_STATUS_COPY, type RegistryStatus } from '@/config/productRegistry';
import { BrandLogo } from '../brand/BrandLogo';
import { CreateVeyraIdModal } from '../identity/CreateVeyraIdModal';
import type { VeyraPage } from '../layout/AppShell';

const ARC_TESTNET_CHAIN_ID = 5042002;
const ERC20_BALANCE_OF_ABI = [{
  name: 'balanceOf',
  type: 'function',
  stateMutability: 'view',
  inputs: [{ name: 'account', type: 'address' }],
  outputs: [{ name: '', type: 'uint256' }],
}] as const;

interface HomePageProps {
  onNavigate: (page: VeyraPage) => void;
}

export function HomePage({ onNavigate }: HomePageProps) {
  const { address, isConnected } = useAccount();
  const identity = useVeyraIdentity();
  const [identityOpen, setIdentityOpen] = useState(false);
  const [xLoading, setXLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const arcChain = requireChain(ARC_TESTNET_CHAIN_ID);
  const usdc = getUsdc(ARC_TESTNET_CHAIN_ID);
  const { receipts } = useReceiptStore();

  const { data: balanceRaw, isLoading: balanceLoading, refetch } = useReadContract({
    address: usdc?.address as `0x${string}` | undefined,
    abi: ERC20_BALANCE_OF_ABI,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: ARC_TESTNET_CHAIN_ID,
    query: { enabled: isConnected && !!address && !!usdc },
  });

  const formattedBalance = balanceRaw != null && usdc
    ? Number(formatUnits(balanceRaw, usdc.decimals)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : null;
  const recentReceipts = receipts.slice(0, 3);
  const profile = identity.profile;
  const displayHandle = profile ? `@${profile.veyraHandle}` : 'Create your Veyra ID';

  async function connectX() {
    setNotice(null);
    if (!profile) {
      setIdentityOpen(true);
      setNotice('Create your Veyra ID first, then link X to it.');
      return;
    }
    if (identity.preview) {
      setNotice('X linking needs a real Veyra session. Start the BFF + Postgres, then create the signed identity.');
      return;
    }
    if (profile.x) return;
    setXLoading(true);
    try {
      const authorizeUrl = await beginXLink('/');
      window.location.assign(authorizeUrl);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Unable to start X linking');
      setXLoading(false);
    }
  }

  function onIdentityCreated(_profile: MyProfile, preview: boolean) {
    void identity.refresh();
    setNotice(preview ? 'Preview identity created locally. It is not reserved in production.' : 'Veyra ID created and wallet verified.');
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-7 md:px-7 md:py-9 space-y-6">
      <section className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
        <div
          className="relative overflow-hidden rounded-[28px] p-6 md:p-8"
          style={{ background: 'linear-gradient(135deg, rgba(29,48,76,0.96), rgba(15,31,52,0.96))', border: '1px solid var(--border-strong)' }}
        >
          <div className="pointer-events-none absolute -right-10 -top-20 size-72 rounded-full opacity-30 blur-3xl" style={{ background: 'radial-gradient(circle, #7c3aed, transparent 68%)' }} />
          <div className="pointer-events-none absolute bottom-[-110px] left-24 size-80 rounded-full opacity-20 blur-3xl" style={{ background: 'radial-gradient(circle, #b9ff66, transparent 65%)' }} />
          <div className="relative">
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.22em]" style={{ color: 'var(--accent)' }}>
              <Sparkles className="size-4" /> Human-first payments
            </div>
            <h1 className="display mt-4 max-w-xl text-4xl font-black leading-[1.02] md:text-5xl" style={{ color: 'var(--ink)', letterSpacing: '-0.045em' }}>
              Pay anyone.<br />Veyra handles the route.
            </h1>
            <p className="mt-4 max-w-xl text-sm leading-6 md:text-base" style={{ color: 'var(--muted)' }}>
              Use a Veyra ID, X handle, wallet, or natural language. Identity, routing, policy, and review stay underneath one simple flow.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <button
                onClick={() => onNavigate('pay')}
                className="flex items-center gap-2 rounded-2xl px-4 py-3 text-sm font-bold transition-transform hover:scale-[1.02]"
                style={{ background: 'linear-gradient(135deg, #c8ff65, #91e9b5)', color: '#0b1b25' }}
              >
                <SendHorizontal className="size-4" /> Pay someone <ArrowRight className="size-4" />
              </button>
              <button
                onClick={() => onNavigate('agent')}
                className="flex items-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold transition-colors hover:bg-white/5"
                style={{ background: 'var(--surface)', border: '1px solid var(--border-strong)', color: 'var(--ink)' }}
              >
                <Bot className="size-4" /> Ask Veyra
              </button>
            </div>
          </div>
        </div>

        <IdentityCard
          profile={profile}
          preview={identity.preview}
          address={address}
          isConnected={isConnected}
          xLoading={xLoading}
          onCreate={() => profile ? onNavigate('settings') : setIdentityOpen(true)}
          onConnectX={() => void connectX()}
        />
      </section>

      {notice && (
        <div className="flex items-center gap-2 rounded-2xl px-4 py-3 text-sm" style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--muted)' }}>
          <ShieldCheck className="size-4 shrink-0" style={{ color: 'var(--accent)' }} />
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} className="ml-auto text-xs" style={{ color: 'var(--subtle)' }}>Dismiss</button>
        </div>
      )}

      <section className="grid gap-4 lg:grid-cols-[1fr_0.72fr]">
        <div className="rounded-3xl p-5 md:p-6" style={{ background: 'var(--surface-strong)', border: '1px solid var(--border)' }}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <BrandLogo logoKey="usdc" size={38} />
              <div>
                <div className="text-xs font-bold uppercase tracking-[0.18em]" style={{ color: 'var(--muted)' }}>USDC Balance</div>
                <div className="mt-0.5 text-xs" style={{ color: 'var(--subtle)' }}>{arcChain.name}</div>
              </div>
            </div>
            {isConnected && (
              <button onClick={() => void refetch()} className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs" style={{ color: 'var(--muted)', border: '1px solid var(--border)' }}>
                <RefreshCw className="size-3.5" /> Refresh
              </button>
            )}
          </div>

          {!isConnected ? (
            <div className="py-8 text-center">
              <p className="mb-4 text-sm" style={{ color: 'var(--muted)' }}>Connect a wallet to load your live Arc balance. No manual network switch is required for reads.</p>
              <ConnectKitButton />
            </div>
          ) : (
            <div className="mt-6 flex items-end justify-between gap-4">
              <div>
                {balanceLoading ? (
                  <div className="h-12 w-44 animate-pulse rounded-xl" style={{ background: 'var(--surface)' }} />
                ) : (
                  <div className="flex items-baseline gap-2">
                    <span className="display text-4xl font-black tabular-nums md:text-5xl" style={{ color: 'var(--ink)', letterSpacing: '-0.04em' }}>{formattedBalance ?? '—'}</span>
                    <span className="text-base font-bold" style={{ color: 'var(--muted)' }}>USDC</span>
                  </div>
                )}
                <p className="mono mt-2 text-xs" style={{ color: 'var(--subtle)' }}>{shortAddress(address)}</p>
              </div>
              <StatusPill status="ACTIVE" />
            </div>
          )}
        </div>

        <div className="rounded-3xl p-5 md:p-6" style={{ background: 'linear-gradient(145deg, rgba(37,33,72,0.88), rgba(19,34,54,0.98))', border: '1px solid var(--border)' }}>
          <div className="flex items-center gap-3">
            <BrandLogo logoKey="arc" size={50} />
            <div className="min-w-0">
              <div className="text-xs font-bold uppercase tracking-[0.18em]" style={{ color: 'var(--muted)' }}>Home network</div>
              <div className="mt-1 text-lg font-bold" style={{ color: 'var(--ink)' }}>{arcChain.name}</div>
            </div>
            <span className="ml-auto"><StatusPill status="ACTIVE" /></span>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3 text-xs">
            <InfoTile label="Wallet" value={address ? shortAddress(address) : 'Not connected'} />
            <InfoTile label="Veyra ID" value={profile ? displayHandle : 'Not created'} />
          </div>
        </div>
      </section>

      <section>
        <SectionHeading title="Quick actions" subtitle="Two primary paths. Everything else stays underneath the routing engine." />
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <QuickAction label="Pay" description="Pay a person, not a chain." icon={<SendHorizontal className="size-5" />} onClick={() => onNavigate('pay')} primary />
          <QuickAction label="Agent" description="Chat and plan in any language." icon={<Bot className="size-5" />} onClick={() => onNavigate('agent')} />
          <QuickAction label="Activity" description="Receipts and transaction history." icon={<Activity className="size-5" />} onClick={() => onNavigate('activity')} />
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <RegistryCard title="Networks" subtitle="Verified registry metadata. Execution remains separately gated.">
          <div className="grid grid-cols-4 gap-3 sm:grid-cols-7">
            {PRODUCT_NETWORKS.map((network) => (
              <RegistryItem key={network.id} logoKey={network.logoKey} name={network.shortName} status={network.status} active={network.executionEnabled} />
            ))}
          </div>
        </RegistryCard>
        <RegistryCard title="Assets" subtitle={`${PRODUCT_ASSETS.length} recognized assets. Only execution-enabled assets can be signed.`}>
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
            {PRODUCT_ASSETS.slice(0, 5).map((asset) => (
              <RegistryItem key={asset.id} logoKey={asset.logoKey} name={asset.symbol} status={asset.status} active={asset.executionEnabled} />
            ))}
          </div>
          <div className="mt-3 text-xs" style={{ color: 'var(--subtle)' }}>
            Registry also recognizes {PRODUCT_ASSETS.slice(5).map((asset) => asset.symbol).join(', ')}. New verified tokens can be added without redesigning Pay or Agent.
          </div>
        </RegistryCard>
      </section>

      {recentReceipts.length > 0 && (
        <section>
          <div className="flex items-end justify-between gap-3">
            <SectionHeading title="Recent activity" subtitle="Server-verifiable execution receipts stay separate from Agent conversation." />
            <button onClick={() => onNavigate('activity')} className="mb-1 text-xs font-semibold" style={{ color: 'var(--accent)' }}>View all</button>
          </div>
          <div className="mt-3 space-y-2">
            {recentReceipts.map((receipt) => <ReceiptRow key={receipt.receiptId} receipt={receipt} />)}
          </div>
        </section>
      )}

      <CreateVeyraIdModal open={identityOpen} onClose={() => setIdentityOpen(false)} onCreated={onIdentityCreated} />
    </div>
  );
}

function IdentityCard({
  profile,
  preview,
  address,
  isConnected,
  xLoading,
  onCreate,
  onConnectX,
}: {
  profile: MyProfile | null;
  preview: boolean;
  address?: `0x${string}`;
  isConnected: boolean;
  xLoading: boolean;
  onCreate: () => void;
  onConnectX: () => void;
}) {
  return (
    <div className="rounded-[28px] p-5 md:p-6" style={{ background: 'var(--surface-strong)', border: '1px solid var(--border-strong)' }}>
      <div className="flex items-start gap-3">
        <div className="flex size-12 items-center justify-center rounded-2xl" style={{ background: 'linear-gradient(135deg,#7c3aed,#ec4899)' }}>
          <AtSign className="size-5 text-white" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-bold uppercase tracking-[0.18em]" style={{ color: 'var(--muted)' }}>Your identity</div>
          <div className="mt-1 truncate text-xl font-bold" style={{ color: 'var(--ink)' }}>{profile ? `@${profile.veyraHandle}` : 'No Veyra ID yet'}</div>
          <p className="mt-1 text-xs" style={{ color: 'var(--subtle)' }}>{preview ? 'Local preview identity' : 'Canonical identity for verified endpoints'}</p>
        </div>
      </div>

      <div className="mt-5 space-y-2.5">
        <IdentityRow label="Wallet" value={isConnected && address ? shortAddress(address) : 'Not connected'} ok={isConnected} icon={<Wallet className="size-3.5" />} />
        <IdentityRow label="Veyra ID" value={profile ? `@${profile.veyraHandle}` : 'Not created'} ok={Boolean(profile)} icon={<ShieldCheck className="size-3.5" />} />
        <IdentityRow label="X" value={profile?.x?.xHandle ? `@${profile.x.xHandle}` : 'Not linked'} ok={Boolean(profile?.x)} icon={<span className="text-[11px] font-black">X</span>} />
      </div>

      <div className="mt-5 grid grid-cols-2 gap-2">
        <button onClick={onCreate} className="rounded-xl px-3 py-2.5 text-xs font-bold" style={{ background: 'var(--accent-muted)', color: 'var(--accent)', border: '1px solid var(--border-strong)' }}>
          {profile ? 'View Veyra ID' : 'Create Veyra ID'}
        </button>
        <button onClick={onConnectX} disabled={Boolean(profile?.x) || xLoading} className="rounded-xl px-3 py-2.5 text-xs font-bold disabled:opacity-55" style={{ background: 'var(--surface)', color: 'var(--ink)', border: '1px solid var(--border)' }}>
          {profile?.x ? 'X linked' : xLoading ? 'Connecting…' : 'Connect X'}
        </button>
      </div>
    </div>
  );
}

function IdentityRow({ label, value, ok, icon }: { label: string; value: string; ok: boolean; icon: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl px-3 py-2.5" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
      <span className="flex size-6 items-center justify-center rounded-lg" style={{ background: ok ? 'var(--success-muted)' : 'rgba(255,255,255,0.04)', color: ok ? 'var(--success)' : 'var(--subtle)' }}>{icon}</span>
      <span className="text-xs" style={{ color: 'var(--muted)' }}>{label}</span>
      <span className="ml-auto truncate text-xs font-semibold" style={{ color: ok ? 'var(--ink)' : 'var(--subtle)' }}>{value}</span>
      {ok && <CheckCircle2 className="size-3.5 shrink-0" style={{ color: 'var(--success)' }} />}
    </div>
  );
}

function QuickAction({ label, description, icon, onClick, primary = false }: { label: string; description: string; icon: React.ReactNode; onClick: () => void; primary?: boolean }) {
  return (
    <button onClick={onClick} className="group rounded-2xl p-4 text-left transition-all hover:-translate-y-0.5" style={{ background: primary ? 'linear-gradient(135deg,rgba(200,255,101,0.13),rgba(99,220,181,0.08))' : 'var(--surface-strong)', border: `1px solid ${primary ? 'rgba(200,255,101,0.26)' : 'var(--border)'}` }}>
      <div className="flex items-center justify-between">
        <span className="flex size-9 items-center justify-center rounded-xl" style={{ background: primary ? 'rgba(200,255,101,0.14)' : 'var(--accent-muted)', color: primary ? '#c8ff65' : 'var(--accent)' }}>{icon}</span>
        <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" style={{ color: 'var(--subtle)' }} />
      </div>
      <div className="mt-4 text-sm font-bold" style={{ color: 'var(--ink)' }}>{label}</div>
      <div className="mt-1 text-xs leading-5" style={{ color: 'var(--subtle)' }}>{description}</div>
    </button>
  );
}

function RegistryCard({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="rounded-3xl p-5" style={{ background: 'var(--surface-strong)', border: '1px solid var(--border)' }}>
      <SectionHeading title={title} subtitle={subtitle} />
      <div className="mt-4">{children}</div>
    </div>
  );
}

function RegistryItem({ logoKey, name, status, active }: { logoKey: string; name: string; status: RegistryStatus; active: boolean }) {
  return (
    <div className="min-w-0 text-center">
      <div className="relative mx-auto w-fit">
        <BrandLogo logoKey={logoKey} size={38} />
        {active && <span className="absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2" style={{ background: 'var(--success)', borderColor: '#13243a' }} />}
      </div>
      <div className="mt-2 truncate text-[11px] font-semibold" style={{ color: 'var(--ink-2)' }}>{name}</div>
      <div className="mt-0.5 truncate text-[9px]" style={{ color: active ? 'var(--success)' : 'var(--subtle)' }}>{active ? 'Active' : REGISTRY_STATUS_COPY[status]}</div>
    </div>
  );
}

function StatusPill({ status }: { status: RegistryStatus }) {
  const active = status === 'ACTIVE';
  return <span className="rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-wider" style={{ background: active ? 'var(--success-muted)' : 'var(--surface)', color: active ? 'var(--success)' : 'var(--muted)', border: '1px solid var(--border)' }}>{REGISTRY_STATUS_COPY[status]}</span>;
}

function SectionHeading({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div>
      <h2 className="text-sm font-bold" style={{ color: 'var(--ink)' }}>{title}</h2>
      <p className="mt-0.5 text-xs leading-5" style={{ color: 'var(--subtle)' }}>{subtitle}</p>
    </div>
  );
}

function InfoTile({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl p-3" style={{ background: 'rgba(255,255,255,0.035)', border: '1px solid var(--border)' }}><div className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--subtle)' }}>{label}</div><div className="mt-1 truncate text-xs font-semibold" style={{ color: 'var(--ink-2)' }}>{value}</div></div>;
}

function shortAddress(address?: string): string {
  if (!address) return '—';
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function ReceiptRow({ receipt }: { receipt: import('@/core/receipt/receiptTypes').VeyraReceipt }) {
  const txUrl = receipt.executionTxHash && receipt.chainId ? buildTxExplorerUrl(receipt.chainId, receipt.executionTxHash) : null;
  const statusColor = receipt.status === 'VERIFIED' ? 'var(--success)' : receipt.status === 'FAILED' ? 'var(--danger)' : 'var(--warning)';
  return (
    <div className="flex items-center gap-3 rounded-2xl px-4 py-3" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>{receipt.actionType}</span>
          <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: `${statusColor}20`, color: statusColor }}>{receipt.status}</span>
        </div>
        <p className="mt-0.5 truncate text-xs" style={{ color: 'var(--subtle)' }}>{new Date(receipt.createdAt).toLocaleString()}</p>
      </div>
      {txUrl && <a href={txUrl} target="_blank" rel="noreferrer" className="text-xs font-semibold" style={{ color: 'var(--accent)' }}>View</a>}
    </div>
  );
}
