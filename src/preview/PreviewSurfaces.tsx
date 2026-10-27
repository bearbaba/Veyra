/**
 * Veyra connected Preview dashboard — real wallet identity and read-only
 * Arc Testnet balance, but no BFF, signing or financial execution modules.
 */
import { useState } from 'react';
import {
  Activity, ArrowDownRight, ArrowRight, ArrowUpRight, ArrowLeftRight,
  Bot, CheckCircle2, Copy, CreditCard, ExternalLink,
  History, LockKeyhole, RefreshCw, Route, SendHorizontal,
  ShieldCheck, Sparkles, Wallet,
} from 'lucide-react';
import { usePreviewArcBalance, usePreviewWallet, shortPreviewAddress } from './PreviewWallet';
import { BrandLogo } from '../components/brand/BrandLogo';
import type { PreviewPage } from './PreviewApp';

export function PreviewHome({ onNavigate }: { onNavigate: (page: PreviewPage) => void }) {
  const wallet = usePreviewWallet();
  const balance = usePreviewArcBalance(wallet.address);
  const [copied, setCopied] = useState(false);
  async function copy() {
    if (!wallet.address) return;
    try { await navigator.clipboard.writeText(wallet.address); setCopied(true); } catch { setCopied(false); }
  }

  return (
    <div className="vp-page">
      <div className="vp-page-heading">
        <div>
          <p className="vp-eyebrow">YOUR FINANCIAL WORKSPACE</p>
          <h1 className="vp-page-title">Good to see you<span style={{ color: '#c5fb71' }}>.</span></h1>
          <p className="vp-page-description">Real Arc Testnet USDC transfers are available. Cross-chain and FX routes remain gated.</p>
        </div>
        <span className="vp-chain-pill"><span className="vp-status-dot" /> Testnet preview · connected wallet enabled</span>
      </div>

      <section className="vp-grid-2">
        <div className="vp-hero">
          <div className="vp-eyebrow" style={{ color: '#ccff92' }}><Sparkles size={13} style={{ display: 'inline', marginRight: 6 }} /> MEET THE BETTER WAY TO MOVE MONEY</div>
          <h2>Money moves.<br /><span>Veyra makes it simple.</span></h2>
          <p>Send capped testnet USDC directly between wallets today. Identity payments, live conversion, and cross-chain execution are still being validated.</p>
          <div className="vp-hero-buttons">
            <button type="button" className="vp-primary" onClick={() => onNavigate('pay')}>
              <SendHorizontal size={16} /> Explore Pay <ArrowRight size={16} />
            </button>
            <button type="button" className="vp-secondary" onClick={() => onNavigate('agent')}>
              <Bot size={17} /> Ask Veyra
            </button>
          </div>
        </div>

        <div className="vp-card vp-card-pad">
          <div className="vp-balance-head">
            <BrandLogo logoKey="usdc" size={38} />
            <div style={{ flex: 1 }}>
              <p className="vp-balance-label">Your Arc Testnet wallet</p>
              <strong className="vp-card-title">USDC balance</strong>
            </div>
            {wallet.address && <button type="button" className="vp-icon-button" aria-label="Refresh balance" onClick={balance.refresh}><RefreshCw size={16} /></button>}
          </div>
          <div className="vp-balance-value">
            {!wallet.address ? '—' : balance.loading ? '···' : balance.formatted ?? '—'}
            <span> USDC</span>
          </div>
          <p className="vp-balance-sub">
            {!wallet.address
              ? 'Connect a browser wallet to read your actual on-chain balance.'
              : balance.error ?? 'Live read from Arc Testnet · balanceOf (no signature)'}
          </p>
          <div className="vp-balance-bottom">
            <span>CONNECTED WALLET</span>
            {wallet.address ? (
              <button className="vp-text-button vp-mono" type="button" onClick={() => void copy()}>
                {copied ? 'Copied' : shortPreviewAddress(wallet.address)} <Copy size={12} style={{ display: 'inline', marginLeft: 5 }} />
              </button>
            ) : (
              <span className="vp-mini-value">Not connected</span>
            )}
          </div>
        </div>
      </section>

      <div className="vp-section-heading">
        <div><h2>Move with Veyra</h2><p>Everything you need, right where you need it.</p></div>
      </div>
      <div className="vp-grid-3">
        {([
          { title: 'Send testnet USDC', desc: 'Real wallet signature · max 1 USDC.', id: 'pay', icon: ArrowUpRight },
          { title: 'Convert assets', desc: 'Execution not enabled yet.', id: 'convert', icon: ArrowLeftRight },
          { title: 'Bridge USDC', desc: 'Live cross-chain transfers are not enabled yet.', id: 'bridge', icon: Route },
        ] as const).map(({ title, desc, id, icon: Icon }) => (
          <button type="button" onClick={() => onNavigate(id)} key={id} className="vp-card vp-quick">
            <span className="vp-quick-icon"><Icon size={21} /></span>
            <span style={{ flex: 1 }}><strong>{title}</strong><p>{desc}</p></span>
            <ArrowUpRight className="vp-quick-arrow" size={17} />
          </button>
        ))}
      </div>

      <div className="vp-section-heading">
        <div><h2>Your Veyra network</h2><p>Connected assets and product safety at a glance.</p></div>
        <button type="button" className="vp-text-button" onClick={() => onNavigate('unified')}>Explore Unified <ArrowRight size={13} style={{ display: 'inline' }} /></button>
      </div>
      <section className="vp-grid-2">
        <div className="vp-card vp-card-pad">
          <div className="vp-balance-head">
            <BrandLogo logoKey="arc" size={37} />
            <div style={{ flex: 1 }}>
              <strong className="vp-card-title">Powered by Arc</strong>
              <p className="vp-caption">One home for your USDC.</p>
            </div>
            <span className="vp-safe-pill" style={{ marginTop: 0 }}><span /> TESTNET</span>
          </div>
          <div className="vp-stat-group">
            <div className="vp-stat"><span>NETWORK</span><strong>Arc Testnet</strong></div>
            <div className="vp-stat"><span>CHAIN ID</span><strong>5042002</strong></div>
            <div className="vp-stat"><span>TOKEN</span><strong>USDC</strong></div>
          </div>
          <div className="vp-route">
            <BrandLogo logoKey="arc" size={35}/>
            <div className="vp-route-line" />
            <BrandLogo logoKey="ethereum" size={35}/>
            <div className="vp-route-line" />
            <BrandLogo logoKey="base" size={35}/>
          </div>
          <p className="vp-caption">Bridge route previews: Arc → Ethereum Sepolia / Base Sepolia. Live CCTP submission is disabled here.</p>
        </div>
        <div className="vp-card vp-card-pad">
          <div className="vp-balance-head" style={{ marginBottom: 17 }}>
            <span className="vp-quick-icon"><ShieldCheck size={20} /></span>
            <div><strong className="vp-card-title">Your safety, first</strong><p className="vp-caption">Designed for transparency.</p></div>
          </div>
          {[
            { name: 'Wallet connection', status: wallet.address ? 'Connected' : 'Available', icon: CheckCircle2 },
            { name: 'Arc testnet reads', status: 'Read-only', icon: ArrowDownRight },
            { name: 'CCTP & Convert execution', status: 'Locked', icon: LockKeyhole },
          ].map(({ name, status, icon: StatusIcon }) => (
            <div className="vp-step" key={name}>
              <span style={{ color: '#adc9f6' }}><StatusIcon size={16} /></span>
              <strong style={{ flex: 1, fontSize: 11 }}>{name}</strong>
              <span style={{ color: status === 'Locked' ? '#e8be81' : '#bfe79b', fontSize: 10 }}>{status}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

export function PreviewActivity({ onNavigate }: { onNavigate: (page: PreviewPage) => void }) {
  const wallet = usePreviewWallet();
  let latest: { to: string; amount: string; stage: string; hash: string | null } | null = null;
  if (wallet.address) {
    try {
      const value = localStorage.getItem(`veyra:arc-testnet-payment:v1:${wallet.address.toLowerCase()}`);
      if (value) {
        const candidate = JSON.parse(value) as Record<string, unknown>;
        if (typeof candidate.to === 'string' && /^0x[0-9a-fA-F]{40}$/.test(candidate.to) &&
            typeof candidate.amount === 'string' &&
            typeof candidate.stage === 'string' &&
            ['AWAITING_WALLET', 'UNKNOWN', 'PENDING', 'VERIFIED', 'REVERTED'].includes(candidate.stage) &&
            (candidate.hash === null || (typeof candidate.hash === 'string' && /^0x[0-9a-fA-F]{64}$/.test(candidate.hash)))) {
          latest = { to: candidate.to, amount: candidate.amount, stage: candidate.stage, hash: typeof candidate.hash === 'string' ? candidate.hash : null };
        }
      }
    } catch { /* Local storage can be unavailable or have invalid entries */ }
  }
  return (
    <div className="vp-page" style={{ maxWidth: 940 }}>
      <div className="vp-page-heading">
        <div><p className="vp-eyebrow">TESTNET TRANSACTION HISTORY</p><h1 className="vp-page-title">Your activity</h1>
          <p className="vp-page-description">The latest direct Arc Testnet payment is stored only in this browser. Server-backed ActivityReceipt history requires a deployed, authenticated BFF.</p></div>
        <span className="vp-chain-pill"><ShieldCheck size={14} /> Local testnet ledger</span>
      </div>
      {latest ? (
        <div className="vp-card vp-card-pad">
          <p className="vp-eyebrow">LAST ARC TESTNET USDC PAYMENT</p>
          <h2 className="vp-card-title" style={{ fontSize: 17 }}>{latest.amount} USDC → {shortPreviewAddress(latest.to)}</h2>
          <p className="vp-caption" style={{ marginTop: 9 }}>Recorded status: <strong>{latest.stage}</strong> · local browser record only</p>
          {latest.hash && (
            <a href={`https://explorer.testnet.arc.io/tx/${latest.hash}`} target="_blank" rel="noopener noreferrer"
              className="vp-text-button" style={{ display: 'inline-block', marginTop: 13 }}>
              Inspect submitted hash on Arc Explorer
            </a>
          )}
          <button className="vp-primary" type="button" style={{ marginTop: 18 }}
            onClick={() => onNavigate('pay')}>
            {latest.stage === 'VERIFIED' ? 'View Pay / send another' : 'Open Pay to reconcile receipt'}
            <ArrowRight size={16} />
          </button>
          <p className="vp-caption" style={{ marginTop: 15 }}>
            This card does not prove settlement. The Pay screen independently checks RPC chain ID,
            transaction calldata, canonical block and ERC-20 Transfer event before showing VERIFIED.
          </p>
        </div>
      ) : (
        <div className="vp-card vp-empty-state" style={{ padding: '76px 25px' }}>
          <span className="vp-quick-icon" style={{ width: 60, height: 60, margin: '0 auto' }}><History size={25} /></span>
          <h3>No recorded testnet payment in this browser</h3>
          <p>{wallet.address ? `Connected ${shortPreviewAddress(wallet.address)}. ` : ''}
            Connect a wallet and submit a direct testnet payment to begin. Real cross-device receipts require the authenticated backend.
          </p>
          <button type="button" className="vp-primary" style={{ marginTop: 20 }} onClick={() => onNavigate('pay')}>
            Open Arc Testnet Pay <ArrowRight size={15} />
          </button>
        </div>
      )}
      <div className="vp-section-heading"><div><h2>Future cloud receipts</h2><p>The full Veyra BFF maintains independent and owner-authenticated proof.</p></div></div>
      <div className="vp-grid-3">
        {[
          { icon: CreditCard, title: 'Review', desc: 'Canonical intent & approval' },
          { icon: Activity, title: 'Track', desc: 'Receipts with independent proof' },
          { icon: ShieldCheck, title: 'Recover', desc: 'Safe retry checks, no double burn' },
        ].map(({ icon: Icon, title, desc }) => (
          <div className="vp-card vp-card-pad" key={title}><span className="vp-quick-icon"><Icon size={19} /></span>
            <h3 style={{ fontSize: 13, fontWeight: 750, marginTop: 14 }}>{title}</h3><p className="vp-caption" style={{ marginTop: 5 }}>{desc}</p></div>
        ))}
      </div>
    </div>
  );
}

export function PreviewSettings() {
  const wallet = usePreviewWallet();
  const balance = usePreviewArcBalance(wallet.address);
  return (
    <div className="vp-page" style={{ maxWidth: 940 }}>
      <div className="vp-page-heading"><div><p className="vp-eyebrow">ACCOUNT & SAFETY</p>
        <h1 className="vp-page-title">Settings</h1><p className="vp-page-description">Your wallet connection and preview capabilities.</p>
      </div></div>
      <section className="vp-grid-2">
        <div className="vp-card vp-card-pad">
          <div className="vp-balance-head"><Wallet color="#c5fb71" size={22} />
            <div><strong className="vp-card-title">Connected wallet</strong>
              <p className="vp-caption">{wallet.activeWalletName || 'Injected EVM wallet'}</p></div>
          </div>
          <div className="vp-stat-group" style={{ display: 'grid' }}>
            <div className="vp-stat"><span>ADDRESS</span><strong className="vp-mono vp-truncate">{wallet.address || 'Not connected'}</strong></div>
            <div className="vp-stat"><span>WALLET NETWORK</span><strong>{wallet.chainId === 5042002 ? 'Arc Testnet' : wallet.chainId ? `Chain ${wallet.chainId}` : 'Not connected'}</strong></div>
            <div className="vp-stat"><span>ARC TESTNET USDC</span><strong>{wallet.address ? (balance.loading ? 'Loading…' : balance.formatted ?? 'Unavailable') : '—'}</strong></div>
          </div>
          {balance.error && <p className="vp-form-error">{balance.error}</p>}
          {wallet.address && <button type="button" className="vp-secondary" style={{ marginTop: 15 }}
            onClick={() => window.open(`https://explorer.testnet.arc.io/address/${wallet.address}`, '_blank', 'noopener,noreferrer')}>
            View in Arc Explorer <ExternalLink size={14} />
          </button>}
        </div>
        <div className="vp-card vp-card-pad">
          <div className="vp-balance-head"><ShieldCheck color="#c5fb71" size={22} />
            <div><strong className="vp-card-title">Preview security</strong><p className="vp-caption">Your funds cannot move from this UI.</p></div>
          </div>
          <div className="vp-stack" style={{ gap: 12, marginTop: 22 }}>
            {[
              ['Injected wallet connection', 'Enabled'],
              ['Public Arc RPC balance reads', 'Enabled'],
              ['Direct Arc Testnet USDC Pay', 'Enabled · 1 USDC cap'],
              ['Swap / Bridge submission', 'Disabled'],
              ['Backend identity & receipts', 'Unavailable'],
              ['Mainnet financial actions', 'Disabled'],
            ].map(([item, value]) => (
              <div key={item} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, borderBottom: '1px solid var(--vp-border)', paddingBottom: 11 }}>
                <span className="vp-caption">{item}</span>
                <span style={{ color: value === 'Enabled' ? '#bfeb8d' : '#d3b08e', fontSize: 11, whiteSpace: 'nowrap' }}>{value}</span>
              </div>
            ))}
          </div>
        </div>
      </section>
      <div className="vp-form-note" style={{ marginTop: 18 }}>
        <LockKeyhole size={18} /> Wallet connect authorizes this site to see your public address. It does not prove a Veyra ID or authorize spending. To revoke the site's wallet permission, use your wallet's Connected Sites settings.
      </div>
    </div>
  );
}
