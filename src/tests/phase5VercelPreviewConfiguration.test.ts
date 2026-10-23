import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function read(path: string): string {
  return readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

describe('Phase 5 Vercel frontend-only preview readiness', () => {
  it('builds Vite to dist using the locked Bun dependency graph', () => {
    const config = JSON.parse(read('vercel.json')) as Record<string, unknown>;
    const pkg = JSON.parse(read('package.json')) as {
      scripts?: Record<string, string>;
    };
    expect(config.framework).toBe('vite');
    expect(config.installCommand).toBe('bun install --frozen-lockfile');
    if (config.buildCommand === 'VITE_VEYRA_ENV=testnet VITE_VEYRA_IDENTITY_BETA=1 bun run build') {
      // A separately hosted identity project may only ship the isolated EIP-712
      // identity entry. It must not build any financial preview into this app.
      expect(read('vite.config.ts')).toContain('rollupOptions: { input: identityHtml }');
      expect(read('src/identity-beta/protocol.ts')).not.toContain("method: 'eth_sendTransaction'");
    } else {
      expect(config.buildCommand).toBe('VITE_VEYRA_ENV=testnet VITE_VEYRA_UI_ONLY=1 VITE_VEYRA_TESTNET_PAY=1 bun run build');
    }
    expect(config.outputDirectory).toBe('dist');
    expect(pkg.scripts?.build).toBe('vite build');
  });

  it('locks payments, bridges and recovery in the static frontend at build and execution boundaries', () => {
    const env = read('src/lib/env.ts');
    const readiness = read('src/core/execution/executionReadiness.ts');
    const app = read('src/App.tsx');
    const activity = read('src/components/pages/ActivityPage.tsx');
    const recovery = read('src/hooks/useBridgeExecution.ts');
    const preview = read('src/components/pages/UiOnlyPreviewPage.tsx');
    const banner = read('src/components/system/WebPreviewBanner.tsx');

    expect(env).toContain('VITE_VEYRA_UI_ONLY');
    expect(readiness).toContain('if (IS_UI_ONLY_PREVIEW)');
    expect(app).toContain('<UiOnlyPreviewPage surface="pay" />');
    expect(app).toContain('<UiOnlyPreviewPage surface="convert" />');
    expect(app).toContain('<UiOnlyPreviewPage surface="bridge" />');
    expect(app).toContain('<ActivityPage readOnly={IS_UI_ONLY_PREVIEW} />');
    expect(activity).toContain('if (readOnly) return;');
    expect(recovery).toContain('Static Vercel preview cannot sign, relay or resume a bridge.');
    expect(banner).toContain('Signing disabled');
    expect(preview).not.toMatch(/useWalletClient|useWriteContract|sendTransaction|writeContract|signTypedData/);
  });

  it('uses a separate HTML entry that cannot import live main/App or wallet providers', () => {
    const vite = read('vite.config.ts');
    const entry = read('src/preview/main.tsx');
    const app = read('src/preview/PreviewApp.tsx');
    const surfaces = read('src/preview/PreviewSurfaces.tsx');
    const ci = read('.github/workflows/ci.yml');
    const audit = read('scripts/check-vercel-preview-bundle.ts');

    expect(vite).toContain("process.env.VITE_VEYRA_UI_ONLY === '1'");
    expect(vite).toContain('rollupOptions: { input: previewHtml }');
    expect(vite).toContain('renameSync(preview, index)');
    expect(vite).not.toContain('transformIndexHtml');
    expect(read('preview.html')).toContain('src="/src/preview/main.tsx"');
    expect(read('preview.html')).not.toContain('src="/src/main.tsx"');
    expect(entry).toContain("import { PreviewApp } from './PreviewApp'");
    expect(entry).not.toContain("from '../main'");
    expect(app).toContain("import { UiOnlyPreviewPage }");
    expect(app).not.toContain("from '../App'");
    for (const content of [entry, app, surfaces]) {
      expect(content).not.toMatch(/from ['\"][^'\"]*(?:wagmi|connectkit|\/api\/|hooks\/useBridge|hooks\/useTransfer|securityBootstrap|providerManifest|receiptStore)/i);
    }

    expect(ci).toContain('Assert finance or dedicated Identity Beta source safety');
    expect(ci).toContain('bun run scripts/check-identity-beta-bundle.ts');
    expect(ci).toContain('bun run check:vercel-preview-bundle');
    expect(audit).toContain('eth_sendTransaction');
    expect(audit).toContain('depositForBurn');
    expect(audit).toContain('receiveMessage');
    expect(audit).toContain('BFF API path');
  });

  it('allows real wallet account connection in preview, never wallet signing or transaction submission', () => {
    const wallet = read('src/preview/PreviewWallet.tsx');
    const overview = read('src/preview/PreviewSurfaces.tsx');
    const shell = read('src/preview/PreviewApp.tsx');
    const readOnlyForms = read('src/components/pages/UiOnlyPreviewPage.tsx');
    const css = read('src/preview/preview.css');
    const entry = read('src/preview/main.tsx');

    expect(entry).toContain("import './preview.css'");
    expect(shell).toContain('<PreviewWalletProvider>');
    expect(shell).toContain('PreviewWalletButton');
    expect(wallet).toContain('eip6963:announceProvider');
    expect(wallet).toContain('eip6963:requestProvider');
    expect(wallet).toContain("method: 'eth_requestAccounts'");
    expect(wallet).toContain("method: 'eth_accounts'");
    expect(wallet).toContain("method: 'eth_chainId'");
    expect(wallet).toContain("readRpc('eth_call'");
    expect(wallet).toContain('getUsdc(ARC_ID)');
    expect(wallet).toContain('actualChain !== ARC_ID');
    expect(overview).toContain('usePreviewArcBalance');
    expect(readOnlyForms).toContain('Review preview');
    expect(readOnlyForms).toContain('No payment signatures');
    expect(css).toContain('.vp-shell');

    for (const source of [entry, shell, overview, wallet, readOnlyForms]) {
      expect(source).not.toMatch(/eth_sendTransaction|personal_sign|eth_signTypedData|wallet_sendCalls|useWriteContract|useWalletClient|sendTransaction|writeContract|depositForBurn/);
      expect(source).not.toMatch(/\/api\/(?:bridge|identity|activity|agent)/);
    }
  });

  it('allows exactly one explicitly authorized direct Arc testnet transfer, never bridge or mainnet signing', () => {
    const app = read('src/preview/PreviewApp.tsx');
    const source = read('src/preview/arcTestnetPay.ts');
    const page = read('src/preview/PreviewTestnetPayPage.tsx');
    const check = read('scripts/check-vercel-preview-bundle.ts');

    expect(app).toContain("import.meta.env.VITE_VEYRA_TESTNET_PAY === '1'");
    expect(app).toContain('<PreviewTestnetPayPage />');
    expect(app).toContain('<PreviewServiceStatus surface={page} onNavigate={setPage} />');
    expect(source).toContain('export const ARC_TESTNET_CHAIN_ID = 5042002');
    expect(source).toContain('MAX_TESTNET_PAYMENT_UNITS = 1_000_000n');
    expect(source).toContain("functionName: 'transfer'");
    expect(source).toContain("method: 'eth_sendTransaction'");
    expect(source).toContain('await assertArcRpcChain()');
    expect(source).not.toMatch(/depositForBurn|receiveMessage|eth_signTypedData|personal_sign|approve\(/);
    expect(page).toContain('I checked the chain, token, recipient and amount.');
    expect(page).toContain('No automatic resubmission');
    expect(check).toContain("VITE_VEYRA_TESTNET_PAY=1");
    expect(check).toContain("match(/eth_sendTransaction/g)");
    expect(check).toContain('CCTP receiveMessage ABI');
  });

  it('defaults to English UI while preserving multilingual AI assistance', () => {
    const agent = read('src/preview/PreviewLiveAgent.tsx');
    const gate = read('src/preview/PreviewServiceStatus.tsx');
    const fullAgent = read('src/components/pages/AgentPage.tsx');
    const ai = read('api/agent/chat.ts');

    // Rendered UI copy has no non-English hardcoded strings. Replies are
    // dynamic model output, not embedded in the frontend.
    const nonEnglishUi = /[\u00c0-\u024f\u1ea0-\u1ef9]/u;
    for (const source of [agent, gate, fullAgent]) {
      expect(source).not.toMatch(nonEnglishUi);
    }
    expect(agent).toContain('How do I send USDC on Arc Testnet?');
    expect(agent).toContain('Ask Veyra');
    expect(agent).toContain('Ask questions in any language.');
    expect(fullAgent).toContain("title: 'Any language'");
    expect(fullAgent).not.toContain('Gửi 20 USDC');
    expect(ai).toMatch(/language\s+of the user's LATEST message/);
    expect(ai).toContain('default to English');
    expect(ai).toContain('Do not force Vietnamese');
  });

  it('uses only a genuine server-side AI provider, never scripted fallback replies', () => {
    const app = read('src/preview/PreviewApp.tsx');
    const surfaces = read('src/preview/PreviewSurfaces.tsx');
    const agent = read('src/preview/PreviewLiveAgent.tsx');
    const serverless = read('api/agent/chat.ts');
    const audit = read('scripts/check-vercel-preview-bundle.ts');

    expect(app).toContain("import { PreviewLiveAgent } from './PreviewLiveAgent'");
    expect(app).toContain('<PreviewLiveAgent onNavigate={setPage} />');
    expect(surfaces).not.toContain('function explain(');
    expect(surfaces).not.toContain('export function PreviewAgent(');
    expect(agent).toContain("fetch('/api/agent/chat'");
    expect(agent).toContain('AI beta access code');
    expect(agent).toContain('requestInFlight.current = true');
    expect(agent).toContain('requestInFlight.current = false');
    expect(agent).toContain('signal: AbortSignal.timeout(20_000)');
    expect(agent).toContain("{ role: 'assistant' as const, text: payload.reply as string }].slice(-30)");
    expect(agent).not.toContain('setMessages([...prior,');
    expect(agent).not.toContain('createFallbackAgentResponse');
    expect(serverless).toContain('https://api.openai.com/v1/chat/completions');
    expect(serverless).toContain('VEYRA_AGENT_BETA_TOKEN');
    expect(serverless).toContain('process.env.OPENAI_API_KEY');
    expect(serverless).toContain('store: false');
    expect(serverless).not.toContain('local-fallback');
    expect(audit).toContain('live AI function is the only permitted');
    expect(audit).toContain('genuine Vercel AI endpoint path absent');
  });

  it('does not simulate Bridge and FX quotes or claim success without a deployed BFF', () => {
    const app = read('src/preview/PreviewApp.tsx');
    const page = read('src/preview/PreviewServiceStatus.tsx');
    expect(app).toContain("import { PreviewServiceStatus }");
    expect(page).toContain('No fabricated quotes, simulated success, or fake signing buttons.');
    expect(page).toContain('Live execution is not available on this Preview');
    expect(page).not.toMatch(/depositForBurn|receiveMessage|eth_sendTransaction|useWalletClient|writeContract/);
    expect(page).not.toContain('Review preview');
  });

  it('does not pretend the localhost BFF runs as a Vercel API', () => {
    const config = JSON.parse(read('vercel.json')) as {
      rewrites?: Array<{ source?: string; destination?: string }>;
      env?: Record<string, string>;
    };
    expect(config.rewrites ?? []).toEqual([]);
    expect(config.env?.RELAY_PRIVATE_KEY).toBeUndefined();
    expect(config.env?.DATABASE_URL).toBeUndefined();
    expect(config.env?.VITE_VEYRA_ENV).not.toBe('mainnet');
  });

  it('documents the real Preview versus older Production and BFF/database gates', () => {
    const readme = read('README.md');
    const runbook = read('docs/veyra-vercel-preview.md');
    expect(readme).toContain('docs/veyra-vercel-preview.md');
    // Old README asserted the Preview URL was not verified. Vercel READY
    // evidence exists, but that does not mean the full-stack BFF is deployed.
    expect(readme).toContain('Production branch (`develop`) is older');
    expect(readme).toContain('require a hosted authenticated backend');
    expect(readme).toContain('Mainnet financial execution is not enabled');
    expect(runbook).toContain('DATABASE_URL');
    expect(runbook).toContain('UI-only preview');
    expect(runbook).toContain('second wallet-signing/broadcast boundary remains');
    expect(runbook).toContain('Do not report a public Vercel demo');
  });
});
