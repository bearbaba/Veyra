import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { evaluateBrowserOrigin } from '../../server/middleware/browserOriginPolicy';

const read=(path:string)=>readFileSync(new URL('../../'+path,import.meta.url),'utf8');

describe('Phase 25 — untrusted Preview identity and Bridge safety UX',()=>{
  it('enforces exact browser origin and never trusts arbitrary ephemeral previews',()=>{
    const stable='https://veyra-unified-testnet-v2.vercel.app';
    const preview='https://veyra-unified-testnet-v2-9ij2jfier-khaiptk1998-8088s-projects.vercel.app';
    expect(evaluateBrowserOrigin(stable,stable,true).allowed).toBe(true);
    expect(evaluateBrowserOrigin(preview,stable,true).allowed).toBe(false);
    expect(evaluateBrowserOrigin(preview,'*',true).allowed).toBe(false);
  });
  it('keeps the untrusted Bridge draft editable but disables review before signing',()=>{
    const page=read('src/components/pages/BridgePage.tsx');
    expect(page).toContain("const bridgeOriginUnavailable = IS_UI_ONLY_PREVIEW");
    expect(page).toContain("social.identityOrigin === 'origin_blocked'");
    expect(page).toContain("const bridgeIdentityReady = !bridgeOriginUnavailable");
    expect(page).toContain("!bridgeIdentityReady || bridgeState.phase === 'EVALUATING'");
    expect(page).toContain('Bridge unavailable on this Preview');
    expect(page).toContain('Your draft has not been submitted.');
    expect(page).toContain('<VeyraIdentityAccess />');
    expect(page).toContain("setDestChainId(Number(e.target.value)); setBridgeState({ phase:'INPUT' });");
    expect(page).toContain("setRecipientAddress(e.target.value); setBridgeState({ phase:'INPUT' });");
    expect(page).toContain('!isAddress(recipientAddress)');
    expect(page).toContain('Open the stable Testnet V2 site (separate release)');
    expect(page).not.toContain('writeContractAsync(');
    expect(page).not.toContain("simulationCompleted: true");
  });
  it('has a single wallet-bound identity gate, explicit stable site and technical disclosure',()=>{
    const entry=read('src/components/identity/VeyraIdentityAccess.tsx');
    const banner=read('src/components/system/WebPreviewBanner.tsx');
    const social=read('src/features/social/UnifiedSocial.tsx');
    expect(entry).toContain('No signature was requested.');
    expect(entry).toContain('Open stable Testnet site');
    expect(entry).toContain('Technical details');
    expect(entry).toContain('403 ORIGIN_NOT_ALLOWED');
    expect(entry).toContain('target="_blank" rel="noopener noreferrer"');
    expect(entry).toContain('social.identityOrigin');
    expect(banner).toContain('Sign-in unavailable on this Preview');
    expect(social).toContain("identityOrigin!=='ready'");
    expect(social).toContain('restoreAttemptedFor.current');
    expect(entry).not.toContain('eth_sign');
  });
});
