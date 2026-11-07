/**
 * Post-build assertion for the Production artifact.
 *
 * A green Vercel build is not evidence of what was compiled: an environment
 * variable that never reached `vite build` still produces a READY deployment
 * that runs as `local`. This inspects the emitted files instead of the log.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface ArtifactFiles {
  indexHtml: string | null;
  js: string[];
}
export interface ArtifactResult {
  ok: boolean;
  failures: string[];
  env: string | null;
  sha: string | null;
}
export interface ArtifactOptions {
  expectedEnv: 'mainnet' | 'testnet';
  /** Expected full commit SHA (Vercel supplies VERCEL_GIT_COMMIT_SHA). Omit for local builds. */
  expectedSha?: string;
}

const STAMP = /veyra-build:env=([A-Za-z]+);sha=([A-Za-z0-9-]+)/g;
const SHA40 = /^[0-9a-f]{40}$/;

export function assertArtifact(files: ArtifactFiles, options: ArtifactOptions): ArtifactResult {
  const failures: string[] = [];
  if (!files.indexHtml) failures.push('dist/index.html is missing');
  else if (!/<title>Veyra/.test(files.indexHtml)) failures.push('dist/index.html is not the Veyra entry');
  if (files.js.length === 0) failures.push('no compiled JavaScript was emitted');

  const stamps = new Set<string>();
  for (const source of files.js) {
    for (const match of source.matchAll(STAMP)) stamps.add(`${match[1]}|${match[2]}`);
  }
  if (stamps.size === 0) failures.push('compiled JavaScript has no build stamp');
  if (stamps.size > 1) failures.push(`compiled JavaScript has conflicting build stamps: ${[...stamps].join(', ')}`);

  const [env, sha] = stamps.size === 1 ? [...stamps][0].split('|') : [null, null];
  if (env !== null && env !== options.expectedEnv) {
    failures.push(`artifact compiled as "${env}" but "${options.expectedEnv}" is required`);
  }
  if (options.expectedSha !== undefined) {
    if (!SHA40.test(options.expectedSha)) failures.push('expected commit SHA is not a 40-character hex value');
    else if (sha !== null && sha !== options.expectedSha) {
      failures.push(`artifact stamped with commit "${sha}" but build is for "${options.expectedSha}"`);
    }
  }
  return { ok: failures.length === 0, failures, env, sha };
}

export function loadArtifact(dir: string): ArtifactFiles {
  const index = join(dir, 'index.html');
  const assets = join(dir, 'assets');
  const js = existsSync(assets)
    ? readdirSync(assets).filter(name => name.endsWith('.js')).map(name => readFileSync(join(assets, name), 'utf8'))
    : [];
  return { indexHtml: existsSync(index) ? readFileSync(index, 'utf8') : null, js };
}

/** Throws on failure; on success writes dist/veyra-build.json for public verification. */
export function assertAndPublish(dir: string, options: ArtifactOptions): ArtifactResult {
  const result = assertArtifact(loadArtifact(dir), options);
  if (!result.ok) {
    throw new Error('[artifact] Refusing to publish:\n - ' + result.failures.join('\n - '));
  }
  writeFileSync(
    join(dir, 'veyra-build.json'),
    JSON.stringify({ env: result.env, sha: result.sha, vercelEnv: process.env.VERCEL_ENV ?? null }) + '\n',
  );
  return result;
}
