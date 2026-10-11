/**
 * No mocked prices, transactions, attestation, mint or success indicators.
 * Production bridge/FX capabilities require a separately hosted BFF,
 * Circle credentials, database migrations and wallet-signed acceptance.
 */
import { ArrowRight, ExternalLink, LockKeyhole, Route, ShieldAlert } from 'lucide-react';
import type { PreviewPage } from './PreviewApp';

export function PreviewServiceStatus({
  surface, onNavigate,
}: {
  surface: 'convert' | 'bridge';
  onNavigate: (page: PreviewPage) => void;
}) {
  const bridge = surface === 'bridge';
  return (
    <div className="vp-page" style={{ maxWidth: 950 }}>
      <div className="vp-page-heading">
        <div>
          <p className="vp-eyebrow">VEYRA TESTNET BETA · SERVICE GATE</p>
          <h1 className="vp-page-title">{bridge ? 'Bridge USDC' : 'Convert assets'}</h1>
          <p className="vp-page-description">
            {bridge
              ? 'Cross-chain USDC requires verified Circle attestations, destination mint evidence, and crash-safe recovery.'
              : 'Live asset conversion requires fresh quotes, bounded slippage, and independent transaction verification.'}
          </p>
        </div>
        <span className="vp-chain-pill"><LockKeyhole size={15} /> Awaiting live acceptance</span>
      </div>
      <div className="vp-card vp-card-pad" style={{ borderColor: 'rgba(232,182,98,.25)' }}>
        <div className="vp-balance-head" style={{ marginBottom: 18 }}>
          <span className="vp-quick-icon" style={{ color: '#e8b98d', background: '#403128' }}>
            {bridge ? <Route size={22} /> : <ShieldAlert size={22} />}
          </span>
          <div>
            <strong className="vp-card-title" style={{ fontSize: 17 }}>
              Live execution is not available on this Preview
            </strong>
            <p className="vp-caption">
              No fabricated quotes, simulated success, or fake signing buttons.
            </p>
          </div>
        </div>
        <p className="vp-caption">
          The Express BFF exists in the repository, but this static Vite Preview does not
          deploy PostgreSQL, Circle integrations, or authenticated execution services.
          Enabling transfers before those systems are verified risks stuck funds and false success reports.
        </p>
        <div className="vp-stack" style={{ marginTop: 20, gap: 12 }}>
          {(bridge
            ? [
                'Deploy the HTTPS BFF and PostgreSQL; run migrations and verify authentication.',
                'Verify Arc source burn, Circle attestation, and destination mint with a testnet wallet.',
                'Test duplicate-burn prevention, uncertain retries, and durable ActivityReceipts.',
              ]
            : [
                'Connect a real FX quote provider through the authenticated BFF.',
                'Validate quote expiry, fees, slippage, and server-side policy.',
                'Verify on-chain transaction receipts and liquidity failure handling.',
              ]
          ).map((item, i) => (
            <div className="vp-step" key={item}>
              <span className="vp-step-number">{i + 1}</span>
              <strong style={{ fontSize: 12 }}>{item}</strong>
            </div>
          ))}
        </div>
        <div className="vp-form-note" style={{ marginTop: 20 }}>
          <LockKeyhole size={18} style={{ flex: 'none' }} />
          <span>
            This feature remains locked until its live deployment evidence is accepted.
            This page never requests a wallet signature or moves funds.
          </span>
        </div>
        <div className="vp-hero-buttons">
          <button type="button" className="vp-primary" onClick={() => onNavigate('pay')}>
            Open live Arc Testnet Pay <ArrowRight size={15} />
          </button>
          <a href="https://github.com/bearbaba/Veyra/pull/7"
            target="_blank" rel="noopener noreferrer" className="vp-secondary">
            Track Bridge / FX progress <ExternalLink size={14} />
          </a>
        </div>
      </div>
    </div>
  );
}
