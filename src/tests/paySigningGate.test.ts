import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PREVIEW_BODY, PREVIEW_BUTTON, signingNotice } from '../mainnet/exchangeSigningGate';
import { PAY_PREVIEW_HEADLINE, payPreviewNotice, paySigningBlock } from '../mainnet/paySigningGate';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const page = read('src/components/pages/SettlementPage.tsx');

describe('Pay signing availability (display)', () => {
  it('Mainnet outside the Production release is a Preview', () => {
    for (const releaseEnv of ['preview', 'local', 'development', '', 'PRODUCTION', 'production ']) {
      expect(paySigningBlock({ mainnet: true, releaseEnv }), releaseEnv).toBe('preview');
    }
  });

  it('the Production release is not blocked by this display rule', () => {
    expect(paySigningBlock({ mainnet: true, releaseEnv: 'production' })).toBeNull();
  });

  it('other networks are unaffected', () => {
    for (const releaseEnv of ['production', 'preview', 'local']) {
      expect(paySigningBlock({ mainnet: false, releaseEnv })).toBeNull();
    }
  });
});

describe('Pay uses the same wording and banner as Swap and Bridge', () => {
  it('the explanation and the disabled-button label are shared', () => {
    expect(payPreviewNotice.body).toBe(PREVIEW_BODY);
    expect(payPreviewNotice.buttonLabel).toBe(PREVIEW_BUTTON);
    expect(payPreviewNotice.buttonLabel).toBe('Signing disabled in Preview');
    expect(signingNotice('preview').body).toBe(payPreviewNotice.body);
  });

  it('says review is available, not quotes, and never calls a Preview a pause', () => {
    expect(PAY_PREVIEW_HEADLINE).toBe('Preview mode — payment review available, wallet signing disabled.');
    expect(JSON.stringify(payPreviewNotice)).not.toMatch(/paused/i);
    expect(payPreviewNotice.body).toMatch(/only through the authorized Production release/);
  });

  it('Pay and Exchange draw the notice with the same component', () => {
    expect(page).toContain('<SigningNoticeBanner');
    expect(read('src/components/pages/MainnetExchangePage.tsx')).toContain('<SigningNoticeBanner');
  });
});

describe('Production signing permissions are unchanged', () => {
  it('both signing handlers still refuse outside Production, before any wallet call', () => {
    const approve = page.slice(page.indexOf('async function handleApprove'), page.indexOf('async function handleSettle'));
    const settle = page.slice(page.indexOf('async function handleSettle'));
    for (const body of [approve, settle]) {
      const guard = body.indexOf("__VEYRA_RELEASE_ENV__!=='production'");
      const wallet = Math.min(...['writeContractAsync', 'switchChainAsync', 'walletClient', 'sendTransaction']
        .map((m) => body.indexOf(m)).filter((i) => i >= 0));
      expect(guard, 'release guard present').toBeGreaterThan(-1);
      expect(guard, 'guard runs before any wallet call').toBeLessThan(wallet);
    }
    expect((page.match(/Mainnet Settlement signing is disabled in Preview and local builds\./g) ?? []).length).toBe(2);
  });

  it('the Preview only DISABLES the two signing buttons; it never enables or reroutes anything', () => {
    expect(page).toContain('disabled={approving || previewBlocked}');
    expect(page).toContain('disabled={settling || previewBlocked}');
    expect(page).toContain("payPreviewNotice.buttonLabel");
    // The handlers are still the only thing the buttons call.
    expect(page).toContain('onClick={() => { void handleApprove(); }}');
    expect(page).toContain('onClick={() => { void handleSettle(); }}');
  });

  it('Review stays available: the Review button is not tied to the Preview flag', () => {
    const reviewButton = page.slice(page.indexOf('disabled={!canReview'), page.indexOf('disabled={!canReview') + 120);
    expect(reviewButton).not.toContain('previewBlocked');
  });

  it('the display rule mirrors the handler guard exactly', () => {
    expect(page).toContain("paySigningBlock({ mainnet: VEYRA_ENV === 'mainnet', releaseEnv: __VEYRA_RELEASE_ENV__ }) === 'preview'");
  });
});
