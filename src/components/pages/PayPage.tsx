/**
 * Veyra Pay — human-first payment entry point.
 *
 * The UI talks about paying a person. The current executable preview route is
 * deliberately narrow: Arc Testnet USDC. Identity resolution and deterministic
 * policy/risk/simulation still run before the user can sign.
 */

import { useEffect, useRef, useState } from 'react';
import { useAccount } from 'wagmi';
import { ConnectKitButton } from 'connectkit';
import { formatUnits, isAddress } from 'viem';
import { AlertTriangle, ArrowRight, CheckCircle2, SendHorizontal, ShieldCheck, Sparkles } from 'lucide-react';
import { parseAmount } from '@/onchain-money';
import { buildTxExplorerUrl, getUsdc, requireChain } from '@/onchain-facts';
import { createTransferAction } from '@/core/pipeline/transferPipeline';
import { TransactionReviewSheet } from '../transfer/TransactionReviewSheet';
import { VeyraIdentityAccess } from '../identity/VeyraIdentityAccess';
import { BrandLogo } from '../brand/BrandLogo';
import type { TransferAction } from '@/core/actions/actionSchema';
import { preparePaymentRecipient, type PreparedRecipient } from '@/lib/api/identityApi';
import type { IntentCandidate } from '@/core/intent/intentSchema';
import {assertPreparedRecipientReview} from '@/core/execution/recipientReviewGuard';
import { friendLabel, useUnifiedSocial } from '../../features/social/UnifiedSocial';
import { useReceiptStore } from '@/hooks/useReceiptStore';

const ARC_TESTNET_CHAIN_ID = 5042002;

export function PayPage({friendRecipient, onFriendRecipientUsed}: {friendRecipient?: string | null;onFriendRecipientUsed?: () => void} = {}) {
  const { address, isConnected, chainId } = useAccount();
  const social = useUnifiedSocial();
  const { receipts: ownedReceipts, error: receiptError } = useReceiptStore();
  const recentPay = ownedReceipts.find((receipt) =>
    receipt.actionType === 'TRANSFER' && Boolean(receipt.executionTxHash));
  // Social only returns an active session for the exact wallet/chain/connector.
  const sessionToken = social.session?.token;
  const prepareEpoch = useRef(0);

  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<TransferAction | null>(null);
  const [preparedRecipient, setPreparedRecipient] = useState<PreparedRecipient | null>(null);
  const [resolving, setResolving] = useState(false);

  // Suggestions are verified friendship data, never a payment authority.
  // Every selected handle is still resolved and re-verified by the backend.
  const connectedFriends = social.session
    ? social.friends.filter((item) => item.state === 'CONNECTED' && item.veyraHandle && friendLabel(item).startsWith('@'))
    : [];
  const matchingFriends = connectedFriends.filter((item) =>
    !recipient.trim() || friendLabel(item).toLowerCase().includes(recipient.trim().toLowerCase())
  ).slice(0, 6);

  const usdc = getUsdc(ARC_TESTNET_CHAIN_ID);
  const arcChain = requireChain(ARC_TESTNET_CHAIN_ID);

  const recipientValid = recipient.trim().length > 0 && recipient.trim().length <= 128;
  const amountValid = /^\d+(?:\.\d{1,6})?$/.test(amount) &&
    Number.isFinite(Number(amount)) && Number(amount) > 0;
  const identityRequired = recipientValid && !isAddress(recipient) && !sessionToken;
  const canProceed = isConnected && recipientValid && amountValid && Boolean(address) &&
    Boolean(usdc) && !resolving && !identityRequired;

  useEffect(() => {
    // A pending snapshot is never reusable after a wallet/session change.
    prepareEpoch.current += 1;
    setPendingAction(null);
    setPreparedRecipient(null);
    setResolving(false);
  }, [address, sessionToken, chainId]);

  useEffect(() => {
    if (!friendRecipient) return;
    prepareEpoch.current += 1;
    setRecipient(friendRecipient);
    setAmount('');
    setPendingAction(null);
    setPreparedRecipient(null);
    setResolving(false);
    setActionError(null);
    onFriendRecipientUsed?.();
  }, [friendRecipient, onFriendRecipientUsed]);

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

  // Input changes invalidate an in-flight identity resolution and all previously
  // reviewed payment data. Never display a review for the wrong amount.
  function clearPreparedReview() {
    prepareEpoch.current += 1;
    setResolving(false);
    setPendingAction(null);
    setPreparedRecipient(null);
    setActionError(null);
  }
  function chooseFriend(handle: string) {
    clearPreparedReview();
    setRecipient(handle);
  }
  function changeAmount(value: string) {
    clearPreparedReview();
    setAmount(value);
  }

  async function handlePrepare() {
    if (!canProceed || !address || !usdc) return;
    const epoch = ++prepareEpoch.current;
    setActionError(null);
    setResolving(true);

    try {
      // Literal address Pay remains possible without a Social sign-in. Every
      // person/alias payment MUST use the wallet-bound signed Veyra session.
      if (!isAddress(recipient) && !sessionToken) {
        throw new Error('Sign in to your Veyra ID on this page before paying a person.');
      }
      const prepared: PreparedRecipient = isAddress(recipient)
        ? { kind: 'WALLET', resolvedAddress: recipient, chainId: ARC_TESTNET_CHAIN_ID, snapshot: null }
        : await preparePaymentRecipient(recipient, ARC_TESTNET_CHAIN_ID, sessionToken!);
      // Ignore a late backend response after switching wallet/session/friend.
      if (epoch !== prepareEpoch.current) return;
      assertPreparedRecipientReview({
        prepared,originalRecipient:recipient,senderAddress:address,
        expectedChainId:ARC_TESTNET_CHAIN_ID,
      });

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
      if (epoch === prepareEpoch.current) {
        setPreparedRecipient(null);
        setActionError(error instanceof Error ? error.message : 'Failed to resolve recipient');
      }
    } finally {
      if (epoch === prepareEpoch.current) setResolving(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-7 md:px-7 md:py-9">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em]" style={{ color: 'var(--accent)' }}>
            <Sparkles className="size-4" /> Pay by Veyra ID
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

      {isConnected && !sessionToken && (
        <div className="mb-4" aria-label="Veyra ID authorization for Pay">
          <VeyraIdentityAccess />
        </div>
      )}

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
              <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>{chainId === ARC_TESTNET_CHAIN_ID ? 'Arc Testnet connected' : 'Payment route: Arc Testnet · wallet on another network'}</p>
              <p className="mt-0.5 text-xs leading-5" style={{ color: 'var(--muted)' }}>{chainId === ARC_TESTNET_CHAIN_ID
                  ? 'Safety checks use Arc Testnet. You approve a transfer only after successful simulation.'
                  : 'Your wallet is on a different network. Review here; after safety checks pass, MetaMask will request Arc Testnet before the separate USDC payment approval. Sepolia ETH is not Arc USDC.'}</p>
            </div>
          </div>

          {recentPay && (
            <div role="status" aria-live="polite" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl p-4"
              style={{ border: '1px solid var(--border)', background: 'var(--surface)' }}>
              <div className="min-w-0">
                <p className="text-xs font-bold" style={{ color: 'var(--ink)' }}>Latest payment · {recentPay.status === 'VERIFIED'
                  ? 'Verified on Arc Testnet'
                  : recentPay.status === 'FAILED' ? 'Transaction failed'
                  : 'Pending confirmation'}</p>
                <p className="mt-1 text-xs" style={{ color: 'var(--muted)' }}>
                  {recentPay.expectedAmountDelta != null && recentPay.tokenSymbol === 'USDC' && recentPay.tokenDecimals === 6
                    ? `${formatUnits(recentPay.expectedAmountDelta, 6)} USDC · `
                    : ''}
                  {recentPay.status === 'PENDING'
                    ? 'Do not resend until this payment is verified.'
                    : 'Your payment record remains available after reload.'}
                </p>
              </div>
              {recentPay.executionTxHash && (
                <a href={buildTxExplorerUrl(recentPay.chainId, recentPay.executionTxHash)}
                  target="_blank" rel="noopener noreferrer"
                  className="shrink-0 text-xs font-bold underline underline-offset-4"
                  style={{ color: 'var(--accent)' }}>View transaction</a>
              )}
            </div>
          )}
          {receiptError && (
            <p role="alert" className="text-xs" style={{ color: 'var(--warning)' }}>
              Local payment history is temporarily unavailable. Check wallet activity before resending.
            </p>
          )}

          <div className="overflow-hidden rounded-[28px]" style={{ background: 'linear-gradient(145deg,rgba(23,43,67,0.98),rgba(16,31,51,0.98))', border: '1px solid var(--border-strong)' }}>
            <div className="border-b p-5" style={{ borderColor: 'var(--border)' }}>
              <label htmlFor="veyra-pay-recipient" className="block text-xs font-bold uppercase tracking-[0.16em]" style={{ color: 'var(--muted)' }}>Who are you paying?</label>
              <input
                id="veyra-pay-recipient"
                maxLength={128}
                aria-invalid={Boolean(recipient) && !recipientValid}
                value={recipient}
                onChange={(event) => chooseFriend(event.target.value.trim())}
                placeholder="@friend.veyra or 0x…"
                className="mt-3 w-full bg-transparent text-xl font-semibold outline-none"
                style={{ color: recipient && !recipientValid ? 'var(--danger)' : 'var(--ink)' }}
                autoComplete="off"
                spellCheck={false}
              />
              <p className="mt-2 text-xs" style={{ color: 'var(--subtle)' }}>Human-readable recipients resolve server-side to a verified wallet snapshot before review.</p>
              {social.session && (matchingFriends.length > 0 || social.friendsHasMore) && (
                <div role="group" aria-label="Select a verified friend to pay" className="mt-4 border-t pt-3" style={{borderColor:'var(--border)'}}>
                  <p className="mb-2 text-[11px] font-bold uppercase tracking-wider" style={{color:'var(--muted)'}}>
                    Your friends <span className="font-normal normal-case">· Choose a verified contact</span>
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {matchingFriends.map((item) => (
                      <button key={item.veyraUserId} type="button" onClick={() => chooseFriend(friendLabel(item))}
                        aria-label={'Pay friend ' + friendLabel(item)}
                        aria-pressed={recipient.toLowerCase()===friendLabel(item).toLowerCase()}
                        className="rounded-xl border px-3 py-2 text-xs font-semibold transition-colors hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                        style={{borderColor:recipient.toLowerCase()===friendLabel(item).toLowerCase()?'var(--accent)':'var(--border-strong)',background:'var(--surface)',color:'var(--ink)'}}>
                        {friendLabel(item)}
                      </button>
                    ))}
                    {social.friendsHasMore && (
                      <button type="button" disabled={social.loadingMoreFriends} onClick={() => void social.loadMoreFriends()}
                        className="rounded-xl border px-3 py-2 text-xs font-semibold disabled:opacity-50"
                        style={{borderColor:'var(--border)',color:'var(--muted)'}}>
                        {social.loadingMoreFriends ? 'Loading friends…' : 'More friends'}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="p-5">
              <div className="flex items-center justify-between gap-3">
                <label htmlFor="veyra-pay-amount" className="text-xs font-bold uppercase tracking-[0.16em]" style={{ color: 'var(--muted)' }}>Amount</label>
                <div className="flex items-center gap-2 rounded-xl px-2.5 py-1.5" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                  <BrandLogo logoKey="usdc" size={20} />
                  <span className="text-xs font-bold" style={{ color: 'var(--ink-2)' }}>USDC</span>
                </div>
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <input
                  id="veyra-pay-amount"
                  inputMode="decimal"
                  aria-invalid={Boolean(amount) && !amountValid}
                  aria-describedby="veyra-pay-amount-hint"
                  value={amount}
                  onChange={(event) => {
                    const value = event.target.value.replace(/[^0-9.]/g, '');
                    if (value.length <= 32 && (value === '' || /^\d*\.?\d*$/.test(value))) changeAmount(value);
                  }}
                  placeholder="0.00"
                  className="display min-w-0 flex-1 bg-transparent text-4xl font-black tabular-nums outline-none"
                  style={{ color: 'var(--ink)' }}
                />
                <span className="text-lg font-semibold" style={{ color: 'var(--muted)' }}>USDC</span>
              </div>
              <p id="veyra-pay-amount-hint" role={amount && !amountValid ? 'alert' : undefined}
                className="mt-2 text-xs" style={{color:amount && !amountValid?'var(--warning)':'var(--subtle)'}}>
                {amount && !amountValid ? 'Enter a positive USDC amount with no more than 6 decimal places.' :
                  'Arc Testnet USDC · 6 decimal places · You will review before signing.'}
              </p>
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-3">
            <TrustItem icon={<CheckCircle2 className="size-3.5" />} text="Identity re-verified" />
            <TrustItem icon={<ShieldCheck className="size-3.5" />} text="Policy before signing" />
            <TrustItem icon={<BrandLogo logoKey="arc" size={18} />} text="Arc preview route" />
          </div>

          {identityRequired && (
            <p role="status" className="text-xs" style={{color:'var(--muted)'}}>
              Sign in to your Veyra ID above before paying a person. No signature is needed to browse friends.
            </p>
          )}
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
          sessionToken={sessionToken}
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
