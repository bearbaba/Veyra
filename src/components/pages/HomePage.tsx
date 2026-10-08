/**
 * Veyra Home — Portfolio Overview
 *
 * Shows live onchain balance (ERC-20 USDC view), recent activity summary,
 * and quick action buttons. All values come from chain reads — never fabricated.
 */

import { useAccount, useReadContract } from 'wagmi';
import { formatUnits } from 'viem';
import { ConnectKitButton } from 'connectkit';
import { TrendingUp, SendHorizontal, ArrowLeftRight, ArrowDown, RefreshCw } from 'lucide-react';
import { requireChain, getUsdc, buildTxExplorerUrl } from '@/onchain-facts';
import { useReceiptStore } from '@/hooks/useReceiptStore';
import type { VeyraPage } from '../layout/AppShell';

// Arc Testnet chain ID
const ARC_TESTNET_CHAIN_ID = 5042002;

const ERC20_BALANCE_OF_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

interface HomePageProps {
  onNavigate: (page: VeyraPage) => void;
}

export function HomePage({ onNavigate }: HomePageProps) {
  const { address, isConnected, chainId } = useAccount();
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

  const isCorrectChain = chainId === ARC_TESTNET_CHAIN_ID;
  const recentReceipts = receipts.slice(0, 3);

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="display text-2xl font-bold" style={{ color: 'var(--ink)', letterSpacing: '-0.02em' }}>
            Portfolio
          </h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--muted)' }}>
            {arcChain.name}
          </p>
        </div>
        <ConnectKitButton />
      </div>

      {/* Balance card */}
      <section
        className="rounded-2xl p-5"
        style={{
          background: 'var(--surface-strong)',
          border: '1px solid var(--border)',
          backdropFilter: 'blur(20px)',
        }}
      >
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1.5">
            <div className="flex size-6 items-center justify-center rounded-lg"
              style={{ background: 'var(--success-muted)' }}>
              <TrendingUp className="size-3.5" style={{ color: 'var(--success)' }} />
            </div>
            <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--muted)' }}>
              USDC Balance
            </span>
          </div>
          {isConnected && (
            <button
              onClick={() => void refetch()}
              className="flex items-center gap-1 text-xs transition-opacity hover:opacity-70"
              style={{ color: 'var(--subtle)' }}
            >
              <RefreshCw className="size-3" />
              Refresh
            </button>
          )}
        </div>

        {!isConnected ? (
          <div className="py-4 text-center">
            <p className="text-sm mb-3" style={{ color: 'var(--muted)' }}>
              Connect your wallet to view your balance
            </p>
            <ConnectKitButton />
          </div>
        ) : !isCorrectChain ? (
          <div className="py-3">
            <p className="text-sm" style={{ color: 'var(--warning)' }}>
              Switch to {arcChain.name} to view your USDC balance.
            </p>
          </div>
        ) : (
          <>
            <div className="flex items-baseline gap-1.5">
              {balanceLoading ? (
                <div className="h-10 w-32 rounded-lg animate-pulse" style={{ background: 'var(--surface)' }} />
              ) : (
                <>
                  <span className="display text-4xl font-bold tabular-nums" style={{ color: 'var(--ink)' }}>
                    {formattedBalance ?? '—'}
                  </span>
                  <span className="text-lg font-medium" style={{ color: 'var(--muted)' }}>USDC</span>
                </>
              )}
            </div>
            <p className="mt-1.5 text-xs mono" style={{ color: 'var(--subtle)' }}>
              {address?.slice(0, 6)}...{address?.slice(-4)} · {arcChain.name}
            </p>
          </>
        )}
      </section>

      {/* Quick actions */}
      <div className="grid grid-cols-2 gap-3">
        <QuickAction
          label="Send"
          description="Pay anyone on Arc"
          icon={<SendHorizontal className="size-5" />}
          onClick={() => onNavigate('pay')}
          available
        />
        <QuickAction
          label="Convert"
          description="Provider not yet verified"
          icon={<ArrowLeftRight className="size-5" />}
          onClick={() => onNavigate('convert')}
          available={false}
        />
        <QuickAction
          label="Receive"
          description="Your address"
          icon={<ArrowDown className="size-5" />}
          onClick={() => {}} // inline address display — wired in Settings
          available
          secondary
        />
      </div>

      {/* Recent receipts */}
      {recentReceipts.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold uppercase tracking-wider" style={{ color: 'var(--muted)' }}>
              Recent
            </h2>
            <button
              className="text-xs font-medium"
              style={{ color: 'var(--accent)' }}
              onClick={() => onNavigate('activity')}
            >
              View all
            </button>
          </div>
          <div className="space-y-2">
            {recentReceipts.map((r) => (
              <ReceiptRow key={r.receiptId} receipt={r} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function QuickAction({
  label, description, icon, onClick, available, secondary,
}: {
  label: string;
  description: string;
  icon: React.ReactNode;
  onClick: () => void;
  available: boolean;
  secondary?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={!available}
      className="flex flex-col gap-2 rounded-2xl p-4 text-left transition-all hover:scale-[1.01] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
      style={{
        background: secondary ? 'var(--surface)' : 'var(--surface-strong)',
        border: '1px solid var(--border)',
      }}
    >
      <span style={{ color: available ? 'var(--accent)' : 'var(--subtle)' }}>{icon}</span>
      <div>
        <div className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>{label}</div>
        <div className="text-xs mt-0.5" style={{ color: 'var(--subtle)' }}>{description}</div>
      </div>
      {!available && (
        <span className="text-xs px-1.5 py-0.5 rounded-full self-start"
          style={{ background: 'var(--warning-muted)', color: 'var(--warning)' }}>
          Coming soon
        </span>
      )}
    </button>
  );
}

function ReceiptRow({ receipt }: { receipt: import('@/core/receipt/receiptTypes').VeyraReceipt }) {
  const txUrl = receipt.executionTxHash && receipt.chainId
    ? buildTxExplorerUrl(receipt.chainId, receipt.executionTxHash)
    : null;

  const statusColor =
    receipt.status === 'VERIFIED' ? 'var(--success)' :
    receipt.status === 'FAILED'   ? 'var(--danger)'  :
    'var(--warning)';

  return (
    <div
      className="flex items-center gap-3 rounded-xl px-3.5 py-3"
      style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium" style={{ color: 'var(--ink)' }}>
            {receipt.actionType}
          </span>
          <span className="text-xs px-1.5 py-0.5 rounded-full"
            style={{ background: `${statusColor}20`, color: statusColor }}>
            {receipt.status}
          </span>
        </div>
        <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--subtle)' }}>
          {new Date(receipt.createdAt).toLocaleString()}
        </p>
      </div>
      {txUrl && (
        <a
          href={txUrl}
          target="_blank"
          rel="noreferrer"
          className="text-xs shrink-0"
          style={{ color: 'var(--accent)' }}
          onClick={(e) => e.stopPropagation()}
        >
          View
        </a>
      )}
    </div>
  );
}
