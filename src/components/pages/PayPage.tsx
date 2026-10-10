/**
 * Veyra Pay — human-first payment entry point.
 *
 * The UI talks about paying a person. The current executable preview route is
 * deliberately narrow: Arc Testnet USDC. Identity resolution and deterministic
 * policy/risk/simulation still run before the user can sign.
 */

import { useEffect, useState } from 'react';
import { useAccount } from 'wagmi';
import { ConnectKitButton } from 'connectkit';
import { isAddress } from 'viem';
import { AlertTriangle, ArrowRight, CheckCircle2, SendHorizontal, ShieldCheck, Sparkles } from 'lucide-react';
import { parseAmount } from '@/onchain-money';
import { getUsdc, requireChain } from '@/onchain-facts';
import { createTransferAction } from '@/core/pipeline/transferPipeline';
import { TransactionReviewSheet } from '../transfer/TransactionReviewSheet';
import { BrandLogo } from '../brand/BrandLogo';
import type { TransferAction } from '@/core/actions/actionSchema';
import { preparePaymentRecipient, type PreparedRecipient } from '@/lib/api/identityApi';
import type { IntentCandidate } from '@/core/intent/intentSchema';

const ARC_TESTNET_CHAIN_ID = 5042002;

export function PayPage() {
  const { address, isConnected } = useAccount();

  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<TransferAction | null>(null);
  const [preparedRecipient, setPreparedRecipient] = useState<PreparedRecipient | null>(null);
  const [resolving, setResolving] = useState(false);

  const usdc = getUsdc(ARC_TESTNET_CHAIN_ID);
  const arcChain = requireChain(ARC_TESTNET_CHAIN_ID);

  const recipientValid = recipient.trim().length > 0 && recipient.trim().length <= 128;
  const amountNum = Number.parseFloat(amount);
  const amountValid = Number.isFinite(amountNum) && amountNum > 0;
  const canProceed = isConnected && recipientValid && amountValid && Boolean(address) && Boolean(usdc) && !resolving;

  useEffect(() => {
    const raw = sessionStorage.getItem('veyra:agent-intent');
    if (!raw) return;
    sessionStorage.removeItem('veyra:agent-intent');
    try {
      const candidate = JSON.parse(raw) as IntentCandidate;
      if (candidate.actionType !== 'TRANSFER') return;
      if (candidate.recipientRaw?.raw) setRecipient(candidate.recipientRaw.raw);
      if (candidate.amountRaw?.raw) {
        const match = candidate.amountRaw.raw.match(/\d+(?:\.\d+)?/);
        if (match) setAmount(match[0]);
      }
    } catch {
      // Session storage is convenience-only and never trusted for execution.
    }
  }, []);

  async function handlePrepare() {
    if (!canProceed || !address || !usdc) return;
    setActionError(null);
    setResolving(true);

    try {
      const prepared: PreparedRecipient = isAddress(recipient)
        ? { kind: 'WALLET', resolvedAddress: recipient, chainId: ARC_TESTNET_CHAIN_ID, snapshot: null }
        : await preparePaymentRecipient(recipient, ARC_TESTNET_CHAIN_ID);
      if (!isAddress(prepared.resolvedAddress)) throw new Error('Resolved recipient is not a valid EVM address');

      const amountParsed = parseAmount(ARC_TESTNET_CHAIN_ID, amount);
      const action = createTransferAction({
        from: address,
        to: prepared.resolvedAddress,
        tokenAddress: usdc.address,
        tokenDecimals: usdc.decimals,
        amount: amountParsed.raw,
        chainId: ARC_TESTNET_CHAIN_ID,
      });
      setPreparedRecipient(prepared);
      setPendingAction(action);
    } catch (error) {
      setPreparedRecipient(null);
      setActionError(error instanceof Error ? error.message : 'Failed to resolve recipient');
    } finally {
      setResolving(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-7 md:px-7 md:py-9">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em]" style={{ color: 'var(--accent)' }}>
            <Sparkles className="size-4" /> Universal Pay
          </div>
          <h1 className="display mt-2 text-3xl font-black" style={{ color: 'var(--ink)', letterSpacing: '-0.04em' }}>Pay someone.</h1>
          <p className="mt-1 text-sm leading-6" style={{ color: 'var(--muted)' }}>
            Start with a person. Veyra resolves the endpoint and keeps routing complexity underneath the review flow.
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-2xl px-3 py-2" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <BrandLogo logoKey="arc" size={26} />
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--success)' }}>Active preview route</div>
            <div className="text-xs font-semibold" style={{ color: 'var(--ink-2)' }}>Arc Testnet · USDC</div>
          </div>
        </div>
      </div>

      {!isConnected ? (
        <div className="rounded-3xl p-7 text-center" style={{ background: 'var(--surface-strong)', border: '1px solid var(--border-strong)' }}>
          <div className="mx-auto flex size-12 items-center justify-center rounded-2xl" style={{ background: 'var(--accent-muted)', color: 'var(--accent)' }}>
            <SendHorizontal className="size-5" />
          </div>
          <h2 className="mt-4 text-lg font-bold" style={{ color: 'var(--ink)' }}>Connect your wallet to pay</h2>
          <p className="mx-auto mt-1 max-w-md text-sm leading-6" style={{ color: 'var(--muted)' }}>
            Your wallet remains the signing authority. Veyra never signs a payment on your behalf.
          </p>
          <div className="mt-5 flex justify-center"><ConnectKitButton /></div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-2xl p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <ShieldCheck className="mt-0.5 size-4 shrink-0" style={{ color: 'var(--success)' }} />
            <div>
              <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>No manual network setup required</p>
              <p className="mt-0.5 text-xs leading-5" style={{ color: 'var(--muted)' }}>Veyra can resolve and prepare the payment regardless of the network currently selected in your wallet. If the source transaction needs Arc, Veyra requests the source network only when you are ready to sign.</p>
            </div>
          </div>

          <div className="overflow-hidden rounded-[28px]" style={{ background: 'linear-gradient(145deg,rgba(23,43,67,0.98),rgba(16,31,51,0.98))', border: '1px solid var(--border-strong)' }}>
            <div className="border-b p-5" style={{ borderColor: 'var(--border)' }}>
              <label className="block text-xs font-bold uppercase tracking-[0.16em]" style={{ color: 'var(--muted)' }}>Who are you paying?</label>
              <input
                value={recipient}
                onChange={(event) => setRecipient(event.target.value.trim())}
                placeholder="@veyra, @xhandle, or 0x…"
                className="mt-3 w-full bg-transparent text-xl font-semibold outline-none"
                style={{ color: recipient && !recipientValid ? 'var(--danger)' : 'var(--ink)' }}
                autoComplete="off"
                spellCheck={false}
              />
              <p className="mt-2 text-xs" style={{ color: 'var(--subtle)' }}>Human-readable recipients resolve server-side to a verified wallet snapshot before review.</p>
            </div>

            <div className="p-5">
              <div className="flex items-center justify-between gap-3">
                <label className="text-xs font-bold uppercase tracking-[0.16em]" style={{ color: 'var(--muted)' }}>Amount</label>
                <div className="flex items-center gap-2 rounded-xl px-2.5 py-1.5" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                  <BrandLogo logoKey="usdc" size={20} />
                  <span className="text-xs font-bold" style={{ color: 'var(--ink-2)' }}>USDC</span>
                </div>
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <input
                  inputMode="decimal"
                  value={amount}
                  onChange={(event) => {
                    const value = event.target.value.replace(/[^0-9.]/g, '');
                    if (value === '' || /^\d*\.?\d*$/.test(value)) setAmount(value);
                  }}
                  placeholder="0.00"
                  className="display min-w-0 flex-1 bg-transparent text-4xl font-black tabular-nums outline-none"
                  style={{ color: 'var(--ink)' }}
                />
                <span className="text-lg font-semibold" style={{ color: 'var(--muted)' }}>USDC</span>
              </div>
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-3">
            <TrustItem icon={<CheckCircle2 className="size-3.5" />} text="Identity re-verified" />
            <TrustItem icon={<ShieldCheck className="size-3.5" />} text="Policy before signing" />
            <TrustItem icon={<BrandLogo logoKey="arc" size={18} />} text="Arc preview route" />
          </div>

          {actionError && (
            <div className="flex items-start gap-2 rounded-2xl p-3.5" style={{ background: 'var(--danger-muted)', border: '1px solid var(--border)', color: 'var(--danger)' }}>
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span className="text-sm">{actionError}</span>
            </div>
          )}

          <button
            onClick={() => void handlePrepare()}
            disabled={!canProceed}
            className="flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-bold transition-all hover:scale-[1.01] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40 disabled:scale-100"
            style={{ background: 'linear-gradient(135deg,#c8ff65,#91e9b5)', color: '#0b1b25' }}
          >
            {resolving ? 'Resolving recipient…' : 'Review payment'}
            {!resolving && <ArrowRight className="size-4" />}
          </button>

          <p className="text-center text-[11px] leading-5" style={{ color: 'var(--subtle)' }}>
            No provider, chain, amount, or recipient can be changed after review without a new verification cycle.
          </p>
        </div>
      )}

      {pendingAction && (
        <TransactionReviewSheet
          action={pendingAction}
          recipient={preparedRecipient}
          onClose={() => { setPendingAction(null); setPreparedRecipient(null); }}
        />
      )}
    </div>
  );
}

function TrustItem({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-[11px] font-semibold" style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--muted)' }}>
      <span style={{ color: 'var(--success)' }}>{icon}</span>{text}
    </div>
  );
}
