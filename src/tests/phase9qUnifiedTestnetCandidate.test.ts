import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { STAGING_APPROVED_REWRITES, STAGING_ALLOWED_PATHS } from '../../scripts/stagingBffAllowlist';
const read = (p: string) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');

describe('Phase 9Q — the one protected Veyra Core Testnet build', () => {
  it('uses the full app and locked Mainnet without touching the original static Preview config', () => {
    const config = JSON.parse(read('vercel.json')) as { buildCommand: string; rewrites: unknown[]; env?: unknown };
    expect(config.buildCommand).toContain('VITE_VEYRA_UNIFIED_STAGING=1');
    expect(config.buildCommand).toContain('VITE_VEYRA_UI_ONLY=0');
    expect(config.buildCommand).toContain('VITE_VEYRA_TESTNET_PAY=1');
    expect(config.buildCommand).toContain('VITE_VEYRA_MAINNET_PAY=0');
    expect(config.buildCommand).toContain('VITE_VEYRA_MAINNET_MVP=0');
    expect(config.env).toBeUndefined();
    expect(config.rewrites).toEqual(STAGING_APPROVED_REWRITES);
    expect(STAGING_ALLOWED_PATHS).not.toContain('/api/:path*');
    expect(STAGING_ALLOWED_PATHS).not.toContain('/api/auth/x/start');
    expect(STAGING_ALLOWED_PATHS).not.toContain('/api/bridge/execute');
  });
  it('never offers an unusable X OAuth link or a fake BFF Online badge', () => {
    const settings = read('src/components/pages/SettingsPage.tsx');
    const banner = read('src/components/system/WebPreviewBanner.tsx');
    expect(settings).toContain("import.meta.env.VITE_VEYRA_UNIFIED_STAGING === '1'");
    expect(settings).toContain("'X linking unavailable'");
    expect(settings).toContain('disabled={xLinkUnavailable ||');
    expect(banner).toContain("type.toLowerCase().includes('application/json')");
    expect(banner).toContain('payload.ok === true');
  });
  it('runs the staging config gate only on this deploy-only branch', () => {
    const workflow = read('.github/workflows/ci.yml');
    expect(workflow).toContain('phase9q-unified-core-testnet-release');
    expect(workflow).toContain('check-unified-testnet-staging.ts');
    expect(workflow).toContain('check-unified-production-release.ts');
    expect(read('scripts/check-unified-testnet-staging.ts')).toContain('isExactStagingBffAllowlist(cfg.rewrites)');
  });
});
