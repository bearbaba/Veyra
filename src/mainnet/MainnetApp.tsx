import { useEffect, useRef, useState } from 'react';
import { ArrowRight, CheckCircle2, CircleHelp, ExternalLink, Github, LockKeyhole, RefreshCw, ShieldAlert, ShieldCheck, Wallet, Zap } from 'lucide-react';
import { formatUnits, isAddress, type Address } from 'viem';
import {
  ARC_MAINNET_CHAIN_ID, ARC_MAINNET_USDC, MAX_MAINNET_CANARY_UNITS,
  assertArcMainnetNetwork, arcMainnetRpc, buildMainnetPayPlan, mainnetExplorerTx,
  mainnetPreflight, reconcileMainnetCanary, requestMainnetCanaryTransfer,
  type MainnetPlan, type MainnetWallet, type MainnetReconciliation, type MainnetPreflight,
} from './arcMainnetPay.js';
import {
  clearMainnetJournal, readMainnetJournal, storageForMainnet, writeMainnetJournal,
  type MainnetJournal,
} from './arcMainnetJournal.js';

const CAN_SEND = import.meta.env.VITE_VEYRA_MAINNET_PAY === '1';
type WalletInfo = { id: string; label: string; provider: MainnetWallet & {
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
} };
type Discovery = Event & { detail?: { info?: { uuid?: string; name?: string }; provider?: WalletInfo['provider'] } };
const addressShort = (v: string) => `${v.slice(0, 6)}…${v.slice(-4)}`;
const errText = (err: unknown) => err instanceof Error ? err.message : 'Unexpected error. Do not submit a duplicate payment.';
function isWalletRejected(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err &&
    (err.code === 4001 || err.code === 'ACTION_REJECTED');
}
function parseWalletAddress(value: unknown): string | null {
  return Array.isArray(value) && typeof value[0] === 'string' && isAddress(value[0]) ? value[0] : null;
}
function parseWalletChain(value: unknown): number | null {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]+$/.test(value)) return null;
  const n = Number.parseInt(value, 16);
  return Number.isSafeInteger(n) ? n : null;
}

export function MainnetApp() {
  const [wallets, setWallets] = useState<WalletInfo[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const wallet = wallets.find((item) => item.id === selectedId) ?? null;
  const [address, setAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [balance, setBalance] = useState<string | null>(null);
  const [review, setReview] = useState<{ plan: MainnetPlan; preflight: MainnetPreflight } | null>(null);
  const [ack, setAck] = useState(false);
  const [journal, setJournal] = useState<MainnetJournal | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [recoveryBlocked, setRecoveryBlocked] = useState(false);
  const [evidence, setEvidence] = useState<MainnetReconciliation | null>(null);
  const [manualHash, setManualHash] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const signing = useRef(false);

  useEffect(() => {
    const announce = (event: Event) => {
      const { info, provider } = (event as Discovery).detail ?? {};
      if (!provider || typeof provider.request !== 'function') return;
      const id = info?.uuid ?? info?.name ?? 'injected';
      setWallets((existing) => existing.some((candidate) => candidate.id === id || candidate.provider === provider)
        ? existing : [...existing, { id, label: info?.name ?? 'Browser wallet', provider }]);
    };
    window.addEventListener('eip6963:announceProvider', announce);
    window.dispatchEvent(new Event('eip6963:requestProvider'));
    const injected: unknown = (window as unknown as { ethereum?: unknown }).ethereum;
    if (injected && typeof injected === 'object' && 'request' in injected && typeof injected.request === 'function') {
      const provider = injected as WalletInfo['provider'];
      setWallets((existing) => existing.some((candidate) => candidate.provider === provider)
        ? existing : [...existing, { id: 'injected', label: 'Injected wallet', provider }]);
    }
    return () => window.removeEventListener('eip6963:announceProvider', announce);
  }, []);

  useEffect(() => {
    if (!wallet) return;
    let disposed = false;
    const accounts = (...args: unknown[]) => {
      if (!disposed) setAddress(parseWalletAddress(args[0]));
    };
    const chains = (...args: unknown[]) => {
      if (!disposed) setChainId(parseWalletChain(args[0]));
    };
    const disconnected = () => {
      if (!disposed) { setAddress(null); setChainId(null); }
    };
    wallet.provider.on?.('accountsChanged', accounts);
    wallet.provider.on?.('chainChanged', chains);
    wallet.provider.on?.('disconnect', disconnected);
    void Promise.all([
      wallet.provider.request({ method: 'eth_accounts' }),
      wallet.provider.request({ method: 'eth_chainId' }),
    ]).then(([a, c]) => {
      if (!disposed) { setAddress(parseWalletAddress(a)); setChainId(parseWalletChain(c)); }
    }).catch(() => {
      if (!disposed) { setAddress(null); setChainId(null); }
    });
    return () => {
      disposed = true;
      wallet.provider.removeListener?.('accountsChanged', accounts);
      wallet.provider.removeListener?.('chainChanged', chains);
      wallet.provider.removeListener?.('disconnect', disconnected);
    };
  }, [wallet]);

  useEffect(() => {
    setReview(null); setAck(false); setEvidence(null); setBalance(null);
    setLoadedFor(null); setError(null);
    if (!address) { setJournal(null); setRecoveryBlocked(false); return; }
    const loaded = readMainnetJournal(address, storageForMainnet());
    setJournal(loaded.kind === 'active' ? loaded.value : null);
    setRecoveryBlocked(loaded.kind === 'blocked');
    setLoadedFor(address.toLowerCase());
  }, [address]);

  async function connect(id: string) {
    const candidate = wallets.find((w) => w.id === id);
    if (!candidate) return;
    setBusy(true); setError(null);
    try {
      const accounts = await candidate.provider.request({ method: 'eth_requestAccounts' });
      const next = parseWalletAddress(accounts);
      if (!next) throw new Error('Wallet returned no account.');
      const chain = parseWalletChain(await candidate.provider.request({ method: 'eth_chainId' }));
      setSelectedId(candidate.id); setAddress(next); setChainId(chain);
    } catch (cause) { setError(errText(cause)); } finally { setBusy(false); }
  }
  async function refresh() {
    if (!address || !isAddress(address)) return;
    setBusy(true); setError(null);
    try {
      await assertArcMainnetNetwork();
      const [decimals, units] = await Promise.all([
        arcMainnetRpc('eth_call', [{ to: ARC_MAINNET_USDC, data: '0x313ce567' }, 'latest']),
        arcMainnetRpc('eth_call', [{ to: ARC_MAINNET_USDC,
          data: `0x70a08231${address.slice(2).toLowerCase().padStart(64,'0')}` }, 'latest']),
      ]);
      if (typeof decimals !== 'string' || BigInt(decimals) !== 6n ||
        typeof units !== 'string' || !/^0x[0-9a-fA-F]+$/.test(units)) {
        throw new Error('Arc USDC balance interface verification failed.');
      }
      setBalance(formatUnits(BigInt(units), 6));
    } catch (cause) { setError(errText(cause)); } finally { setBusy(false); }
  }
  async function prepare() {
    if (!wallet || !address || loadedFor !== address.toLowerCase() || busy || journal || recoveryBlocked) return;
    const present = readMainnetJournal(address, storageForMainnet());
    if (present.kind !== 'empty') {
      if (present.kind === 'active') setJournal(present.value);
      if (present.kind === 'blocked') setRecoveryBlocked(true);
      setError('An existing or unreadable payment lock must be resolved before a new transfer.');
      return;
    }
    setBusy(true); setReview(null); setAck(false); setError(null);
    try {
      const plan = buildMainnetPayPlan(address, recipient.trim(), amount.trim());
      const preflight = await mainnetPreflight(wallet.provider, plan);
      setReview({ plan, preflight });
      setBalance(formatUnits(preflight.balance, 6));
    } catch (cause) { setError(errText(cause)); } finally { setBusy(false); }
  }
  async function submit() {
    if (!CAN_SEND || !wallet || !address || !review || !ack || busy || signing.current ||
      loadedFor !== address.toLowerCase() || address.toLowerCase() !== review.plan.from.toLowerCase() || journal) return;
    const present = readMainnetJournal(address, storageForMainnet());
    if (present.kind !== 'empty') {
      if (present.kind === 'active') setJournal(present.value);
      else setRecoveryBlocked(true);
      setError('Earlier transfer lock found. No wallet submission was requested.');
      return;
    }
    const initial: MainnetJournal = { from: review.plan.from, to: review.plan.to,
      amount: review.plan.amount, hash: null, stage: 'AWAITING_WALLET' };
    signing.current = true;
    if (!writeMainnetJournal(initial, storageForMainnet())) {
      signing.current = false; setRecoveryBlocked(true);
      setError('Browser storage unavailable. No payment requested.'); return;
    }
    setJournal(initial); setBusy(true); setError(null);
    let requested = false;
    try {
      const hash = await requestMainnetCanaryTransfer(wallet.provider, review.plan, () => { requested = true; });
      const next: MainnetJournal = { ...initial, hash, stage: 'PENDING' };
      setJournal(next); setEvidence({ state: 'PENDING', hash, indexed: false });
      if (!writeMainnetJournal(next, storageForMainnet())) setError('Hash could not be persisted. Copy it now; NEVER submit again.');
      setReview(null); setAck(false);
    } catch (cause) {
      if (!requested || isWalletRejected(cause)) {
        if (clearMainnetJournal(initial.from, storageForMainnet())) {
          setJournal(null);
          setError(isWalletRejected(cause) ? 'Wallet rejected this request.' : errText(cause));
        } else { setRecoveryBlocked(true); setError('Cannot clear local lock. Do not retry.'); }
      } else {
        const uncertain: MainnetJournal = { ...initial, stage: 'UNKNOWN' };
        writeMainnetJournal(uncertain, storageForMainnet());
        setJournal(uncertain); setReview(null);
        setError('Wallet response uncertain. Inspect wallet history and reconcile using the original hash. Never sign a duplicate.');
      }
    } finally { signing.current = false; setBusy(false); }
  }
  async function reconcile(hash: string) {
    if (!address || !journal || busy) return;
    setBusy(true); setError(null);
    try {
      const plan = buildMainnetPayPlan(address, journal.to, journal.amount);
      const result = await reconcileMainnetCanary(plan, hash);
      if (journal.hash === null && result.state === 'PENDING' && !result.indexed) {
        setError('Unknown hash is not yet indexed. The original payment stays locked.'); return;
      }
      setEvidence(result);
      const next: MainnetJournal = { ...journal, hash,
        stage: result.state === 'VERIFIED' ? 'VERIFIED' : result.state === 'REVERTED' ? 'REVERTED' : 'PENDING' };
      if (!writeMainnetJournal(next, storageForMainnet())) {
        setError('Could not save status. Do not send a new transaction.'); return;
      }
      setJournal(next);
      if (result.state === 'VERIFIED') setBalance(null);
    } catch (cause) { setError(`${errText(cause)} The original lock remains.`); }
    finally { setBusy(false); }
  }
  function reset() {
    if (!address || !journal || busy || signing.current ||
      !['VERIFIED', 'REVERTED'].includes(journal.stage)) return;
    if (!clearMainnetJournal(address, storageForMainnet())) {
      setError('Could not clear completed local record.'); return;
    }
    setJournal(null); setReview(null); setAck(false); setEvidence(null);
    setAmount(''); setRecipient(''); setManualHash('');
  }
  const readyAccount = !!address && loadedFor === address.toLowerCase();
  const blocked = busy || !readyAccount || recoveryBlocked || !!journal;
  const journalPending = journal && journal.stage !== 'VERIFIED' && journal.stage !== 'REVERTED';

  return (
    <div className="vm-shell">
      <header className="vm-topbar">
        <div className="vm-logo"><span className="vm-logo-mark">V</span><span>veyra<span className="vm-lime">.</span></span><small>ARC MAINNET LAB</small></div>
        <div className="vm-top-actions"><span className="vm-mainnet-pill"><span className="vm-dot"/> ARC MAINNET · 5042</span>
          <a className="vm-github" href="https://github.com/bearbaba/Veyra" target="_blank" rel="noreferrer"><Github size={16}/> GitHub <ExternalLink size={14}/></a>
        </div>
      </header>
      <main className="vm-main">
        <div className="vm-breadcrumb">VEYRA / PAYMENTS / ARC MAINNET</div>
        <section className="vm-hero">
          <div><div className="vm-eyebrow"><ShieldCheck size={16}/> SELF-CUSTODY BY DESIGN</div>
            <h1>Pay on Arc.<br/><span>Prove every step.</span></h1>
            <p>From payment intent to wallet signature and independently verified onchain receipt. The first step toward Veyra’s Intelligent Money Layer.</p>
          </div>
          <div className="vm-hero-orbit"><span className="vm-orbit-title">INTENT → RECEIPT</span><strong>USDC</strong><span>Native settlement · Arc</span></div>
        </section>
        {!CAN_SEND && <div className="vm-warning"><LockKeyhole size={20}/><span><strong>Safety preview — signing locked.</strong> This build reads live Arc Mainnet and simulates payments, but cannot submit transfers. Real-money signing requires a separate reviewed release gate.</span></div>}
        {CAN_SEND && <div className="vm-danger"><ShieldAlert size={19}/><span>Real Arc Mainnet USDC. An approved wallet transaction transfers money irreversibly. Maximum 1 USDC per request; no automatic retry.</span></div>}
        <div className="vm-columns">
          <section className="vm-panel">
            <div className="vm-panel-heading"><span className="vm-icon"><Wallet size={20}/></span><div><strong>01 / Your wallet</strong><p>Only you authorize a transaction.</p></div></div>
            {address ? <div className="vm-wallet-card">
              <div><small>CONNECTED WALLET</small><strong>{addressShort(address)}</strong><span>{wallet?.label} · {chainId === ARC_MAINNET_CHAIN_ID ? 'Arc Mainnet' : `Wrong chain: ${chainId ?? 'unknown'}`}</span></div>
              <button onClick={() => { setSelectedId(null); setAddress(null); setChainId(null); }} disabled={busy}>Disconnect</button>
            </div> : <div className="vm-wallet-list">{wallets.length ? wallets.map(w => <button type="button" key={w.id} onClick={() => void connect(w.id)} disabled={busy}><Wallet size={16}/>{w.label}<ArrowRight size={16}/></button>) : <div className="vm-muted">No injected wallet detected. Enable MetaMask, Rabby, or Coinbase Wallet and refresh.</div>}</div>}
            {address && chainId !== ARC_MAINNET_CHAIN_ID && <div className="vm-inline-note"><ShieldAlert size={16}/> Manually select Arc Mainnet (5042) in your wallet. Veyra never silently switches networks.</div>}
            <div className="vm-balance"><div><small>ARC USDC BALANCE</small><strong>{balance ?? '—'} <span>USDC</span></strong><p>ERC-20 balance (6 decimals); native gas shares this same balance.</p></div>
              <button onClick={() => void refresh()} disabled={!address || busy} title="Refresh Arc USDC balance"><RefreshCw size={18}/></button>
            </div>
            <div className="vm-section-rule"/>
            <div className="vm-panel-heading"><span className="vm-icon"><Zap size={20}/></span><div><strong>02 / Payment intent</strong><p>Exact address, exact amount, no AI execution.</p></div></div>
            <label className="vm-label" htmlFor="vm-destination">Recipient EVM address</label>
            <input id="vm-destination" className="vm-input" placeholder="0x…" value={recipient} maxLength={42} autoComplete="off" spellCheck={false} disabled={blocked}
              onChange={e => { setRecipient(e.target.value); setReview(null); setAck(false); }}/>
            <div className="vm-amount-heading"><label className="vm-label" htmlFor="vm-amount">Amount to send</label><span>Canary cap: {formatUnits(MAX_MAINNET_CANARY_UNITS,6)} USDC</span></div>
            <div className="vm-amount-wrap"><input id="vm-amount" className="vm-input" placeholder="0.01" inputMode="decimal" maxLength={20} value={amount} disabled={blocked}
              onChange={e => { setAmount(e.target.value); setReview(null); setAck(false); }}/><strong>USDC</strong></div>
            {!review && !journal && <button className="vm-primary" disabled={blocked || chainId !== ARC_MAINNET_CHAIN_ID}
              onClick={() => void prepare()}>{busy ? 'Checking…' : 'Simulate & review'} <ArrowRight size={18}/></button>}
            {review && !journal && <div className="vm-review">
              <div className="vm-review-title"><ShieldCheck size={18}/> Simulation passed</div>
              <div><span>From</span><code>{review.plan.from}</code></div><div><span>To</span><code>{review.plan.to}</code></div>
              <div><span>Network</span><strong>Arc Mainnet · 5042</strong></div>
              <div><span>USDC interface</span><code>{review.plan.token}</code></div>
              <div><span>Amount</span><strong>{review.plan.amount} USDC</strong></div>
              <div><span>Est. max gas reserve</span><strong>{formatUnits(review.preflight.feeReserveUnits,6)} USDC</strong></div>
              <label className="vm-confirm"><input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} disabled={!CAN_SEND}/>
                I verified the network, recipient, amount and real-money risk.</label>
              <button className="vm-primary" disabled={!CAN_SEND || !ack || busy}
                onClick={() => void submit()}>{CAN_SEND ? 'Approve in wallet' : 'Signing disabled'} <LockKeyhole size={17}/></button>
              <button className="vm-link" onClick={() => { setReview(null); setAck(false); }} disabled={busy}>Change details</button>
            </div>}
          </section>
          <section className="vm-panel vm-proof-panel">
            <div className="vm-panel-heading"><span className="vm-icon"><CheckCircle2 size={20}/></span><div><strong>03 / Verified receipt</strong><p>Chain evidence, not a fabricated success screen.</p></div></div>
            <div className="vm-timeline">
              <div><span>1</span><section><strong>Intent validated</strong><p>Recipient, 6-decimal amount and transfer calldata are pinned.</p></section></div>
              <div><span>2</span><section><strong>Chain & gas checked</strong><p>RPC chain ID, token decimals, simulation and gas reserve verified.</p></section></div>
              <div><span>3</span><section><strong>Wallet approves</strong><p>Only the connected wallet can sign; no automatic retries.</p></section></div>
              <div><span>4</span><section><strong>Receipt reconciled</strong><p>Transaction calldata, block hash and USDC Transfer event must match.</p></section></div>
            </div>
            <div className="vm-receipt-status">
              <div className="vm-status-row"><span className={evidence?.state === 'VERIFIED' ? 'vm-dot' : 'vm-dot vm-dot-muted'}/>
                <strong>{evidence?.state === 'VERIFIED' ? 'Verified on Arc' : evidence?.state === 'REVERTED' ? 'Onchain reverted' : journal ? 'Transaction needs reconciliation' : 'Awaiting a transaction'}</strong></div>
              {journal && <><div className="vm-receipt-data"><span>RECORDED TRANSFER</span><strong>{journal.amount} USDC</strong><code>{journal.to}</code></div>
                {journal.hash && <a target="_blank" rel="noreferrer" href={mainnetExplorerTx(journal.hash)} className="vm-explorer">View transaction on Arc Explorer <ExternalLink size={15}/></a>}
                {journalPending && <div className="vm-inline-note"><ShieldAlert size={16}/> The original request is locked. Do not submit a second payment while status is unknown.</div>}
                {evidence?.state === 'VERIFIED' && <div className="vm-verified"><CheckCircle2 size={18}/> Transfer log and canonical block verified · Block {evidence.blockNumber.toString()}</div>}
                {journalPending && <div className="vm-reconcile">
                  {journal.hash ? <button className="vm-secondary" onClick={() => void reconcile(journal.hash!)} disabled={busy}><RefreshCw size={15}/> Recheck original receipt</button>
                  : <><label className="vm-label" htmlFor="vm-hash">Recover original transaction hash</label>
                    <input id="vm-hash" className="vm-input" value={manualHash} onChange={e => setManualHash(e.target.value)} placeholder="0x… 64 hex characters"/>
                    <button className="vm-secondary" onClick={() => void reconcile(manualHash)} disabled={busy}>Verify original hash</button></>}
                </div>}
                {!journalPending && <button className="vm-secondary" disabled={busy} onClick={reset}>Start a new payment review</button>}
              </>}
              {!journal && <p className="vm-muted">No submitted transaction is recorded on this browser. A simulation is not a payment receipt.</p>}
            </div>
            <div className="vm-info"><CircleHelp size={17}/><span>Local recovery locks protect against accidental repeat clicks, not multi-device concurrency. Production-scale payment orchestration will use Veyra ID, a server-side receipt ledger and idempotency checks.</span></div>
          </section>
        </div>
        {recoveryBlocked && <div className="vm-danger">Unreadable previous payment record: sending is blocked. Inspect wallet transactions first.</div>}
        {error && <div className="vm-error" role="alert">{error}</div>}
        <section className="vm-roadmap"><div><span>THE LONG VIEW</span><h2>Built for more than a transfer.</h2><p>This standalone canary preserves interfaces for Veyra ID, AI-assisted intent, Circle CCTP, and durable financial receipts—without granting any agent authority over wallet signatures.</p></div>
          <div className="vm-roadmap-tags"><span>01 / Pay</span><span>02 / Identity</span><span>03 / Agent</span><span>04 / Bridge</span><span>05 / Receipts</span></div>
        </section>
      </main>
      <footer className="vm-footer"><span>© Veyra · Intelligent Money Layer on Arc</span><span>Self custody. Explicit approval. Verifiable receipts.</span></footer>
    </div>
  );
}
