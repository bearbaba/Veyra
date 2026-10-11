/**
 * First real testnet transaction UI. Only direct Arc Testnet USDC transfers
 * are supported. No Veyra ID, cross-chain bridge or account backend.
 *
 * A persisted intent blocks accidental repeat signatures after wallet/RPC
 * uncertainty. Resuming a known tx hash is read-only.
 */
import { useEffect, useState } from 'react';
import { ArrowRight, CheckCircle2, ExternalLink, LockKeyhole, RefreshCw, SendHorizontal, ShieldAlert, ShieldCheck, Wallet } from 'lucide-react';
import { usePreviewWallet, shortPreviewAddress, usePreviewArcBalance } from './PreviewWallet';
import { ARC_TESTNET_CHAIN_ID, arcPayExplorerUrl, createArcTestnetPayPlan, reconcileArcTestnetPay, submitArcTestnetPay, type ArcPayPlan, type ArcPayStatus } from './arcTestnetPay';
import { BrandLogo } from '../components/brand/BrandLogo';

type JournalStage = 'AWAITING_WALLET' | 'UNKNOWN' | 'PENDING' | 'VERIFIED' | 'REVERTED';
interface Journal {
  from: string;
  to: string;
  amount: string;
  stage: JournalStage;
  hash: string | null;
}
function storageKey(account: string): string {
  return `veyra:arc-testnet-payment:v1:${account.toLowerCase()}`;
}
function readJournal(account: string): Journal | null {
  try {
    const raw = localStorage.getItem(storageKey(account));
    if (!raw) return null;
    const x = JSON.parse(raw) as Partial<Journal>;
    if (x.from?.toLowerCase() !== account.toLowerCase() ||
        typeof x.to !== 'string' || typeof x.amount !== 'string' ||
        !['AWAITING_WALLET', 'UNKNOWN', 'PENDING', 'VERIFIED', 'REVERTED'].includes(x.stage ?? '') ||
        (x.hash !== null && x.hash !== undefined && (typeof x.hash !== 'string' || !/^0x[\da-fA-F]{64}$/.test(x.hash)))) return null;
    createArcTestnetPayPlan(account, x.to, x.amount);
    // Never trust a restored VERIFIED/REVERTED flag as current chain proof.
    // Reconcile on-chain after reload before enabling another payment.
    return { from: account, to: x.to, amount: x.amount,
      stage: x.stage === 'VERIFIED' || x.stage === 'REVERTED' ? 'PENDING' : x.stage,
      hash: x.hash ?? null };
  } catch { return null; }
}
function storeJournal(journal: Journal): boolean {
  try {
    localStorage.setItem(storageKey(journal.from), JSON.stringify(journal));
    return localStorage.getItem(storageKey(journal.from)) === JSON.stringify(journal);
  } catch {
    return false;
  }
}
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Wallet or Arc Testnet RPC error. Do not repeat the transaction.';
}
function walletRejected(error: unknown): boolean {
  if (typeof error !== 'object' || !error || !('code' in error)) return false;
  return error.code === 4001 || error.code === 'ACTION_REJECTED';
}

export function PreviewTestnetPayPage() {
  const wallet = usePreviewWallet();
  const balance = usePreviewArcBalance(wallet.address);
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [review, setReview] = useState<ArcPayPlan | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [journal, setJournal] = useState<Journal | null>(null);
  const [proof, setProof] = useState<ArcPayStatus | null>(null);
  const [manualHash, setManualHash] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setReview(null);
    setConfirmed(false);
    setProof(null);
    setError(null);
    setJournal(wallet.address ? readJournal(wallet.address) : null);
  }, [wallet.address]);

  function preview() {
    if (!wallet.address) return setError('Connect your browser wallet first.');
    if (journal && journal.stage !== 'VERIFIED' && journal.stage !== 'REVERTED') {
      return setError('An earlier payment remains unresolved. Reconcile it before creating another.');
    }
    setError(null);
    setProof(null);
    try { setReview(createArcTestnetPayPlan(wallet.address, recipient.trim(), amount.trim())); }
    catch (cause) { setReview(null); setError(errorMessage(cause)); }
  }

  async function signAndSend() {
    if (!wallet.activeProvider || !wallet.address || !review || busy || !confirmed ||
        wallet.address.toLowerCase() !== review.from.toLowerCase() || journal?.stage === 'PENDING' ||
        journal?.stage === 'UNKNOWN' || journal?.stage === 'AWAITING_WALLET') return;

    // Record before invoking a wallet/RPC, fail-closed on any unknown result.
    const started: Journal = { from: review.from, to: review.to, amount: review.amount,
      stage: 'AWAITING_WALLET', hash: null };
    if (!storeJournal(started)) {
      setError('Local recovery storage unavailable. No wallet request sent; enable browser storage before trying a testnet payment.');
      return;
    }
    setJournal(started);
    setBusy(true);
    setError(null);
    let walletRequestStarted = false;
    try {
      const hash = await submitArcTestnetPay(wallet.activeProvider, review, () => {
        walletRequestStarted = true;
      });
      const pending: Journal = { ...started, stage: 'PENDING', hash };
      storeJournal(pending);
      setJournal(pending);
      setProof({ state: 'PENDING', txHash: hash });
      setReview(null);
      setConfirmed(false);
      balance.refresh();
    } catch (cause) {
      if (!walletRequestStarted || walletRejected(cause)) {
        try { localStorage.removeItem(storageKey(started.from)); } catch { /* no-op */ }
        setJournal(null);
        setError(walletRejected(cause)
          ? 'Wallet rejected the transaction. Nothing was sent by this request.'
          : `${errorMessage(cause)} No transaction submission was requested, so you can review again.`);
      } else {
        const uncertain: Journal = { ...started, stage: 'UNKNOWN' };
        storeJournal(uncertain);
        setJournal(uncertain);
        setReview(null);
        setError(`${errorMessage(cause)} If your wallet already submitted a transaction, paste its hash below. Never press Send again for an uncertain request.`);
      }
    } finally { setBusy(false); }
  }

  async function checkHash(hash: string) {
    if (!wallet.address || !journal || busy || !/^0x[\da-fA-F]{64}$/.test(hash)) {
      setError('Enter an existing 0x transaction hash with 64 hexadecimal characters.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const plan = createArcTestnetPayPlan(wallet.address, journal.to, journal.amount);
      const result = await reconcileArcTestnetPay(plan, hash);
      setProof(result);
      const stage = result.state === 'VERIFIED' ? 'VERIFIED'
        : result.state === 'REVERTED' ? 'REVERTED' : 'PENDING';
      const next: Journal = { ...journal, hash, stage };
      storeJournal(next);
      setJournal(next);
      if (stage === 'VERIFIED') balance.refresh();
    } catch (cause) {
      setError(`${errorMessage(cause)} Original request remains locked; inspect the hash on Arc Explorer.`);
    } finally { setBusy(false); }
  }

  function newPayment() {
    if (!journal || (journal.stage !== 'VERIFIED' && journal.stage !== 'REVERTED')) return;
    // A completed/reverted journal is immutable elsewhere on-chain.
    // This removes only the local display record to allow a new review.
    try { localStorage.removeItem(storageKey(journal.from)); } catch { /* no-op */ }
    setJournal(null);
    setProof(null);
    setReview(null);
    setRecipient('');
    setAmount('');
    setConfirmed(false);
    setManualHash('');
    setError(null);
  }

  const locked = busy || Boolean(journal && journal.stage !== 'VERIFIED' && journal.stage !== 'REVERTED');

  return (
    <div className="vp-page" style={{ maxWidth: 1020 }}>
      <div className="vp-page-heading">
        <div>
          <p className="vp-eyebrow">LIVE TESTNET BETA · ARC</p>
          <h1 className="vp-page-title">Send real testnet USDC</h1>
          <p className="vp-page-description">A real wallet-signed token transfer, with an Arc Explorer receipt and independent on-chain verification. This is not a demo or a Veyra ID transfer.</p>
        </div>
        <span className="vp-chain-pill"><ShieldCheck size={14}/> Arc Testnet only</span>
      </div>
      <div className="vp-grid-2">
        <section className="vp-card vp-card-pad vp-stack">
          <div className="vp-balance-head">
            <BrandLogo logoKey="usdc" size={38} />
            <div style={{ flex: 1 }}>
              <strong className="vp-card-title">USDC · Arc Testnet</strong>
              <p className="vp-caption">Connected wallet: {wallet.address ? shortPreviewAddress(wallet.address) : 'None'}</p>
            </div>
            <button className="vp-icon-button" onClick={balance.refresh} type="button" aria-label="Refresh Arc balance"><RefreshCw size={16}/></button>
          </div>
          <div className="vp-stat-group">
            <div className="vp-stat"><span>AVAILABLE TESTNET USDC</span><strong>{balance.loading ? 'Reading…' : balance.formatted ?? 'Unavailable'}</strong></div>
            <div className="vp-stat"><span>MAX PER TRANSFER</span><strong>1 USDC</strong></div>
          </div>
          {balance.error && <p role="alert" className="vp-form-error">{balance.error}</p>}
          {wallet.chainId !== ARC_TESTNET_CHAIN_ID && (
            <div className="vp-form-note"><Wallet size={17} style={{ flex: 'none' }} />
              <span>Switch your wallet to <strong>Arc Testnet (5042002)</strong> manually before sending. Veyra will not automatically switch networks.</span>
            </div>
          )}
          <div>
            <label htmlFor="arc-beta-recipient" className="vp-form-label">Recipient EVM address</label>
            <input id="arc-beta-recipient" className="vp-form-input" value={recipient}
              onChange={(e) => { setRecipient(e.target.value); setReview(null); setConfirmed(false); }}
              disabled={locked} maxLength={42} autoComplete="off" spellCheck={false} placeholder="0x…" />
          </div>
          <div>
            <label htmlFor="arc-beta-amount" className="vp-form-label">Amount (Arc Testnet USDC)</label>
            <input id="arc-beta-amount" className="vp-form-input" value={amount} inputMode="decimal"
              onChange={(e) => { setAmount(e.target.value); setReview(null); setConfirmed(false); }}
              disabled={locked} placeholder="0.01" maxLength={20} />
          </div>
          <div className="vp-form-note">
            <ShieldAlert size={18} style={{ flex: 'none' }} />
            <span>Testnet tokens only, no monetary value intended. This sends an irreversible transaction on Arc Testnet if you approve in your wallet. Use a fresh testing wallet and check the recipient carefully. No automatic resubmission.</span>
          </div>
          {error && <p className="vp-form-error" role="alert">{error}</p>}
          {!review && !journal && (
            <button className="vp-primary vp-full" type="button" onClick={preview}
              disabled={!wallet.address || busy}><SendHorizontal size={17}/> Review real testnet payment <ArrowRight size={16}/></button>
          )}
          {review && !journal && (
            <div className="vp-card" style={{ padding: 18, background: '#17242c', borderColor: 'rgba(197,251,113,.25)' }}>
              <strong className="vp-card-title">Review before wallet approval</strong>
              <div className="vp-stack" style={{ marginTop: 12, gap: 10 }}>
                <div className="vp-caption">From: <code>{review.from}</code></div>
                <div className="vp-caption">To: <code style={{ wordBreak: 'break-all' }}>{review.to}</code></div>
                <div className="vp-caption">Amount: <strong>{review.amount} Arc Testnet USDC</strong></div>
                <div className="vp-caption">Chain: <strong>5042002</strong> · Contract: <code style={{ wordBreak: 'break-all' }}>{review.token}</code></div>
                <label className="vp-caption" style={{ display: 'flex', alignItems: 'start', gap: 9 }}>
                  <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
                  I checked the chain, token, recipient and amount. I want my wallet to sign this testnet transfer.
                </label>
                <button type="button" className="vp-primary vp-full" onClick={() => void signAndSend()}
                  disabled={!confirmed || busy || wallet.chainId !== ARC_TESTNET_CHAIN_ID}>
                  <Wallet size={17}/> {busy ? 'Waiting for wallet…' : 'Open wallet to sign testnet transfer'}
                </button>
                <button type="button" className="vp-secondary vp-full" disabled={busy} onClick={() => { setReview(null); setConfirmed(false); }}>Cancel review</button>
              </div>
            </div>
          )}
          {journal && (
            <div className="vp-card" style={{ padding: 19, background: '#162433' }}>
              <p className="vp-eyebrow">ON-CHAIN PAYMENT STATUS</p>
              <strong className="vp-card-title">{
                journal.stage === 'VERIFIED' ? 'Verified on Arc Testnet'
                  : journal.stage === 'REVERTED' ? 'Transaction reverted'
                    : journal.stage === 'PENDING' ? 'Awaiting independent verification'
                      : 'Unknown submission: do not send again'
              }</strong>
              <p className="vp-caption" style={{ marginTop: 8 }}>{journal.amount} USDC → {shortPreviewAddress(journal.to)}</p>
              {journal.hash && (
                <a className="vp-text-button" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 10 }}
                  href={arcPayExplorerUrl(journal.hash)} target="_blank" rel="noopener noreferrer">Open transaction on Arc Explorer <ExternalLink size={14}/></a>
              )}
              {proof?.state === 'VERIFIED' && (
                <p className="vp-form-success"><CheckCircle2 size={15} style={{ display: 'inline' }} /> Confirmed at block {proof.proof.blockNumber} ({proof.proof.confirmations} confirmations); correct USDC Transfer log and canonical block hash.</p>
              )}
              {journal.hash ? (
                <button className="vp-secondary vp-full" style={{ marginTop: 14 }}
                  disabled={busy} type="button" onClick={() => void checkHash(journal.hash!)}>
                  <RefreshCw size={15}/> {busy ? 'Checking on-chain…' : 'Recheck transaction proof'}
                </button>
              ) : (
                <div className="vp-stack" style={{ marginTop: 14, gap: 10 }}>
                  <p className="vp-form-note">The wallet response was lost or uncertain. Find the original transaction in your wallet or Arc Explorer. Do not request a new signature.</p>
                  <label className="vp-form-label" htmlFor="arc-paste-hash">Original transaction hash (if found)</label>
                  <input className="vp-form-input" id="arc-paste-hash" value={manualHash}
                    onChange={(e) => setManualHash(e.target.value)} placeholder="0x…" maxLength={66} />
                  <button className="vp-secondary vp-full" type="button" disabled={busy || !/^0x[\da-fA-F]{64}$/.test(manualHash)}
                    onClick={() => void checkHash(manualHash)}>Verify existing hash only</button>
                </div>
              )}
              {(journal.stage === 'VERIFIED' || journal.stage === 'REVERTED') &&
                <button type="button" className="vp-secondary vp-full" style={{ marginTop: 12 }} onClick={newPayment}>Start a new testnet payment</button>}
            </div>
          )}
        </section>
        <aside className="vp-stack">
          <div className="vp-card vp-card-pad">
            <h2 className="vp-card-title" style={{ fontSize: 16 }}>What happens in the wallet?</h2>
            {[
              ['Review recipient & amount', 'Veyra validates the fixed testnet USDC contract and 1 USDC cap.'],
              ['Approve in your own wallet', 'The wallet shows the exact token transfer. Only your approval signs it.'],
              ['Verify on Arc', 'Veyra checks the tx identity, canonical block and exact ERC-20 Transfer logs.'],
              ['Recover safely', 'A pending tx hash remains available after reload. No repeat sends.'],
            ].map(([name, detail], i) => (
              <div className="vp-step" key={name}><span className="vp-step-number">{i + 1}</span>
                <div><strong>{name}</strong><p>{detail}</p></div></div>
            ))}
          </div>
          <div className="vp-form-note"><LockKeyhole size={18} style={{ flex: 'none' }}/>
            <div><strong>Limited beta feature</strong><p style={{ marginTop: 7 }}>Only direct wallet-to-wallet Arc Testnet USDC payment is executable here. Veyra IDs, live FX, smart bridge and cloud Activity receipts require the authenticated backend; they remain disabled.</p></div>
          </div>
        </aside>
      </div>
    </div>
  );
}
