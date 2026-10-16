/**
 * Arc Mainnet surfaces for the ONE Veyra workspace.
 * Only public RPC observation and wallet connection. Never imports the
 * mainnet signing module, BFF or cross-chain execution providers.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { formatUnits } from 'viem';
import {
  ArrowRight, ArrowUpRight, CheckCircle2, CreditCard, ExternalLink,
  History, LockKeyhole, RefreshCw, Route, ShieldAlert, ShieldCheck, Wallet,
} from 'lucide-react';
import { BrandLogo } from '../components/brand/BrandLogo';
import { shortPreviewAddress, usePreviewWallet } from './PreviewWallet';
import {
  PREVIEW_ARC_MAINNET_CHAIN_ID, PREVIEW_ARC_MAINNET_USDC,
  PREVIEW_MAINNET_CANARY_MAX, readMainnetBalance, simulateReadOnlyMainnetIntent,
  type MainnetQuote, type MainnetBalanceSnapshot,
} from './arcMainnetReadOnly';
import type { PreviewPage } from './PreviewApp';

function useMainnetSnapshot() {
  const wallet = usePreviewWallet();
  const [snapshot, setSnapshot] = useState<MainnetBalanceSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nonce = useRef(0);
  const refresh = useCallback(async () => {
    const current = ++nonce.current;
    if (!wallet.address) { setSnapshot(null); setError(null); setLoading(false); return; }
    setSnapshot(null); setLoading(true); setError(null);
    try {
      const next = await readMainnetBalance(wallet.address);
      if (current === nonce.current) setSnapshot(next);
    } catch {
      if (current === nonce.current) setError('Arc Mainnet RPC unavailable or returned untrusted data. Balance not displayed.');
    } finally {
      if (current === nonce.current) setLoading(false);
    }
  }, [wallet.address]);
  useEffect(() => {
    void refresh();
    return () => { nonce.current++; };
  }, [refresh]);
  return { snapshot, loading, error, refresh };
}
function MainnetWalletNote() {
  const wallet = usePreviewWallet();
  return <div className="vp-form-note" role="status">
    <ShieldAlert size={18} style={{ flex: 'none' }} />
    <span>{!wallet.address
      ? 'Connect your browser wallet using the button above. Veyra never asks for a private key.'
      : wallet.chainId === PREVIEW_ARC_MAINNET_CHAIN_ID
        ? 'Wallet network confirmed: Arc Mainnet 5042. Data reads and simulations do not request a signature.'
        : `Wallet currently reports chain ${wallet.chainId ?? 'unknown'}. Manually switch to Arc Mainnet (5042) to simulate. Selecting the Mainnet tab never switches your wallet.`}</span>
  </div>;
}

export function PreviewMainnetHome({ onNavigate }: { onNavigate: (page: PreviewPage) => void }) {
  const wallet = usePreviewWallet();
  const balance = useMainnetSnapshot();
  return <div className="vp-page">
    <div className="vp-page-heading">
      <div>
        <p className="vp-eyebrow">ARC MAINNET · OBSERVATION MODE</p>
        <h1 className="vp-page-title">The same Veyra. <span style={{ color: '#c5fb71' }}>Real network.</span></h1>
        <p className="vp-page-description">One financial workspace for two environments. Mainnet is currently read-only: inspect your onchain USDC balance and simulate a wallet transfer without signing.</p>
      </div>
      <span className="vp-chain-pill"><LockKeyhole size={14}/> Real transfers locked</span>
    </div>
    <MainnetWalletNote />
    <section className="vp-grid-2" style={{ marginTop: 18 }}>
      <div className="vp-card vp-card-pad">
        <div className="vp-balance-head">
          <BrandLogo logoKey="usdc" size={38}/>
          <div style={{ flex: 1 }}><p className="vp-balance-label">Arc Mainnet wallet</p>
            <strong className="vp-card-title">USDC balance</strong></div>
          <button type="button" className="vp-icon-button" onClick={() => void balance.refresh()}
            disabled={!wallet.address || balance.loading} aria-label="Refresh Arc Mainnet balance"><RefreshCw size={16}/></button>
        </div>
        <div className="vp-balance-value">
          {balance.loading ? 'Reading…' : balance.snapshot ? formatUnits(balance.snapshot.units, 6) : '—'}<span> USDC</span>
        </div>
        <p className="vp-balance-sub">{balance.error ?? 'Public Arc Mainnet RPC · USDC balanceOf() · 6 decimals. Native gas shares this same underlying balance.'}</p>
        <div className="vp-balance-bottom"><span>WALLET</span>
          <span className="vp-mini-value">{wallet.address ? shortPreviewAddress(wallet.address) : 'Not connected'}</span></div>
      </div>
      <div className="vp-card vp-card-pad">
        <div className="vp-balance-head"><BrandLogo logoKey="arc" size={38}/>
          <div><strong className="vp-card-title">Arc Mainnet</strong>
            <p className="vp-caption">A network for actual settlement.</p></div></div>
        <div className="vp-stat-group">
          <div className="vp-stat"><span>CHAIN ID</span><strong>5042</strong></div>
          <div className="vp-stat"><span>USDC</span><strong>6 decimals</strong></div>
          <div className="vp-stat"><span>EXECUTION</span><strong>Locked</strong></div>
        </div>
        <a className="vp-text-button" href="https://explorer.arc.io" target="_blank" rel="noreferrer"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 22 }}>
          Open Arc Explorer <ExternalLink size={14}/></a>
      </div>
    </section>
    <div className="vp-section-heading"><div><h2>Mainnet capabilities</h2><p>Built for expansion, released one verified capability at a time.</p></div></div>
    <section className="vp-grid-3">
      {([
        { id: 'pay', title: 'USDC Pay', desc: 'Read-only canary simulation · signing locked.', icon: CreditCard },
        { id: 'convert', title: 'Convert', desc: 'Locked until independent provider acceptance.', icon: LockKeyhole },
        { id: 'bridge', title: 'Bridge', desc: 'Locked until live CCTP settlement is proven.', icon: Route },
      ] as const).map(({ id, title, desc, icon: Icon }) =>
        <button type="button" key={id} className="vp-card vp-quick" onClick={() => onNavigate(id)}>
          <span className="vp-quick-icon"><Icon size={21}/></span>
          <span style={{ flex: 1 }}><strong>{title}</strong><p>{desc}</p></span>
          <ArrowUpRight size={16}/></button>)}
    </section>
  </div>;
}

export function PreviewMainnetPay() {
  const wallet = usePreviewWallet();
  const snapshot = useMainnetSnapshot();
  const [destination, setDestination] = useState('');
  const [amount, setAmount] = useState('');
  const [quote, setQuote] = useState<MainnetQuote | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nonce = useRef(0);
  useEffect(() => {
    ++nonce.current;
    setDestination(''); setAmount(''); setQuote(null); setError(null); setBusy(false);
    return () => { nonce.current++; };
  }, [wallet.address, wallet.chainId]);

  async function simulate() {
    if (!wallet.address || wallet.chainId !== PREVIEW_ARC_MAINNET_CHAIN_ID || busy) return;
    const thisRequest = ++nonce.current;
    const source = wallet.address;
    setQuote(null); setBusy(true); setError(null);
    try {
      const result = await simulateReadOnlyMainnetIntent(source, destination.trim(), amount.trim());
      // Re-read wallet identity after RPC latency: an old quote must not survive
      // a wallet account/network change.
      const provider = wallet.activeProvider;
      if (!provider) throw new Error('Wallet disconnected during simulation.');
      const [accounts, chain] = await Promise.all([
        provider.request({ method: 'eth_accounts' }), provider.request({ method: 'eth_chainId' }),
      ]);
      if (!Array.isArray(accounts) || typeof accounts[0] !== 'string' ||
          accounts[0].toLowerCase() !== source.toLowerCase() ||
          chain !== '0x13b2') throw new Error('Wallet account or chain changed during simulation.');
      if (thisRequest === nonce.current) setQuote(result);
    } catch (cause) {
      if (thisRequest === nonce.current) setError(cause instanceof Error ? cause.message : 'Mainnet simulation failed.');
    } finally {
      if (thisRequest === nonce.current) setBusy(false);
    }
  }
  return <div className="vp-page" style={{ maxWidth: 1020 }}>
    <div className="vp-page-heading"><div><p className="vp-eyebrow">ARC MAINNET · PAY LAB</p>
      <h1 className="vp-page-title">Review real-network intent</h1>
      <p className="vp-page-description">Preview the exact USDC transfer and network fee requirements before any money moves. This release deliberately cannot sign or broadcast Mainnet payments.</p></div>
      <span className="vp-chain-pill"><LockKeyhole size={14}/> Signing disabled</span>
    </div>
    <div className="vp-grid-2">
      <section className="vp-card vp-card-pad vp-stack">
        <div className="vp-balance-head"><BrandLogo logoKey="usdc" size={38}/>
          <div style={{ flex: 1 }}><strong className="vp-card-title">Arc Mainnet USDC</strong>
            <p className="vp-caption">{wallet.address ? shortPreviewAddress(wallet.address) : 'Connect wallet above'}</p></div>
          <button type="button" className="vp-icon-button" disabled={!wallet.address}
            onClick={() => void snapshot.refresh()} aria-label="Refresh Mainnet USDC"><RefreshCw size={16}/></button></div>
        <div className="vp-stat-group">
          <div className="vp-stat"><span>ONCHAIN BALANCE</span><strong>{snapshot.loading ? 'Reading…' : snapshot.snapshot ? formatUnits(snapshot.snapshot.units, 6) : '—'} USDC</strong></div>
          <div className="vp-stat"><span>CANARY PREVIEW CAP</span><strong>{formatUnits(PREVIEW_MAINNET_CANARY_MAX, 6)} USDC</strong></div>
        </div>
        {snapshot.error && <p className="vp-form-error" role="alert">{snapshot.error}</p>}
        <MainnetWalletNote/>
        <div><label htmlFor="vp-mainnet-destination" className="vp-form-label">Recipient EVM address</label>
          <input id="vp-mainnet-destination" className="vp-form-input" placeholder="0x…" value={destination}
            maxLength={42} autoComplete="off" spellCheck={false} disabled={busy}
            onChange={e => { setDestination(e.target.value); setQuote(null); }}/></div>
        <div><label htmlFor="vp-mainnet-amount" className="vp-form-label">Amount (real Arc USDC)</label>
          <input id="vp-mainnet-amount" className="vp-form-input" placeholder="0.01" inputMode="decimal" value={amount}
            maxLength={20} disabled={busy} onChange={e => { setAmount(e.target.value); setQuote(null); }}/></div>
        <div className="vp-form-note"><ShieldAlert size={17} style={{ flex: 'none' }}/>
          Real Mainnet transfers are irreversible. The next step only asks public RPCs to simulate; it does not request a signature or send funds.</div>
        {error && <p role="alert" className="vp-form-error">{error}</p>}
        <button className="vp-primary vp-full" type="button" onClick={() => void simulate()}
          disabled={!wallet.address || wallet.chainId !== PREVIEW_ARC_MAINNET_CHAIN_ID || busy}>
          {busy ? 'Checking Arc Mainnet…' : 'Simulate & review'} <ArrowRight size={16}/></button>
      </section>
      <section className="vp-card vp-card-pad vp-stack">
        <div className="vp-balance-head"><span className="vp-quick-icon"><ShieldCheck size={22}/></span>
          <div><strong className="vp-card-title">Independent review</strong><p className="vp-caption">Public RPC evidence, not a signed transaction.</p></div></div>
        {quote ? <div className="vp-stack" aria-live="polite">
          <p className="vp-chain-pill" style={{ alignSelf: 'flex-start' }}><CheckCircle2 size={14}/> Simulation completed</p>
          <div className="vp-stat-group">
            <div className="vp-stat"><span>NETWORK</span><strong>Arc Mainnet · 5042</strong></div>
            <div className="vp-stat"><span>FROM</span><strong className="vp-mono" style={{ overflowWrap: 'anywhere' }}>{quote.sender}</strong></div>
            <div className="vp-stat"><span>TO</span><strong className="vp-mono" style={{ overflowWrap: 'anywhere' }}>{quote.recipient}</strong></div>
            <div className="vp-stat"><span>AMOUNT</span><strong>{quote.amount} USDC</strong></div>
            <div className="vp-stat"><span>MAX GAS RESERVE (ESTIMATE)</span><strong>{formatUnits(quote.feeReserveUnits, 6)} USDC</strong></div>
          </div>
          <div className="vp-form-note"><LockKeyhole size={16} style={{ flex: 'none' }}/>
            Signing is disabled. A simulation is not proof of payment. Mainnet release requires separate security and wallet approval gates.</div>
        </div> : <div className="vp-empty-state" style={{ padding: '52px 22px' }}>
          <span className="vp-quick-icon" style={{ width: 57, height: 57, margin: '0 auto' }}><LockKeyhole size={24}/></span>
          <h3>Ready for a safe review</h3><p>Connect an Arc Mainnet wallet, enter the recipient and amount, then run a public simulation. No payment can be initiated on this page.</p>
        </div>}
        <div className="vp-stat-group">
          <div className="vp-stat"><span>VERIFIED USDC INTERFACE</span>
            <strong className="vp-mono" style={{ overflowWrap: 'anywhere' }}>{PREVIEW_ARC_MAINNET_USDC}</strong></div>
          <div className="vp-stat"><span>EXECUTION STATE</span><strong>Disabled · review-only</strong></div>
        </div>
      </section>
    </div>
  </div>;
}

export function PreviewMainnetGate({ surface, onNavigate }: {
  surface: 'bridge' | 'convert' | 'activity' | 'settings'; onNavigate: (page: PreviewPage) => void;
}) {
  const wallet = usePreviewWallet();
  const names = { bridge: 'Bridge USDC', convert: 'Convert', activity: 'Activity', settings: 'Settings' };
  const subtitle = surface === 'activity'
    ? 'Mainnet receipt history requires verified execution evidence and an authenticated backend. No fabricated transactions are shown.'
    : surface === 'settings'
      ? 'Arc Mainnet network configuration is viewable, but money-moving providers are disabled.'
      : 'This Mainnet route is locked until its own independent end-to-end and safety acceptance.';
  return <div className="vp-page" style={{ maxWidth: 960 }}>
    <div className="vp-page-heading"><div><p className="vp-eyebrow">ARC MAINNET · {surface.toUpperCase()}</p>
      <h1 className="vp-page-title">{names[surface]}</h1>
      <p className="vp-page-description">{subtitle}</p></div>
      <span className="vp-chain-pill"><LockKeyhole size={14}/> Mainnet controlled release</span>
    </div>
    <div className="vp-card vp-card-pad vp-stack" style={{ maxWidth: 710 }}>
      <div className="vp-balance-head"><span className="vp-quick-icon"><LockKeyhole size={21}/></span>
        <div><strong className="vp-card-title">Safety gate active</strong><p className="vp-caption">No mainnet signing or backend orchestration in this preview.</p></div></div>
      <div className="vp-stat-group">
        <div className="vp-stat"><span>NETWORK</span><strong>Arc Mainnet · 5042</strong></div>
        <div className="vp-stat"><span>WALLET</span><strong>{wallet.address ? shortPreviewAddress(wallet.address) : 'Not connected'}</strong></div>
        <div className="vp-stat"><span>TRANSFER SUPPORT</span><strong>Read-only simulation</strong></div>
      </div>
      {surface === 'activity' && wallet.address && <a href={`https://explorer.arc.io/address/${wallet.address}`}
        target="_blank" rel="noreferrer" className="vp-text-button">Inspect your public onchain history <ExternalLink size={14}/></a>}
      <div className="vp-form-note"><ShieldCheck size={18} style={{ flex: 'none' }}/>
        {surface === 'settings'
          ? 'Switching environments changes only Veyra’s selected data context. It never adds or switches networks in your wallet.'
          : 'Future Veyra ID, agent routes, Bridge, Convert and cross-device Activity will be enabled individually after audited production readiness.'}</div>
      <button type="button" className="vp-primary" onClick={() => onNavigate('pay')}>Open Mainnet Pay simulation <ArrowRight size={16}/></button>
    </div>
    {surface === 'settings' && <p className="vp-caption" style={{ marginTop: 18 }}>
      Network RPC: https://rpc.mainnet.arc.io · Explorer: https://explorer.arc.io · ERC-20 USDC: {PREVIEW_ARC_MAINNET_USDC}
    </p>}
  </div>;
}
