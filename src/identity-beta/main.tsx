/** Dedicated Testnet identity entry; unrelated to existing Vercel financial preview. */
import { Component, StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { IdentityBetaApp } from './IdentityBetaApp';
import './styles.css';

/**
 * Wallet providers and remote profiles are outside React's control. If an
 * unexpected render error occurs, keep an actionable, readable screen instead
 * of losing the entire identity UI to a blank canvas.
 * Never show raw exception details, signatures, account data or tokens.
 */
class IdentityRenderBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return (
        <main className="vi-fallback" role="alert">
          <div className="vi-fallback-mark" aria-hidden="true">V</div>
          <h1>Veyra needs to reload</h1>
          <p>Your identity session stays in memory only. Reload to reconnect your wallet safely. No payments or transfers were initiated.</p>
          <button type="button" onClick={() => window.location.reload()}>Reload Veyra</button>
          <small>If this repeats, please report it through the Veyra GitHub repository without sharing wallet signatures or access tokens.</small>
          <a href="https://github.com/bearbaba/Veyra/issues" target="_blank" rel="noopener noreferrer">Report an issue</a>
        </main>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <IdentityRenderBoundary><IdentityBetaApp /></IdentityRenderBoundary>
  </StrictMode>,
);
