import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { quickConnectWallet, type IdentityWallet } from '../identity-beta/walletDiscovery';
import type { BrowserProvider } from '../identity-beta/protocol';

const provider = (id: string): BrowserProvider => ({
  request() { return Promise.resolve(id); },
});
const meta: IdentityWallet = { id: 'mm', name: 'MetaMask', source: 'eip6963', provider: provider('mm') };
const rabby: IdentityWallet = { id: 'rb', name: 'Rabby', source: 'eip6963', provider: provider('rb') };
const unknown: IdentityWallet = { id: 'legacy', name: 'Legacy injected wallet', source: 'legacy', provider: provider('legacy') };
const app = readFileSync(new URL('../identity-beta/IdentityBetaApp.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../identity-beta/styles.css', import.meta.url), 'utf8');

describe('Phase 8Q minimal, secure Veyra ID UX', () => {
  it('connects in one click with one wallet, or a uniquely announced MetaMask', () => {
    expect(quickConnectWallet([meta])?.id).toBe('mm');
    expect(quickConnectWallet([meta,rabby])?.id).toBe('mm');
    expect(quickConnectWallet([meta,rabby,unknown])?.id).toBe('mm');
    expect(quickConnectWallet([unknown])?.id).toBe('legacy');
    expect(quickConnectWallet([rabby,unknown])?.id).toBe('rb');
  });

  it('never silently picks between ambiguous wallet providers', () => {
    expect(quickConnectWallet([])).toBeNull();
    expect(quickConnectWallet([rabby, { ...rabby, id: 'second', name: 'Phantom' }])).toBeNull();
    expect(quickConnectWallet([{ ...meta }, { ...meta, id: 'm2' }])).toBeNull();
    expect(quickConnectWallet([unknown, { ...unknown, id: 'legacy2' }])).toBeNull();
  });

  it('does not require a pre-connect select; shows a compact choice only when ambiguous', () => {
    expect(app).not.toContain('SELECT WALLET EXTENSION');
    expect(app).not.toContain('<select aria-label="Select wallet extension"');
    expect(app).toContain('const chosen = walletId ? walletToConnect(wallets, walletId) : quickConnectWallet(wallets)');
    expect(app).toContain('if (!chosen) { setShowWalletChoices(true); return; }');
    expect(app).toContain('onClick={()=>void connect()}');
    expect(app).toContain('Other wallets');
    expect(app).toContain('role="group" aria-label="Available wallet extensions"');
  });

  it('keeps unavailable X OAuth visibly disabled without offering a broken button', () => {
    expect(app).toContain('const X_LINKING_AVAILABLE = false;');
    expect(app).toContain('Not available yet');
    expect(app).toContain('X_LINKING_AVAILABLE && !session.profile.x');
    expect(app).toContain("session.profile.x.xHandle");
    expect(app).not.toContain('Link your X account</h2>');
  });

  it('removes repetitive intro/stepper, retains same-ID and guarded wallet signing', () => {
    expect(app).toContain('One identity.');
    expect(app).not.toContain('className="vi-steps"');
    expect(app).not.toContain('Your identity.<br/>');
    expect(app).toContain('signReviewedIdentity(');
    expect(app).toContain('await requireMatchingAccount(');
    expect(app).toContain('onClick={stopWaiting}>Stop waiting');
    expect(app).not.toContain('eth_sendTransaction');
    expect(css).toContain('.vi-x-inline');
    expect(css).toContain('.vi-wallet-choices');
  });
});
