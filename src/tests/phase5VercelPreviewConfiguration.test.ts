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
    expect(config.buildCommand).toBe('bun run build');
    expect(config.outputDirectory).toBe('dist');
    expect(pkg.scripts?.build).toBe('vite build');
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
