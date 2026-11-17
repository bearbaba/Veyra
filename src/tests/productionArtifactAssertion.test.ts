import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertAndPublish, assertArtifact } from '../../scripts/assertMainnetArtifact';

const read = (p: string) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const SHA = 'a'.repeat(40);
const html = '<!doctype html><title>Veyra — Intelligent Money Layer</title>';
const js = (env: string, sha = SHA) => `var x=1;window.__VEYRA_BUILD__="veyra-build:env=${env};sha=${sha}";`;

describe('Production artifact assertion', () => {
  it('accepts a Mainnet artifact stamped with the expected commit', () => {
    const r = assertArtifact({ indexHtml: html, js: [js('mainnet')] }, { expectedEnv: 'mainnet', expectedSha: SHA });
    expect(r).toMatchObject({ ok: true, env: 'mainnet', sha: SHA, failures: [] });
  });
  it.each(['local', 'testnet'])('rejects an artifact compiled as %s (the READY-but-wrong-network bug)', env => {
    const r = assertArtifact({ indexHtml: html, js: [js(env)] }, { expectedEnv: 'mainnet' });
    expect(r.ok).toBe(false);
    expect(r.failures.join(' ')).toContain(`compiled as "${env}"`);
  });
  it('rejects a bundle with no stamp, conflicting stamps, a stale SHA, or a missing entry', () => {
    expect(assertArtifact({ indexHtml: html, js: ['var a=1'] }, { expectedEnv: 'mainnet' }).ok).toBe(false);
    expect(assertArtifact({ indexHtml: html, js: [js('mainnet'), js('testnet')] }, { expectedEnv: 'mainnet' }).failures.join(' '))
      .toContain('conflicting');
    expect(assertArtifact({ indexHtml: html, js: [js('mainnet', 'b'.repeat(40))] }, { expectedEnv: 'mainnet', expectedSha: SHA }).ok).toBe(false);
    expect(assertArtifact({ indexHtml: null, js: [js('mainnet')] }, { expectedEnv: 'mainnet' }).ok).toBe(false);
    expect(assertArtifact({ indexHtml: html, js: [js('mainnet')] }, { expectedEnv: 'mainnet', expectedSha: 'not-a-sha' }).ok).toBe(false);
  });
  it('publishes veyra-build.json only for a verified artifact, and throws otherwise', () => {
    const good = mkdtempSync(join(tmpdir(), 'veyra-good-'));
    mkdirSync(join(good, 'assets'));
    writeFileSync(join(good, 'index.html'), html);
    writeFileSync(join(good, 'assets', 'index-abc.js'), js('mainnet'));
    assertAndPublish(good, { expectedEnv: 'mainnet', expectedSha: SHA });
    expect(JSON.parse(readFileSync(join(good, 'veyra-build.json'), 'utf8'))).toMatchObject({ env: 'mainnet', sha: SHA });

    const bad = mkdtempSync(join(tmpdir(), 'veyra-bad-'));
    mkdirSync(join(bad, 'assets'));
    writeFileSync(join(bad, 'index.html'), html);
    writeFileSync(join(bad, 'assets', 'index-abc.js'), js('local'));
    expect(() => assertAndPublish(bad, { expectedEnv: 'mainnet' })).toThrow('Refusing to publish');
  });
});

describe('Production build wiring (do not regress d356627)', () => {
  it('applies the Mainnet profile to the build process itself, never only to a prior command', () => {
    const cmd = (JSON.parse(read('vercel.json')) as { buildCommand: string }).buildCommand;
    const viaScript = /&&\s*bun scripts\/build-mainnet-pilot\.ts$/.test(cmd);
    const inlineBeforeBuild = /&&\s*(?:VITE_\w+=\S+\s+)*VITE_VEYRA_ENV=mainnet(?:\s+VITE_\w+=\S+)*\s+bun run build$/.test(cmd);
    expect(viaScript || inlineBeforeBuild).toBe(true);
  });
  it('the pilot build passes VITE_VEYRA_ENV=mainnet to the child build and asserts the emitted artifact', () => {
    const script = read('scripts/build-mainnet-pilot.ts');
    expect(script).toContain("VITE_VEYRA_ENV:'mainnet'");
    expect(script).toContain("spawnSync('bun',['run','build'],{env:{...process.env,...profile}");
    expect(script).toContain("assertAndPublish(");
    expect(script).toContain("expectedEnv:'mainnet'");
  });
  it('compiles the build stamp into the bundle from the real build environment', () => {
    expect(read('vite.config.ts')).toContain('__VEYRA_BUILD_STAMP__');
    const env = read('src/lib/env.ts');
    expect(env).toContain('__VEYRA_BUILD_STAMP__');
    expect(env).toContain('window as unknown as { __VEYRA_BUILD__');
  });
});

describe('Mainnet API routing rejects any rewrite outside the reviewed backend', () => {
  it('flags an attacker-controlled HTTPS destination, not only Testnet or non-HTTPS ones', async () => {
    const { verifyProductionMainnetRouting, MAINNET_RECEIPT_ROUTES } = await import('../../server/services/mainnetReleaseRouting');
    const bff = 'https://veyra-mainnet-v1-bff.onrender.com';
    const good = MAINNET_RECEIPT_ROUTES.map(source => ({ source, destination: bff + source }));
    expect(verifyProductionMainnetRouting({ rewrites: good }, bff).ok).toBe(true);
    const extra = [...good, { source: '/api/health', destination: 'https://attacker.example/api/health' }];
    const result = verifyProductionMainnetRouting({ rewrites: extra }, bff);
    expect(result.ok).toBe(false);
    expect(result.issues).toContain('Unsafe API rewrite: /api/health');
  });
});
