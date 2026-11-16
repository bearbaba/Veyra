import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { productionBuildMode, mainnetRoutingIssues } from './support/productionProfile';
import { STAGING_APPROVED_REWRITES, STAGING_ALLOWED_PATHS } from '../../scripts/stagingBffAllowlist';
const read = (p: string) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');

describe('Phase 9Q — the one protected Veyra Core Testnet build', () => {
  it('uses the full app and locked Mainnet without touching the original static Preview config', () => {
    if (productionBuildMode() === 'mainnet') {
      // This branch deploys the Mainnet profile; the Testnet staging contract is exercised by its own allowlist tests below.
      expect(mainnetRoutingIssues()).toEqual([]);
      return;
    }
    const config = JSON.parse(read('vercel.json')) as { buildCommand: string; rewrites: unknown[]; env?: unknown };
    expect(config.buildCommand).toContain('VITE_VEYRA_UNIFIED_STAGING=1');
    expect(config.buildCommand).toContain('VITE_VEYRA_UI_ONLY=0');
    expect(config.buildCommand).toContain('VITE_VEYRA_TESTNET_PAY=1');
    expect(config.buildCommand).toContain('VITE_VEYRA_MAINNET_PAY=0');
    expect(config.buildCommand).toContain('VITE_VEYRA_MAINNET_MVP=0');
    expect(config.env).toBeUndefined();
    expect(config.rewrites).toEqual(STAGING_APPROVED_REWRITES);
    expect(STAGING_ALLOWED_PATHS).not.toContain('/api/:path*');
    expect(STAGING_ALLOWED_PATHS).toContain('/api/auth/x/start');
    expect(STAGING_ALLOWED_PATHS).toContain('/api/auth/x/capability');
    expect(STAGING_ALLOWED_PATHS).not.toContain('/api/auth/x/callback');
    expect(STAGING_ALLOWED_PATHS).not.toContain('/api/bridge/execute');
    expect(STAGING_ALLOWED_PATHS).toContain('/api/bridge/relay-receive');
    expect(STAGING_ALLOWED_PATHS).toContain('/api/bridge/verify-second-destination');
    expect(STAGING_ALLOWED_PATHS).toContain('/api/bridge/finalize-second-settlement');
    expect(STAGING_ALLOWED_PATHS).toContain('/api/bridge/claim-self-receive');
    expect(STAGING_ALLOWED_PATHS).toContain('/api/receipts/cctp/resolve-source-revert');
    expect(STAGING_ALLOWED_PATHS).toContain('/api/cctp/attestation');
    expect(STAGING_ALLOWED_PATHS).toContain('/api/agent/status');
    expect(STAGING_ALLOWED_PATHS).toContain('/api/agent/chat');
    expect(STAGING_ALLOWED_PATHS).toContain('/api/gateway/balances');
    expect(STAGING_ALLOWED_PATHS).toContain('/api/gateway/estimate');
    expect(STAGING_ALLOWED_PATHS).not.toContain('/api/gateway/transfer');
    expect(STAGING_ALLOWED_PATHS).not.toContain('/api/stablefx/trade');
    expect(STAGING_ALLOWED_PATHS).not.toContain('/api/stablefx/quote');
  });
  it('never offers an unusable X OAuth link or a fake BFF Online badge', () => {
    const settings = read('src/components/pages/SettingsPage.tsx');
    const banner = read('src/components/system/WebPreviewBanner.tsx');
    expect(settings).toContain("xCapability==='unavailable'");
    expect(settings).toContain("'X linking unavailable'");
    expect(settings).toContain("disabled={xCapability!=='available'");
    expect(settings).toContain('probeXLinkReadiness()');
    expect(read('src/lib/api/identityApi.ts')).toContain("payload.available!==true");
    expect(banner).toContain("type.toLowerCase().includes('application/json')");
    expect(banner).toContain('payload.ok === true');
  });
  it('runs Mainnet CI on the default branch rather than activating old Testnet staging', () => {
    const workflow = read('.github/workflows/ci.yml');
    const mainnet = read('.github/workflows/mainnet-activity-release.yml');
    expect(workflow).toContain('feature/mainnet-identity-authority');
    expect(workflow).toContain('develop');
    expect(workflow).toContain('check:repository-trust');
    expect(workflow).not.toContain('VITE_VEYRA_ENV=testnet');
    expect(mainnet).toContain('Build exact full Mainnet release profile');
    expect(mainnet).toContain('Settlement V2 unsigned contract review');
    // Historical staging policy is still tested, but no public release runs it.
    expect(read('scripts/check-unified-testnet-staging.ts')).toContain('isExactStagingBffAllowlist(cfg.rewrites)');
  });
});
