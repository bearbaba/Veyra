/**
 * Additional read-only Base wallet-held USDC within Unified.
 * Do not add these amounts to Circle Gateway pooled balances.
 * Failed/rate-limited reads must never appear as zero holdings.
 */
import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { formatUnits } from 'viem';
import { BrandLogo } from '../components/brand/BrandLogo';
import { usePreviewWallet } from './PreviewWallet';
import {
  getBaseUsdcNetwork, readBaseUsdcBalance,
  type BaseUsdcEnvironment, type BaseUsdcSnapshot,
} from './baseUsdcReadOnly';

export function PreviewBaseUsdcBalance({ environment }: { environment: BaseUsdcEnvironment }) {
  const wallet = usePreviewWallet();
  const network = getBaseUsdcNetwork(environment);
  const [revision, setRevision] = useState(0);
  const [snapshot, setSnapshot] = useState<BaseUsdcSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setSnapshot(null);
    setError(null);
    if (!wallet.address) {
      setLoading(false);
      return () => controller.abort();
    }
    setLoading(true);
    void readBaseUsdcBalance(wallet.address, environment, { signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) setSnapshot(result);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setError(reason instanceof Error ? reason.message : 'Base USDC temporarily unavailable.');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [environment, wallet.address, revision]);

  return <section className="vp-card vp-card-pad vp-unified-base" aria-label="Base USDC balance">
    <div className="vp-balance-head">
      <BrandLogo logoKey="base" size={37}/>
      <div style={{ flex: 1 }}>
        <p className="vp-balance-label">SECOND NETWORK · READ ONLY</p>
        <strong className="vp-card-title">{network.name} · USDC</strong>
      </div>
      <button type="button" className="vp-icon-button" disabled={!wallet.address || loading}
        title="Refresh Base balance" aria-label="Refresh Base USDC balance"
        onClick={() => setRevision(value => value + 1)}>
        <RefreshCw size={16}/>
      </button>
    </div>
    <div className="vp-balance-value">
      {!wallet.address ? '—' : loading ? '···' : snapshot
        ? formatUnits(snapshot.amountUnits, snapshot.decimals) : '—'}
      <span> USDC</span>
    </div>
    <p className="vp-balance-sub" aria-live="polite">
      {!wallet.address
        ? 'Connect a wallet to inspect its public USDC balance on this network.'
        : loading ? 'Reading verified Circle-issued USDC contract on Base…'
          : error ? `Unavailable — ${error}`
            : snapshot ? `Read at Base block ${snapshot.blockNumber.toString()} · ${new Date(snapshot.observedAt).toLocaleTimeString()}`
              : 'No verified Base balance has been read.'}
    </p>
    <p className="vp-unified-notice">
      Uses the same public EVM wallet address on {network.name} (chain {network.chainId});
      this does not switch your wallet, transfer USDC, or query a Circle Gateway deposit.
      Public RPC access is rate-limited.
    </p>
  </section>;
}
