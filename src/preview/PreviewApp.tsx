/**
 * Dedicated connected-wallet / no-signature Vercel preview shell.
 *
 * This application is intentionally not the live App: it permits EIP-1193
 * account connection + public balance reads, while never importing BFF
 * clients, wallet signers, payment execution or bridge relay code.
 */
import { useEffect, useState, type ReactNode } from 'react';
import {
  Activity, ArrowLeftRight, ArrowRight, Bot, ChevronDown, Compass, CreditCard,
  Github, LayoutDashboard, LockKeyhole, Menu, Route, Settings2, ShieldCheck,
  Wallet, X,
} from 'lucide-react';
import { UiOnlyPreviewPage } from '../components/pages/UiOnlyPreviewPage';
import { PreviewTestnetPayPage } from './PreviewTestnetPayPage';
import { PreviewHome, PreviewActivity, PreviewSettings } from './PreviewSurfaces';
import { PreviewLiveAgent } from './PreviewLiveAgent';
import { PreviewServiceStatus } from './PreviewServiceStatus';
import {
  PreviewWalletProvider, shortPreviewAddress, usePreviewWallet,
} from './PreviewWallet';

export type PreviewPage = 'home' | 'pay' | 'convert' | 'bridge' | 'agent' | 'activity' | 'settings';
type NavigationItem = {
  id: PreviewPage;
  title: string;
  icon: typeof Compass;
};
const NAVIGATION: NavigationItem[] = [
  { id: 'home', title: 'Overview', icon: LayoutDashboard },
  { id: 'pay', title: 'Send & Pay', icon: CreditCard },
  { id: 'convert', title: 'Convert', icon: ArrowLeftRight },
  { id: 'bridge', title: 'Bridge USDC', icon: Route },
  { id: 'agent', title: 'AI Assistant', icon: Bot },
  { id: 'activity', title: 'Activity', icon: Activity },
];
const PAGE_LABEL: Record<PreviewPage, string> = {
  home: 'Overview', pay: 'Send & Pay', convert: 'Convert',
  bridge: 'Bridge USDC', agent: 'AI Assistant', activity: 'Activity',
  settings: 'Settings',
};

function BrandMark({ size = 36 }: { size?: number }) {
  return (
    <div className="vp-brand-mark" style={{ width: size, height: size }}>
      <svg viewBox="0 0 40 40" width={size * 0.72} height={size * 0.72} aria-hidden="true" fill="none">
        <path d="M6 11 18.8 31 34 8" stroke="currentColor" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M9 11 18.8 24 28 11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity=".45" />
      </svg>
    </div>
  );
}

export function PreviewWalletButton({ fullWidth = false }: { fullWidth?: boolean }) {
  const wallet = usePreviewWallet();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  async function choose(id: string) {
    await wallet.connect(id);
    setOpen(false);
  }
  async function copyAddress() {
    if (!wallet.address) return;
    try {
      await navigator.clipboard.writeText(wallet.address);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className={`vp-wallet-wrapper ${fullWidth ? 'vp-wallet-full' : ''}`}>
      <button type="button" className="vp-wallet-trigger" onClick={() => setOpen(true)}>
        <span className="vp-wallet-dot" />
        <Wallet size={17} />
        <span>{wallet.address ? shortPreviewAddress(wallet.address) : 'Connect Wallet'}</span>
        <ChevronDown size={15} />
      </button>
      {open && (
        <div className="vp-modal-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setOpen(false);
        }}>
          <div className="vp-modal" role="dialog" aria-modal="true" aria-label="Wallet connection">
            <div className="vp-modal-head">
              <div>
                <p className="vp-kicker">WALLET ACCESS</p>
                <h2>{wallet.address ? 'Your wallet' : 'Connect a wallet'}</h2>
              </div>
              <button className="vp-icon-button" aria-label="Close" onClick={() => setOpen(false)}><X size={18} /></button>
            </div>
            <p className="vp-caption">Connect an injected wallet to view Arc Testnet balances. A real testnet USDC payment, if you later choose to initiate one, requires a separate explicit wallet approval.</p>
            {wallet.address ? (
              <div className="vp-modal-wallet">
                <span className="vp-status-dot" />
                <div style={{ minWidth: 0 }}>
                  <strong>{wallet.activeWalletName || 'Connected wallet'}</strong>
                  <p className="vp-mono vp-truncate">{wallet.address}</p>
                  <span className="vp-muted">{wallet.chainId === 5042002 ? 'Arc Testnet' : `Wallet chain: ${wallet.chainId ?? 'Unknown'}`}</span>
                </div>
                <button className="vp-text-button" onClick={() => void copyAddress()}>{copied ? 'Copied' : 'Copy'}</button>
              </div>
            ) : (
              <div className="vp-wallet-list">
                {wallet.wallets.length ? wallet.wallets.map((item) => (
                  <button key={item.id} type="button" className="vp-wallet-option"
                    onClick={() => void choose(item.id)} disabled={wallet.busy}>
                    <span className="vp-wallet-option-icon"><Wallet size={18} /></span>
                    <span>{item.name}</span>
                    <ArrowRight size={17} />
                  </button>
                )) : (
                  <div className="vp-no-wallet">
                    <Wallet size={27} />
                    <strong>No browser wallet found</strong>
                    <p>Install or enable MetaMask, Rabby, or Coinbase Wallet, then refresh this page.</p>
                  </div>
                )}
              </div>
            )}
            {wallet.error && <p className="vp-form-error" role="alert">{wallet.error}</p>}
            {wallet.address && <button type="button" className="vp-secondary vp-full"
              onClick={() => { wallet.disconnect(); setOpen(false); }}>Hide wallet in Veyra</button>}
            <div className="vp-modal-note"><LockKeyhole size={16} /> Connecting only shares your public address. Direct testnet USDC Pay separately requires your explicit wallet approval; other financial actions stay disabled.</div>
          </div>
        </div>
      )}
    </div>
  );
}

function PreviewShell({ page, onNavigate, children }: {
  page: PreviewPage; onNavigate: (page: PreviewPage) => void; children: ReactNode;
}) {
  const wallet = usePreviewWallet();
  const [menuOpen, setMenuOpen] = useState(false);
  const select = (next: PreviewPage) => { onNavigate(next); setMenuOpen(false); };
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        select('agent');
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  return (
    <div className="vp-shell">
      <aside className={`vp-sidebar ${menuOpen ? 'vp-sidebar-open' : ''}`}>
        <button type="button" className="vp-brand" onClick={() => select('home')}>
          <BrandMark size={42} />
          <span className="vp-brand-text">veyra<span>.</span><small>YOUR MONEY, SIMPLIFIED</small></span>
        </button>
        <div className="vp-sidebar-section">WORKSPACE</div>
        <nav className="vp-main-nav" aria-label="Product navigation">
          {NAVIGATION.map(({ id, title, icon: Icon }) => (
            <button key={id} type="button" onClick={() => select(id)}
              className={`vp-nav-link ${page === id ? 'vp-nav-active' : ''}`}
              aria-current={page === id ? 'page' : undefined}>
              <Icon size={19} strokeWidth={page === id ? 2.2 : 1.8} />
              <span>{title}</span>
              {id === 'agent' && <span className="vp-nav-new">LAB</span>}
            </button>
          ))}
        </nav>
        <div className="vp-sidebar-bottom">
          <div className="vp-sidebar-card">
            <div className="vp-card-mini-icon"><ShieldCheck size={18} /></div>
            <strong>Explore safely</strong>
            <p>Direct Arc Testnet USDC Pay: max 1 token per transfer. Bridge and Convert still locked.</p>
            <span className="vp-safe-pill"><span /> TESTNET ONLY</span>
          </div>
          <button className={`vp-nav-link ${page === 'settings' ? 'vp-nav-active' : ''}`}
            onClick={() => select('settings')}>
            <Settings2 size={19} /> Settings
          </button>
          <a href="https://github.com/bearbaba/Veyra" target="_blank" rel="noreferrer"
            className="vp-github-link"><Github size={16} /> View source on GitHub <ArrowRight size={14} /></a>
        </div>
      </aside>
      {menuOpen && <button className="vp-sidebar-shade" type="button" onClick={() => setMenuOpen(false)} aria-label="Close menu" />}
      <div className="vp-main">
        <header className="vp-header">
          <div className="vp-header-heading">
            <button type="button" className="vp-menu-button" aria-label="Open navigation"
              onClick={() => setMenuOpen(true)}><Menu size={21} /></button>
            <span className="vp-header-breadcrumb">Workspace <span>/</span> <strong>{PAGE_LABEL[page]}</strong></span>
          </div>
          <div className="vp-header-actions">
            <span className="vp-network-pill"><span className="vp-network-dot" /> Arc Testnet</span>
            <PreviewWalletButton />
          </div>
        </header>
        <div className="vp-preview-ribbon">
          <div><ShieldCheck size={16} /><strong>ARC TESTNET BETA</strong><span>Real capped USDC Pay via your wallet; Convert and Bridge remain read-only until independently verified.</span></div>
          <span className="vp-ribbon-tag">TESTNET</span>
        </div>
        <main className="vp-content" id="content">{children}</main>
        <footer className="vp-footer">
          <span>© Veyra · Built for Arc</span>
          <span>{wallet.address ? `Connected: ${shortPreviewAddress(wallet.address)}` : 'Connect a wallet to view live balances'} · Capped testnet Pay only</span>
        </footer>
      </div>
    </div>
  );
}

function PreviewWorkspace() {
  const [page, setPage] = useState<PreviewPage>('home');
  function render() {
    switch (page) {
      case 'home': return <PreviewHome onNavigate={setPage} />;
      case 'agent': return <PreviewLiveAgent onNavigate={setPage} />;
      case 'pay': return import.meta.env.VITE_VEYRA_TESTNET_PAY === '1'
        ? <PreviewTestnetPayPage /> : <UiOnlyPreviewPage surface="pay" />;
      case 'convert':
      case 'bridge': return <PreviewServiceStatus surface={page} onNavigate={setPage} />;
      case 'activity': return <PreviewActivity onNavigate={setPage} />;
      case 'settings': return <PreviewSettings />;
      default: return <PreviewHome onNavigate={setPage} />;
    }
  }
  return <PreviewShell page={page} onNavigate={setPage}>{render()}</PreviewShell>;
}

export function PreviewApp() {
  return (
    <PreviewWalletProvider>
      <PreviewWorkspace />
    </PreviewWalletProvider>
  );
}
