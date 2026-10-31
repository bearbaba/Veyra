import { useAccount, useReadContract } from 'wagmi';
import { useState } from 'react';
import { ConnectKitButton } from 'connectkit';
import {
  ArrowRight,
  AtSign,
  Bot,
  CheckCircle2,
  ShieldCheck,
  Copy,
  RefreshCw,
  SendHorizontal,
  Wallet,
} from 'lucide-react';
import { getUsdc, buildTxExplorerUrl } from '@/onchain-facts';
import { useReceiptStore } from '@/hooks/useReceiptStore';
import { useVeyraIdentity } from '@/hooks/useVeyraIdentity';
import { formatArcUsdcBalance } from '@/features/balance/arcUsdcBalance';
import { VEYRA_ENV } from '@/lib/env';
import { useChainId } from 'wagmi';
import type { MyProfile } from '@/lib/api/identityApi';
import { PRODUCT_ASSETS, PRODUCT_NETWORKS, REGISTRY_STATUS_COPY, type RegistryStatus } from '@/config/productRegistry';
import { BrandLogo } from '../brand/BrandLogo';
import type { VeyraPage } from '../layout/AppShell';

const ARC_TESTNET_CHAIN_ID = 5042002;
const ARC_MAINNET_CHAIN_ID = 5042;
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
  const connectedChainId = useChainId();
  const identity = useVeyraIdentity();
  // Balance reads on testnet are pinned to Arc Testnet; on mainnet env they switch.
  // On Arc, USDC ERC-20 and native share the same address but different decimal views.
  // We always read ERC-20 balanceOf (6 decimals) for display.
  const isMainnet = VEYRA_ENV === 'mainnet' || connectedChainId === ARC_MAINNET_CHAIN_ID;
  const usdc = getUsdc(ARC_TESTNET_CHAIN_ID);
  const usdcMainnet = getUsdc(ARC_MAINNET_CHAIN_ID);
  const { receipts, error: receiptError } = useReceiptStore();

  // Testnet balance — primary path (always reads Arc Testnet USDC).
  const balanceReadsEnabled = VEYRA_ENV !== 'mainnet' && isConnected && Boolean(address) && Boolean(usdc);
  const { data: balanceRaw, isLoading: _testnetLoading, isFetching: _testnetFetching,
    isError: balanceError, dataUpdatedAt: _testnetUpdatedAt, refetch } = useReadContract({
    address: usdc?.address as `0x${string}` | undefined,
    abi: ERC20_BALANCE_OF_ABI,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: ARC_TESTNET_CHAIN_ID,
    query: {
      enabled: balanceReadsEnabled,
      staleTime: 15_000,
      refetchInterval: 30_000,
      refetchIntervalInBackground: false,
      refetchOnWindowFocus: true,
      retry: 1,
    },
  });

  // Mainnet balance — secondary path (reads Arc Mainnet USDC when on mainnet).
  const mainnetBalanceEnabled = isMainnet && isConnected && Boolean(address) && Boolean(usdcMainnet);
  const { data: mainnetBalanceRaw, isLoading: _mainnetLoading, isFetching: _mainnetFetching,
    isError: _mainnetError, dataUpdatedAt: _mainnetUpdatedAt, refetch: refetchMainnet } = useReadContract({
    address: usdcMainnet?.address as `0x${string}` | undefined,
    abi: ERC20_BALANCE_OF_ABI,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: ARC_MAINNET_CHAIN_ID,
    query: {
      enabled: mainnetBalanceEnabled,
      staleTime: 15_000,
      refetchInterval: 30_000,
      refetchIntervalInBackground: false,
      refetchOnWindowFocus: true,
      retry: 1,
    },
  });

  // A failed RPC read, disconnected wallet or inactive environment must never
  // masquerade as a zero balance. Preserve the full six USDC decimals.
  // Expose these as the canonical UI names so JSX and test assertions both resolve.
  const balanceFetching = isMainnet ? _mainnetFetching : _testnetFetching;
  const balanceLoading = isMainnet ? _mainnetLoading : _testnetLoading;
  const balanceUpdatedAt = isMainnet ? _mainnetUpdatedAt : _testnetUpdatedAt;
  const activeBalanceRaw = isMainnet ? mainnetBalanceRaw : balanceRaw;
  const activeBalanceError = isMainnet ? _mainnetError : balanceError;
  const activeBalanceEnabled = isMainnet ? mainnetBalanceEnabled : balanceReadsEnabled;
  const handleRefetch = isMainnet ? () => void refetchMainnet() : () => void refetch();
  const formattedBalance = activeBalanceEnabled && !activeBalanceError && activeBalanceRaw != null
    ? formatArcUsdcBalance(activeBalanceRaw)
    : null;
  const balanceNetworkLabel = isMainnet ? 'Arc Mainnet · On-chain' : 'Arc Testnet · On-chain';
  const envLabel = isMainnet ? 'Veyra · Mainnet' : 'Veyra · Testnet';
  const recentReceipts = receipts.slice(0, 3);
  const profile = identity.profile;
  const [copiedReceive, setCopiedReceive] = useState(false);
  const [receiveCopyError, setReceiveCopyError] = useState(false);


  return (
    <div className="mx-auto max-w-6xl px-4 py-7 md:px-7 md:py-9 space-y-6">
      <section className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="rounded-3xl p-5 md:p-7" style={{ background:'var(--surface-strong)', border:'1px solid var(--border-strong)' }}>
          <p className="text-xs font-semibold uppercase tracking-wider" style={{color:'var(--accent)'}}>{envLabel}</p>
          <h1 className="display mt-3 max-w-lg text-3xl font-black leading-tight md:text-4xl" style={{color:'var(--ink)',letterSpacing:'-0.035em'}}>
            Send USDC, simply.
          </h1>
          <p className="mt-3 max-w-lg text-sm leading-6" style={{color:'var(--muted)'}}>
            Pay a friend, Veyra ID or wallet. Check every detail before signing.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <button type="button" onClick={() => onNavigate('pay')}
              className="flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-bold focus-visible:outline focus-visible:outline-2"
              style={{background:'var(--accent)',color:'#0d1b2f'}}>
              <SendHorizontal className="size-4"/> Send USDC <ArrowRight className="size-4"/>
            </button>
            <button type="button" onClick={() => onNavigate('agent')}
              className="flex items-center gap-2 rounded-xl border px-4 py-3 text-sm font-semibold"
              style={{borderColor:'var(--border-strong)',color:'var(--ink)'}}>
              <Bot className="size-4"/> Explore Veyra
            </button>
          </div>
        </div>
        <IdentityCard
          profile={profile}
          address={address}
          isConnected={isConnected}
          onOpenSocial={() => onNavigate('social')}
          onOpenSettings={() => onNavigate('settings')}
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-[1fr_0.72fr]">
        <div className="rounded-3xl p-5 md:p-6" style={{background:'var(--surface-strong)',border:'1px solid var(--border)'}}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <BrandLogo logoKey="usdc" size={36}/>
              <div>
                <h2 className="text-sm font-bold" style={{color:'var(--ink)'}}>USDC balance</h2>
                <p className="mt-0.5 text-xs" style={{color:'var(--muted)'}}>{balanceNetworkLabel}</p>
              </div>
            </div>
            {activeBalanceEnabled && (
              <button type="button" onClick={handleRefetch} disabled={balanceFetching}
                className="flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs disabled:opacity-50"
                aria-label={`Refresh ${balanceNetworkLabel} USDC balance`}
                style={{color:'var(--muted)',borderColor:'var(--border)'}}>
                <RefreshCw className={`size-3.5 ${balanceFetching?'animate-spin':''}`}/>
                {balanceFetching?'Syncing':'Refresh'}
              </button>
            )}
          </div>
          {!isConnected ? (
            <p className="mt-6 text-sm leading-6" style={{color:'var(--muted)'}}>
              Connect your wallet to view your Arc Testnet USDC balance.
            </p>
          ) : activeBalanceError || (!balanceLoading && !balanceFetching && formattedBalance===null) ? (
            <p role="alert" className="mt-6 text-sm" style={{color:'var(--warning)'}}>
              Balance unavailable. Your funds have not been assumed to be zero. Try Refresh.
            </p>
          ) : balanceLoading || formattedBalance===null ? (
            <div role="status" aria-label="Loading on-chain balance" className="mt-6 h-12 w-44 animate-pulse rounded-xl" style={{background:'var(--surface)' }}/>
          ) : (
            <div className="mt-6">
              <div className="flex flex-wrap items-baseline gap-2" aria-live="polite">
                <span className="display break-all text-4xl font-black tabular-nums" style={{color:'var(--ink)'}}>{formattedBalance}</span>
                <span className="text-base font-semibold" style={{color:'var(--muted)'}}>USDC</span>
              </div>
              {balanceUpdatedAt>0 && <p className="mt-2 text-xs" style={{color:'var(--muted)'}}>
                Last read {new Date(balanceUpdatedAt).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'})}
              </p>}
            </div>
          )}
        </div>
        <div className="rounded-3xl p-5 md:p-6" style={{background:'var(--surface-strong)',border:'1px solid var(--border)'}}>
          <div className="flex items-center gap-3">
            <Wallet className="size-5" style={{color:'var(--accent)'}}/>
            <div>
              <h2 className="text-sm font-bold" style={{color:'var(--ink)'}}>Receive USDC</h2>
              <p className="mt-0.5 text-xs" style={{color:'var(--muted)'}}>Arc Testnet · Your wallet address</p>
            </div>
          </div>
          {isConnected && address ? (
            <>
              <p className="mono mt-5 break-all rounded-xl p-3 text-xs leading-5" style={{background:'var(--surface)',color:'var(--ink-2)'}}>{address}</p>
              <button type="button" onClick={() => {
                void navigator.clipboard.writeText(address).then(()=>{
                  setCopiedReceive(true);setReceiveCopyError(false);
                }).catch(()=>setReceiveCopyError(true));
              }} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-semibold"
                style={{borderColor:'var(--border-strong)',color:'var(--ink)'}}>
                <Copy className="size-4"/>{copiedReceive?'Address copied':'Copy receiving address'}
              </button>
              {receiveCopyError && <p role="alert" className="mt-2 text-xs" style={{color:'var(--warning)'}}>
                Clipboard unavailable. Select and copy the address above.
              </p>}
              <p className="mt-3 text-xs leading-5" style={{color:'var(--muted)'}}>
                Only send supported Arc Testnet assets. Do not send from another network without a verified bridge.
              </p>
            </>
          ) : (
            <div className="mt-5 space-y-3">
              <p className="text-sm" style={{color:'var(--muted)'}}>Connect a wallet to see your receiving address.</p>
              <ConnectKitButton/>
            </div>
          )}
        </div>
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

      {recentReceipts.length===0 && !receiptError && isConnected && (
        <div className="flex items-center justify-between gap-3 rounded-2xl border p-4"
          style={{borderColor:'var(--border)',background:'var(--surface)'}}>
          <p className="text-sm" style={{color:'var(--muted)'}}>No recent payments yet.</p>
          <button type="button" onClick={() => onNavigate('activity')} className="shrink-0 text-sm font-semibold"
            style={{color:'var(--accent)'}}>View activity</button>
        </div>
      )}

      <details className="rounded-2xl border p-4" style={{borderColor:'var(--border)'}}>
        <summary className="cursor-pointer text-sm font-semibold" style={{color:'var(--muted)'}}>
          Network and asset details
        </summary>
        <p className="mt-2 text-xs leading-5" style={{color:'var(--muted)'}}>
          Listing an asset here does not mean payments are enabled. Direct Pay currently supports Arc Testnet USDC.
        </p>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <RegistryCard title="Networks" subtitle="Reference information · Not a list of enabled payment routes">
            <div className="grid grid-cols-4 gap-3 sm:grid-cols-7">
              {PRODUCT_NETWORKS.map(network=><RegistryItem key={network.id}
                logoKey={network.logoKey} name={network.shortName} status={network.status} active={network.executionEnabled}/>)}
            </div>
          </RegistryCard>
          <RegistryCard title="Assets" subtitle="Reference information · Only supported routes can be signed">
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
              {PRODUCT_ASSETS.slice(0,5).map(asset=><RegistryItem key={asset.id}
                logoKey={asset.logoKey} name={asset.symbol} status={asset.status} active={asset.executionEnabled}/>)}
            </div>
          </RegistryCard>
        </div>
      </details>

      {receiptError && <p role="alert" className="text-xs rounded-xl border p-3"
        style={{ color: 'var(--warning)', background: 'var(--surface)', borderColor: 'var(--border)' }}>
        Recent transaction history could not be updated. This does not mean your wallet has no transactions.
      </p>}
    </div>
  );
}

function IdentityCard({
  profile,
  address,
  isConnected,
  onOpenSocial,
  onOpenSettings,
}: {
  profile: MyProfile | null;
  address?: `0x${string}`;
  isConnected: boolean;
  onOpenSocial: () => void;
  onOpenSettings: () => void;
}) {
  const [copiedId,setCopiedId]=useState(false);
  const [copiedWallet,setCopiedWallet]=useState(false);
  return (
    <div className="rounded-[28px] p-5 md:p-6" style={{ background: 'var(--surface-strong)', border: '1px solid var(--border-strong)' }}>
      <div className="flex items-start gap-3">
        <div className="flex size-12 items-center justify-center rounded-2xl" style={{ background: 'linear-gradient(135deg,#7c3aed,#ec4899)' }}>
          <AtSign className="size-5 text-white" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-bold uppercase tracking-[0.18em]" style={{ color: 'var(--muted)' }}>Your identity</div>
          <div className="mt-1 truncate text-xl font-bold" style={{ color: 'var(--ink)' }}>{profile ? `@${profile.veyraHandle}.veyra` : 'Sign in to your Veyra ID'}</div>
          {address && <button type="button" aria-label="Copy wallet address"
            onClick={() => void navigator.clipboard.writeText(address).then(()=>setCopiedWallet(true)).catch(()=>setCopiedWallet(false))}
            className="mt-2 mr-3 inline-flex items-center gap-1.5 text-xs font-semibold" style={{color:'var(--accent)'}}>
            <Copy className="size-3.5"/>{copiedWallet?'Wallet copied':'Copy wallet'}
          </button>}
          {profile&&<button type="button" aria-label="Copy Veyra ID"
            onClick={()=>void navigator.clipboard.writeText('@'+profile.veyraHandle+'.veyra').then(()=>setCopiedId(true)).catch(()=>setCopiedId(false))}
            className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold" style={{color:'var(--accent)'}}>
            <Copy className="size-3.5"/>{copiedId?'ID copied':'Copy Veyra ID'}
          </button>}
          <p className="mt-1 text-xs" style={{ color: 'var(--subtle)' }}>{profile ? 'One verified identity for the connected wallet' : 'Connect your wallet and sign in to use Veyra ID'}</p>
        </div>
      </div>

      <div className="mt-5 space-y-2.5">
        <IdentityRow label="Wallet" value={isConnected && address ? shortAddress(address) : 'Not connected'} ok={isConnected} icon={<Wallet className="size-3.5" />} />
        <IdentityRow label="Veyra ID" value={profile ? `@${profile.veyraHandle}.veyra` : 'Not signed in'} ok={Boolean(profile)} icon={<ShieldCheck className="size-3.5" />} />
        <IdentityRow label="X" value={profile?.x?.xHandle ? `@${profile.x.xHandle}` : 'Not linked'} ok={Boolean(profile?.x)} icon={<span className="text-[11px] font-black">X</span>} />
      </div>

      <div className="mt-5 grid grid-cols-2 gap-2">
        <button type="button" onClick={onOpenSocial} className="rounded-xl px-3 py-2.5 text-xs font-bold" style={{ background: 'var(--accent-muted)', color: 'var(--accent)', border: '1px solid var(--border-strong)' }}>
          {profile ? 'Open Social' : 'Continue with Veyra ID'}
        </button>
        <button type="button" onClick={onOpenSettings} className="rounded-xl px-3 py-2.5 text-xs font-bold" style={{ background: 'var(--surface)', color: 'var(--ink)', border: '1px solid var(--border)' }}>
          Manage linked accounts
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

function SectionHeading({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div>
      <h2 className="text-sm font-bold" style={{ color: 'var(--ink)' }}>{title}</h2>
      <p className="mt-0.5 text-xs leading-5" style={{ color: 'var(--subtle)' }}>{subtitle}</p>
    </div>
  );
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
