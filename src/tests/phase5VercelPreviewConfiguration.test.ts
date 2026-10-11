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
    expect(config.buildCommand).toBe('VITE_VEYRA_UI_ONLY=1 bun run build');
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

  it('documents BFF, database, missing deployment URL and safety gates', () => {
    const readme = read('README.md');
    const runbook = read('docs/veyra-vercel-preview.md');
    expect(readme).toContain('docs/veyra-vercel-preview.md');
    expect(readme).toContain('actual Vercel URL not verified');
    expect(runbook).toContain('DATABASE_URL');
    expect(runbook).toContain('UI-only preview');
    expect(runbook).toContain('second wallet-signing/broadcast boundary remains');
    expect(runbook).toContain('Do not report a public Vercel demo');
  });
});
