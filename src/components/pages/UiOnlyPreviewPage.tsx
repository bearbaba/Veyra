/**
 * Connected-preview financial flow forms.
 * These are intentionally not transaction execution modules: no wallet
 * signer, approvals, quotes from a BFF, CCTP submission or chain writes.
 */
import { useState } from 'react';
import {
  ArrowDown, ArrowLeftRight, ArrowRight, CheckCircle2, CreditCard,
  Info, LockKeyhole, Route, SendHorizontal, ShieldCheck, Wallet,
} from 'lucide-react';
import { usePreviewWallet, shortPreviewAddress } from '../../preview/PreviewWallet';
import { BrandLogo } from '../brand/BrandLogo';

export type UiOnlyPreviewSurface = 'pay' | 'convert' | 'bridge';

const TITLES = {
  pay: ['Send & Pay', 'Send money, not complexity.', 'Send USDC to a person or wallet. Veyra handles the route and review in the full product.'],
  convert: ['Convert', 'Trade smarter, not harder.', 'Review an exchange before you act. Live prices and conversions require a verified provider.'],
  bridge: ['Bridge USDC', 'Move between networks.', 'A clear path from Arc Testnet to Ethereum Sepolia or Base Sepolia, powered by Circle CCTP.'],
} as const;

export function UiOnlyPreviewPage({ surface }: { surface: UiOnlyPreviewSurface }) {
  const wallet = usePreviewWallet();
  const [amount, setAmount] = useState('');
  const [recipient, setRecipient] = useState('');
  const [destination, setDestination] = useState<'Ethereum Sepolia' | 'Base Sepolia'>('Ethereum Sepolia');
  const [asset, setAsset] = useState<'EURC' | 'USDC'>('EURC');
  const [review, setReview] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validated, setValidated] = useState(false);
  const Icon = surface === 'pay' ? SendHorizontal : surface === 'bridge' ? Route : ArrowLeftRight;
  const [eyebrow, title, subtitle] = TITLES[surface];

  function previewReview() {
    setReview(false);
    setError(null);
    if (!wallet.address) {
      setError('Connect a browser wallet in the top right to preview this flow.');
      return;
    }
    if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,6})?$/.test(amount) || Number(amount) <= 0) {
      setError('Enter a positive amount with no more than six decimal places.');
      return;
    }
    if (surface === 'pay' && !recipient.trim()) {
      setError('Enter a recipient wallet or handle to preview the payment.');
      return;
    }
    setValidated(true);
    setReview(true);
  }

  const steps = surface === 'pay'
    ? [['Recipient', 'Resolve the verified identity'], ['Policy', 'Check asset, network and balance'], ['Approval', 'Wallet signs only in full testnet'], ['Receipt', 'Verify the actual chain transaction']]
    : surface === 'bridge'
      ? [['Source', 'Verify one original Arc USDC burn'], ['Attestation', 'Verify the Circle message'], ['Destination', 'Verify mint on the destination chain'], ['Recovery', 'Reconcile without duplicate burns']]
      : [['Request', 'Choose amount and desired asset'], ['Quote', 'Compare live routes & fees'], ['Review', 'Enforce slippage and expiry limits'], ['Receipt', 'Verify actual settlement']];

  return (
    <div className="vp-page" style={{ maxWidth: 1050 }}>
      <div className="vp-page-heading">
        <div><p className="vp-eyebrow">{eyebrow.toUpperCase()} · ARC TESTNET</p>
          <h1 className="vp-page-title">{title}</h1>
          <p className="vp-page-description">{subtitle}</p></div>
        <span className="vp-chain-pill"><LockKeyhole size={14} /> Preview · execution locked</span>
      </div>

      <div className="vp-grid-2">
        <section className="vp-card vp-card-pad vp-stack" aria-label={eyebrow}>
          <div className="vp-balance-head">
            <span className="vp-quick-icon" style={{ color: '#c5fb71', background: '#253326' }}><Icon size={22} /></span>
            <div><strong className="vp-card-title">{surface === 'pay' ? 'New payment' : surface === 'bridge' ? 'Cross-chain transfer' : 'Asset conversion'}</strong>
              <p className="vp-caption">Connected wallet · interactive review only</p></div>
          </div>

          <div className="vp-form-grid">
            {surface === 'pay' && (
              <div>
                <label className="vp-form-label" htmlFor="vp-pay-recipient">Recipient</label>
                <input id="vp-pay-recipient" className="vp-form-input" value={recipient}
                  onChange={(e) => { setRecipient(e.target.value); setValidated(false); }}
                  placeholder="@username or 0x wallet address" maxLength={128} />
                <p className="vp-caption" style={{ marginTop: 6 }}>Recipient resolution is not active until the identity backend is verified.</p>
              </div>
            )}

            {surface === 'bridge' && (
              <div>
                <label className="vp-form-label">Destination network</label>
                <div className="vp-segmented">
                  {(['Ethereum Sepolia', 'Base Sepolia'] as const).map((option) =>
                    <button type="button" key={option} aria-pressed={destination === option}
                      onClick={() => { setDestination(option); setValidated(false); }}>{option}</button>)}
                </div>
              </div>
            )}

            {surface === 'convert' && (
              <div>
                <label className="vp-form-label" htmlFor="vp-convert-out">You receive (indicative asset)</label>
                <select id="vp-convert-out" className="vp-form-select" value={asset}
                  onChange={(e) => { setAsset(e.target.value as 'EURC' | 'USDC'); setValidated(false); }}>
                  <option value="EURC">EURC · Euro Coin</option>
                  <option value="USDC">USDC · USD Coin</option>
                </select>
              </div>
            )}

            <div>
              <label className="vp-form-label" htmlFor="vp-payment-amount">
                {surface === 'convert' ? 'You convert' : surface === 'bridge' ? 'Amount to bridge' : 'Payment amount'}
              </label>
              <div style={{ position: 'relative' }}>
                <input id="vp-payment-amount" className="vp-form-input" value={amount}
                  onChange={(e) => { setAmount(e.target.value); setValidated(false); }}
                  placeholder="0.00" inputMode="decimal" style={{ paddingRight: 92 }} />
                <div style={{ position: 'absolute', right: 13, top: 0, bottom: 0, display: 'flex', alignItems: 'center', gap: 7, pointerEvents: 'none', fontSize: 12, fontWeight: 750 }}>
                  <BrandLogo logoKey="usdc" size={21} /> USDC
                </div>
              </div>
            </div>

            <div>
              <label className="vp-form-label">From wallet</label>
              <div className="vp-wallet-summary">
                <Wallet size={17} color="#c5fb71" />
                <span style={{ flex: 1, fontSize: 12 }}>
                  {wallet.address ? shortPreviewAddress(wallet.address) : 'Not connected'}
                </span>
                <span className="vp-muted">{wallet.chainId === 5042002 ? 'Arc Testnet' : 'Arc route preview'}</span>
              </div>
            </div>

            <div className="vp-form-note">
              <Info size={17} style={{ flex: 'none' }} />
              <div>{surface === 'pay'
                ? 'This form does not resolve recipients or hold funds. Review is illustrative until the authenticated payment backend is connected.'
                : surface === 'bridge'
                  ? 'Real Circle attestations, route fees and destination mint receipts require the secure bridge backend.'
                  : 'Live StableFX quotes, real prices, expiration and execution are not available in this Preview.'}</div>
            </div>

            {error && <p className="vp-form-error" role="alert">{error}</p>}
            <button type="button" className="vp-primary vp-full" onClick={previewReview}>
              <ShieldCheck size={16} /> {wallet.address ? 'Review preview' : 'Connect wallet to preview'} <ArrowRight size={15} />
            </button>
          </div>
          {review && validated && (
            <div className="vp-card" style={{ background: '#1a2830', padding: 17, borderColor: 'rgba(195,250,124,.24)' }} role="status">
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 10 }}>
                <CheckCircle2 size={18} color="#c5fb71" /><strong style={{ fontSize: 13 }}>Review created — no transaction sent</strong>
              </div>
              <p className="vp-caption">{amount} USDC {surface === 'pay' ? `to ${recipient}` : surface === 'bridge' ? `from Arc Testnet to ${destination}` : `→ ${asset} (no quote available)`}</p>
              <p className="vp-form-success">No payment signatures or broadcasts are possible in this build.</p>
            </div>
          )}
        </section>

        <aside className="vp-stack">
          <div className="vp-card vp-card-pad">
            <h2 className="vp-card-title" style={{ fontSize: 15 }}>How it works</h2>
            <p className="vp-caption" style={{ marginTop: 6 }}>See how Veyra protects every step before execution.</p>
            <div style={{ marginTop: 16 }}>{steps.map(([head, desc], i) => (
              <div className="vp-step" key={head}>
                <span className="vp-step-number">{String(i + 1).padStart(2, '0')}</span>
                <div><strong>{head}</strong><p>{desc}</p></div>
              </div>
            ))}</div>
          </div>
          {surface === 'bridge' && (
            <div className="vp-card vp-card-pad">
              <h2 className="vp-card-title" style={{ fontSize: 14 }}>Selected route</h2>
              <div className="vp-route">
                <span className="vp-chain-logo vp-chain-arc">A</span>
                <div className="vp-route-line" /><ArrowDown size={15} color="#beaeff" />
                <div className="vp-route-line" />
                <span className={`vp-chain-logo ${destination === 'Base Sepolia' ? 'vp-chain-base' : 'vp-chain-eth'}`}>{destination === 'Base Sepolia' ? 'B' : 'Ξ'}</span>
              </div>
              <p className="vp-caption">Arc Testnet → {destination}</p>
              <p className="vp-muted" style={{ marginTop: 8 }}>Route preview only; CCTP cannot execute here.</p>
            </div>
          )}
          <div className="vp-form-note"><LockKeyhole size={18} style={{ flex: 'none' }} />
            <div><strong>Non-custodial and non-signing</strong><p style={{ marginTop: 4 }}>Wallet connection allows only public address access and Arc balance reads. Payments and bridges require a separately approved testnet release.</p></div>
          </div>
        </aside>
      </div>
    </div>
  );
}
