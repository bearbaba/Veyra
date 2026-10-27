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
import { AlertTriangle, ArrowRight, Copy, SendHorizontal, ShieldCheck } from 'lucide-react';
import { parseAmount } from '@/onchain-money';
import { buildTxExplorerUrl, getUsdc, requireChain } from '@/onchain-facts';
import { createTransferAction } from '@/core/pipeline/transferPipeline';
import { TransactionReviewSheet } from '../transfer/TransactionReviewSheet';
import { VeyraIdentityAccess } from '../identity/VeyraIdentityAccess';
import { BrandLogo } from '../brand/BrandLogo';
import type { TransferAction } from '@/core/actions/actionSchema';
import { preparePaymentRecipient, type PreparedRecipient } from '@/lib/api/identityApi';
import type { IntentCandidate } from '@/core/intent/intentSchema';
import { validateAgentTransferDraft } from '@/core/agent/transferDraftGate';
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
  const [recipientMode, setRecipientMode] = useState<'WALLET' | 'FRIEND'>('WALLET');
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

  const recipientValid = recipientMode === 'WALLET'
    ? isAddress(recipient.trim())
    : /^@[a-z0-9_-]{2,32}\.veyra$/i.test(recipient.trim());
  const amountValid = /^\d{1,18}(?:\.\d{1,6})?$/.test(amount) && /[1-9]/.test(amount);
  const identityRequired = recipientMode === 'FRIEND' && recipientValid && !sessionToken;
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
    setRecipientMode('FRIEND');
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
      // Defense in depth: never interpret a decimal prefix or silently
      // change the explicitly requested network during Agent handoff.
      const gate = validateAgentTransferDraft(candidate);
      if (!gate.ok) {
        setActionError(gate.reason);
        return;
      }
      setRecipient(candidate.recipientRaw!.raw);
      setRecipientMode(isAddress(candidate.recipientRaw!.raw) ? 'WALLET' : 'FRIEND');
      setAmount(gate.amount);
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
  function selectRecipientMode(mode: 'WALLET' | 'FRIEND') {
    if (mode === recipientMode) return;
    clearPreparedReview();
    setRecipientMode(mode);
    setRecipient('');
  }
  async function pasteRecipient() {
    clearPreparedReview();
    try {
      if (!navigator.clipboard?.readText) throw Error('Clipboard unavailable');
      setRecipient((await navigator.clipboard.readText()).trim());
    } catch {
      setActionError('Clipboard access is unavailable. Paste the wallet address with Ctrl+V.');
    }
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
        : await Promise.race([
            preparePaymentRecipient(recipient, ARC_TESTNET_CHAIN_ID, sessionToken!),
            new Promise<never>((_, reject) => window.setTimeout(
              () => reject(new Error('Recipient verification timed out. Please retry; no transaction was sent.')), 12_000)),
          ]);
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
            <SendHorizontal className="size-4" /> Send USDC
          </div>
          <h1 className="display mt-2 text-3xl font-black" style={{ color: 'var(--ink)', letterSpacing: '-0.04em' }}>Send money.</h1>
          <p className="mt-1 text-sm leading-6" style={{ color: 'var(--muted)' }}>
            Choose a friend or paste a wallet. Enter an amount, review and sign.
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-2xl px-3 py-2" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <BrandLogo logoKey="arc" size={26} />
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--muted)' }}>Available route</div>
            <div className="text-xs font-semibold" style={{ color: 'var(--ink-2)' }}>Arc Testnet · USDC</div>
          </div>
        </div>
      </div>

      {isConnected && !sessionToken && recipientMode === 'FRIEND' && (
        <div className="mb-4" aria-label="Veyra ID authorization for Pay">
          <VeyraIdentityAccess />
        </div>
      )}

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
              <div className="flex flex-wrap items-center justify-between gap-3">
                <label htmlFor="veyra-pay-recipient" className="text-xs font-bold uppercase tracking-[0.16em]" style={{ color: 'var(--muted)' }}>Recipient</label>
                <div role="tablist" aria-label="Recipient type" className="flex gap-1 rounded-lg p-1"
                  style={{background:'var(--surface)'}}>
                  <button type="button" role="tab" aria-selected={recipientMode==='WALLET'}
                    onClick={() => selectRecipientMode('WALLET')}
                    className="rounded-lg px-3 py-2 text-xs font-semibold"
                    style={{background:recipientMode==='WALLET'?'var(--accent-muted)':'transparent',color:'var(--ink)'}}>Wallet</button>
                  <button type="button" role="tab" aria-selected={recipientMode==='FRIEND'}
                    onClick={() => selectRecipientMode('FRIEND')}
                    className="rounded-lg px-3 py-2 text-xs font-semibold"
                    style={{background:recipientMode==='FRIEND'?'var(--accent-muted)':'transparent',color:'var(--ink)'}}>Friends / Veyra ID</button>
                </div>
              </div>
              <input
                id="veyra-pay-recipient"
                maxLength={128}
                aria-invalid={Boolean(recipient) && !recipientValid}
                value={recipient}
                onChange={(event) => chooseFriend(event.target.value.trim())}
                placeholder={recipientMode==='WALLET' ? '0x… recipient wallet address' : '@friend.veyra'}
                className="mt-3 w-full bg-transparent text-xl font-semibold outline-none"
                style={{ color: recipient && !recipientValid ? 'var(--danger)' : 'var(--ink)' }}
                autoComplete="off"
                spellCheck={false}
              />
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs" style={{color:'var(--muted)'}}>
                  {recipientMode==='WALLET'
                    ? 'Full EVM address · Verified before signing.'
                    : 'Select a connected friend or enter their verified Veyra ID.'}
                </p>
                {recipientMode==='WALLET' && (
                  <button type="button" onClick={() => void pasteRecipient()}
                    className="flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold"
                    style={{borderColor:'var(--border-strong)',color:'var(--accent)'}}>
                    <Copy className="size-3.5"/> Paste
                  </button>
                )}
              </div>
              {recipient && !recipientValid && (
                <p role="alert" className="mt-2 text-xs" style={{color:'var(--warning)'}}>
                  {recipientMode==='WALLET' ? 'Enter a complete, valid 0x wallet address.' : 'Enter a valid @name.veyra handle.'}
                </p>
              )}
              {recipientMode==='FRIEND' && social.session && (matchingFriends.length > 0 || social.friendsHasMore) && (
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
                    // Never convert "2,5" into "25" by stripping unsupported punctuation.
                    // Preserve the user's draft and show a validation error instead.
                    const value = event.target.value;
                    if (value.length <= 32) changeAmount(value);
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

          <p className="flex items-center gap-2 text-xs" style={{color:'var(--muted)'}}>
            <ShieldCheck className="size-4" style={{color:'var(--success)' }}/>
            Recipient, balance and network are checked before your wallet signs.
          </p>

          {recipientMode==='FRIEND' && !social.session && !isConnected && (
            <p className="text-xs" style={{color:'var(--muted)'}}>Connect a wallet to see your verified friends.</p>
          )}
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

          {!isConnected && (
            <div className="rounded-2xl border p-4 text-center"
              style={{borderColor:'var(--border-strong)',background:'var(--surface)'}}>
              <p className="mb-3 text-sm" style={{color:'var(--muted)'}}>
                Your draft is ready to edit. Connect a wallet when you want to review and sign.
              </p>
              <ConnectKitButton />
            </div>
          )}
          <button
            onClick={() => void handlePrepare()}
            disabled={!canProceed}
            className="flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-bold transition-all hover:scale-[1.01] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40 disabled:scale-100"
            style={{ background: 'linear-gradient(135deg,#c8ff65,#91e9b5)', color: '#0b1b25' }}
          >
            {resolving ? 'Checking recipient…' : 'Review transfer'}
            {!resolving && <ArrowRight className="size-4" />}
          </button>

          <p className="text-center text-[11px] leading-5" style={{ color: 'var(--subtle)' }}>
            Arc Testnet USDC only · No signature until you confirm in your wallet.
          </p>
        </div>

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

