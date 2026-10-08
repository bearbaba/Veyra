/**
 * Veyra Pay Page — Send USDC on Arc
 *
 * Manual direct-form path. Collects recipient + amount, then routes through
 * the SAME deterministic pipeline as the Agent path:
 *
 *   TransferAction → Policy → Risk → Simulation → Review → User signature
 *   → Execution → Verification → VeyraReceipt
 *
 * There is NO shortcut writeContract call that bypasses the pipeline.
 */

import { useState } from 'react';
import { useAccount, useSwitchChain } from 'wagmi';
import { ConnectKitButton } from 'connectkit';
import { isAddress } from 'viem';
import { SendHorizontal, AlertTriangle } from 'lucide-react';
import { parseAmount } from '@/onchain-money';
import { getUsdc, requireChain } from '@/onchain-facts';
import { createTransferAction } from '@/core/pipeline/transferPipeline';
import { TransactionReviewSheet } from '../transfer/TransactionReviewSheet';
import type { TransferAction } from '@/core/actions/actionSchema';

const ARC_TESTNET_CHAIN_ID = 5042002;

export function PayPage() {
  const { address, isConnected, chainId } = useAccount();
  const { switchChain } = useSwitchChain();

  const [recipient, setRecipient] = useState('');
  const [amount, setAmount]       = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<TransferAction | null>(null);

  const usdc = getUsdc(ARC_TESTNET_CHAIN_ID);
  const arcChain = requireChain(ARC_TESTNET_CHAIN_ID);
  const isCorrectChain = chainId === ARC_TESTNET_CHAIN_ID;

  const recipientValid = isAddress(recipient);
  const amountNum = parseFloat(amount);
  const amountValid = !isNaN(amountNum) && amountNum > 0;
  const canProceed = isConnected && isCorrectChain && recipientValid && amountValid && !!address && !!usdc;

  function handlePrepare() {
    if (!canProceed || !address || !usdc) return;
    setActionError(null);

    try {
      const amountParsed = parseAmount(ARC_TESTNET_CHAIN_ID, amount);
      const action = createTransferAction({
        from: address,
        to: recipient,
        tokenAddress: usdc.address,
        tokenDecimals: usdc.decimals,
        amount: amountParsed.raw,
        chainId: ARC_TESTNET_CHAIN_ID,
      });
      setPendingAction(action);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to prepare transfer');
    }
  }

  return (
    <div className="max-w-md mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="display text-2xl font-bold" style={{ color: 'var(--ink)', letterSpacing: '-0.02em' }}>
          Send USDC
        </h1>
        <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
          {arcChain.name}
        </p>
      </div>

      {!isConnected ? (
        <div className="rounded-2xl p-6 text-center space-y-4"
          style={{ background: 'var(--surface-strong)', border: '1px solid var(--border)' }}>
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            Connect your wallet to send USDC
          </p>
          <ConnectKitButton />
        </div>
      ) : (
        <div className="space-y-4">
          {/* Chain warning */}
          {!isCorrectChain && (
            <div className="flex items-start gap-2.5 rounded-xl p-3.5"
              style={{ background: 'var(--warning-muted)', border: '1px solid var(--border)' }}>
              <AlertTriangle className="size-4 mt-0.5 shrink-0" style={{ color: 'var(--warning)' }} />
              <div className="flex-1">
                <p className="text-sm font-medium" style={{ color: 'var(--warning)' }}>
                  Wrong network
                </p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
                  Switch to {arcChain.name} to send USDC.
                </p>
                <button
                  onClick={() => switchChain({ chainId: ARC_TESTNET_CHAIN_ID })}
                  className="mt-2 text-xs font-semibold"
                  style={{ color: 'var(--accent)' }}
                >
                  Switch network
                </button>
              </div>
            </div>
          )}

          {/* Form card */}
          <div className="rounded-2xl overflow-hidden"
            style={{ background: 'var(--surface-strong)', border: '1px solid var(--border)' }}>

            {/* Recipient */}
            <div className="p-4 border-b" style={{ borderColor: 'var(--border)' }}>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-2"
                style={{ color: 'var(--muted)' }}>
                Recipient
              </label>
              <input
                value={recipient}
                onChange={(e) => setRecipient(e.target.value.trim())}
                placeholder="0x..."
                className="w-full bg-transparent text-sm outline-none mono"
                style={{
                  color: recipient && !recipientValid ? 'var(--danger)' : 'var(--ink)',
                }}
              />
              {recipient && !recipientValid && (
                <p className="text-xs mt-1.5" style={{ color: 'var(--danger)' }}>
                  Enter a valid EVM address
                </p>
              )}
            </div>

            {/* Amount */}
            <div className="p-4">
              <label className="block text-xs font-semibold uppercase tracking-wider mb-2"
                style={{ color: 'var(--muted)' }}>
                Amount
              </label>
              <div className="flex items-baseline gap-2">
                <input
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => {
                    const v = e.target.value.replace(/[^0-9.]/g, '');
                    if (v === '' || /^\d*\.?\d*$/.test(v)) setAmount(v);
                  }}
                  placeholder="0.00"
                  className="display flex-1 bg-transparent text-3xl font-bold tabular-nums outline-none"
                  style={{ color: 'var(--ink)' }}
                />
                <span className="text-lg font-medium" style={{ color: 'var(--muted)' }}>USDC</span>
              </div>
            </div>
          </div>

          {/* Error */}
          {actionError && (
            <div className="flex items-start gap-2 rounded-xl p-3"
              style={{ background: 'var(--danger-muted)', border: '1px solid var(--border)', color: 'var(--danger)' }}>
              <AlertTriangle className="size-4 mt-0.5 shrink-0" />
              <span className="text-sm">{actionError}</span>
            </div>
          )}

          {/* CTA */}
          <button
            onClick={handlePrepare}
            disabled={!canProceed}
            className="w-full flex items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-semibold transition-all hover:scale-[1.01] active:scale-[0.99] disabled:opacity-40 disabled:cursor-not-allowed disabled:scale-100"
            style={{ background: 'var(--accent)', color: '#0d1b2f' }}
          >
            <SendHorizontal className="size-4" />
            Review Transfer
          </button>

          <p className="text-xs text-center" style={{ color: 'var(--subtle)' }}>
            Policy, risk, and simulation checks run before you sign.
          </p>
        </div>
      )}

      {/* Transaction Review Sheet */}
      {pendingAction && (
        <TransactionReviewSheet
          action={pendingAction}
          onClose={() => setPendingAction(null)}
        />
      )}
    </div>
  );
}
