/**
 * Phase 7A — one unified, honest asset/chain discovery view.
 * A catalog entry never implies a live portfolio balance or swap execution.
 */
import { useEffect, useState } from 'react';
import { ArrowUpRight, CheckCircle2, ExternalLink, Layers3, RefreshCw, Search, ShieldCheck } from 'lucide-react';
import { formatUnits } from 'viem';
import { BrandLogo } from '../components/brand/BrandLogo';
import { usePreviewArcBalance, usePreviewWallet } from './PreviewWallet';
import { readMainnetBalance } from './arcMainnetReadOnly';
import {
  filterUnifiedCatalog, unifiedChains, UNIFIED_ASSETS,
  type UnifiedEnvironment, type UnifiedStatus,
} from './unifiedAssetCatalog';

function CapabilityTag({ status }: { status: UnifiedStatus }) {
  return <span className={status === 'ARC_BALANCE_READ' ? 'vp-unified-tag vp-unified-live' : 'vp-unified-tag'}>
    {status === 'ARC_BALANCE_READ' ? 'Arc balance read' : 'Catalog only'}
  </span>;
}
function UnifiedArcBalance({ environment }: { environment: UnifiedEnvironment }) {
  const wallet = usePreviewWallet();
  const testnet = usePreviewArcBalance(environment === 'testnet' ? wallet.address : null);
  const [mainnet, setMainnet] = useState<{ value: string | null; error: string | null; loading: boolean }>({
    value: null, error: null, loading: false,
  });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (environment !== 'mainnet' || !wallet.address) {
      setMainnet({ value: null, error: null, loading: false });
      return;
    }
    let disposed = false;
    const account = wallet.address;
    setMainnet({ value: null, error: null, loading: true });
    void readMainnetBalance(account).then(snapshot => {
      if (!disposed) setMainnet({ value: formatUnits(snapshot.units, 6), error: null, loading: false });
    }).catch(() => {
      if (!disposed) setMainnet({ value: null, error: 'Mainnet RPC unavailable', loading: false });
    });
    return () => { disposed = true; };
  }, [environment, wallet.address, revision]);

  const selected = environment === 'testnet'
    ? { value: testnet.formatted, error: testnet.error, loading: testnet.loading }
    : mainnet;
  const expectedChain = environment === 'testnet' ? 5042002 : 5042;
  return <div className="vp-card vp-card-pad vp-unified-balance">
    <div className="vp-balance-head">
      <BrandLogo logoKey="usdc" size={40}/>
      <div style={{ flex: 1 }}>
        <p className="vp-balance-label">VERIFIED ARC READ</p>
        <strong className="vp-card-title">{environment === 'testnet' ? 'Arc Testnet' : 'Arc Mainnet'} USDC</strong>
      </div>
      <button type="button" className="vp-icon-button" title="Refresh Arc USDC"
        aria-label="Refresh Unified USDC balance" disabled={!wallet.address || selected.loading}
        onClick={() => environment === 'testnet' ? testnet.refresh() : setRevision(value => value + 1)}>
        <RefreshCw size={16}/>
      </button>
    </div>
    <div className="vp-balance-value">
      {!wallet.address ? '—' : selected.loading ? '···' : selected.value ?? '—'}<span> USDC</span>
    </div>
    <p className="vp-balance-sub">{!wallet.address
      ? 'Connect a wallet to read its public Arc USDC balance.'
      : selected.error ?? 'Actual public Arc USDC balanceOf; no wallet signature or other assets inferred.'}</p>
    {wallet.address && wallet.chainId !== expectedChain &&
      <p className="vp-unified-notice">Your wallet is on chain {wallet.chainId ?? 'unknown'}.
        This is an independent public read on Arc chain {expectedChain}, not your wallet's currently selected network.</p>}
  </div>;
}

export function PreviewUnified({ environment }: { environment: UnifiedEnvironment }) {
  const [query, setQuery] = useState('');
  const [view, setView] = useState<'assets' | 'networks'>('assets');
  const assets = filterUnifiedCatalog(UNIFIED_ASSETS, query, asset => asset.symbol);
  const chains = filterUnifiedCatalog(unifiedChains(environment), query, chain => String(chain.chainId));
  return <div className="vp-page vp-unified">
    <div className="vp-page-heading">
      <div>
        <p className="vp-eyebrow">VEYRA / UNIFIED</p>
        <h1 className="vp-page-title">Your assets. One clear view.</h1>
        <p className="vp-page-description">
          Explore recognized assets and networks in one place. Only Arc USDC has a verified live balance reader.
          Catalog entries are not swap, bridge or spending permissions.
        </p>
      </div>
      <span className="vp-chain-pill"><ShieldCheck size={15}/> {environment === 'testnet' ? 'Arc Testnet' : 'Arc Mainnet · Read only'}</span>
    </div>
    <div className="vp-grid-2 vp-unified-intro">
      <UnifiedArcBalance environment={environment}/>
      <div className="vp-card vp-card-pad vp-unified-overview">
        <div className="vp-balance-head">
          <span className="vp-quick-icon"><Layers3 size={21}/></span>
          <div><strong className="vp-card-title">Explore, then verify</strong>
            <p className="vp-caption">A transparent foundation for future multi-chain portfolios.</p></div>
        </div>
        <div className="vp-stat-group">
          <div className="vp-stat"><span>ASSETS IN CATALOG</span><strong>{UNIFIED_ASSETS.length}</strong></div>
          <div className="vp-stat"><span>NETWORKS IN THIS ENVIRONMENT</span><strong>{unifiedChains(environment).length}</strong></div>
          <div className="vp-stat"><span>LIVE BALANCE SOURCES</span><strong>Arc USDC only</strong></div>
        </div>
        <p className="vp-unified-notice">Other coins and networks are discovery metadata. Their balances, prices, swaps, CCTP routes and identity-linked holdings are not indexed or enabled here.</p>
      </div>
    </div>
    <section className="vp-card vp-card-pad vp-unified-directory">
      <div className="vp-unified-toolbar">
        <div>
          <h2 className="vp-card-title">Asset & network directory</h2>
          <p className="vp-caption">Officially curated labels, unmistakable capability states.</p>
        </div>
        <label className="vp-unified-search">
          <Search size={16}/>
          <span className="vp-sr-only">Search assets or networks</span>
          <input type="search" value={query} onChange={event => setQuery(event.target.value)}
            placeholder="Search assets or networks" aria-label="Search assets or networks"/>
        </label>
      </div>
      <div className="vp-unified-tabs" role="group" aria-label="Unified catalog type">
        <button type="button" aria-pressed={view === 'assets'} className={view === 'assets' ? 'vp-unified-tab-active' : ''}
          onClick={() => setView('assets')}>Assets <span>{UNIFIED_ASSETS.length}</span></button>
        <button type="button" aria-pressed={view === 'networks'} className={view === 'networks' ? 'vp-unified-tab-active' : ''}
          onClick={() => setView('networks')}>Networks <span>{unifiedChains(environment).length}</span></button>
      </div>
      <div className="vp-unified-list" aria-live="polite">
        {view === 'assets' ? assets.map(asset => <div className="vp-unified-row" key={asset.id}>
          <BrandLogo logoKey={asset.logoKey} size={36}/>
          <div className="vp-unified-row-copy"><strong>{asset.symbol}</strong><span>{asset.name}</span></div>
          <CapabilityTag status={asset.status}/>
        </div>) : chains.map(chain => <div className="vp-unified-row" key={chain.id}>
          <BrandLogo logoKey={chain.logoKey} size={36}/>
          <div className="vp-unified-row-copy"><strong>{chain.name}</strong><span>Chain ID {chain.chainId}</span></div>
          <CapabilityTag status={chain.status}/>
        </div>)}
        {((view === 'assets' && !assets.length) || (view === 'networks' && !chains.length)) &&
          <div className="vp-empty-state"><Search size={22}/><h3>No matching results</h3>
            <p>Try another name, ticker, or chain ID. No unknown token contract is added automatically.</p></div>}
      </div>
      <p className="vp-unified-footnote"><CheckCircle2 size={14}/> Live balances are pinned to Arc USDC only.
        Cross-chain positions, fiat valuations and actionable swaps will require separately verified providers.
        <a href="https://github.com/bearbaba/Veyra" target="_blank" rel="noreferrer"> Review source <ExternalLink size={12}/></a>
      </p>
    </section>
    <p className="vp-caption">An asset's presence in this directory is not a listing recommendation, proof of authenticity on every chain, or evidence of Veyra trading support. <ArrowUpRight size={12} style={{ display: 'inline' }}/></p>
  </div>;
}
