import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  GUARDED_LAUNCHERS,
  SAFE_DELEGATED_SCRIPTS,
  buildRootScripts,
  findUnsafeRootScripts,
} from '../../studio/rootScripts';
import {
  OFFICIAL_VEYRA_ORIGIN,
  evaluateMainnetIdentityAuthority,
} from '../../server/services/mainnetIdentityCapability';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
/** Shell source without comment lines, so documentation cannot trip or hide a check. */
const code = (path: string) => read(path).split('\n').filter((line) => !line.trim().startsWith('#')).join('\n');
const repoScripts = (JSON.parse(read('package.json')) as { scripts: Record<string, string> }).scripts;

// What an outdated Studio workspace root typically contains: raw commands that
// would run the snapshot.
const snapshotRoot: Record<string, string> = {
  dev: 'vite',
  build: 'vite build',
  server: 'bun run server/bff.ts',
  test: 'vitest run',
  lint: 'oxlint --quiet .',
  typecheck: 'tsc --noEmit',
  'db:migrate': 'bun run server/db/migrate.ts',
  'deploy:self': 'bun run ./scripts/self-deploy.ts',
};

describe('Studio workspace root can never silently run the outdated snapshot', () => {
  const rel = 'Veyra-github';
  const mapped = buildRootScripts(snapshotRoot, repoScripts, rel);

  it('maps every root and repository script to the repo or to a refusal', () => {
    expect(findUnsafeRootScripts(mapped, rel)).toEqual([]);
    for (const name of [...Object.keys(snapshotRoot), ...Object.keys(repoScripts)]) {
      expect(mapped[name], name).toBeDefined();
    }
  });

  it('flags a raw snapshot command as unsafe', () => {
    expect(findUnsafeRootScripts(snapshotRoot, rel)).toEqual(
      expect.arrayContaining(['dev', 'build', 'server', 'test', 'db:migrate']),
    );
  });

  it('routes dev, build and server through the guarded launchers', () => {
    expect(mapped.dev).toBe('bash Veyra-github/studio/dev.sh');
    expect(mapped.build).toBe('bash Veyra-github/studio/build.sh');
    expect(mapped.server).toBe('bash Veyra-github/studio/local-backend.sh');
    expect(Object.keys(GUARDED_LAUNCHERS).sort()).toEqual(['build', 'dev', 'server']);
  });

  it('refuses every script that can touch deployments, databases, providers or funds', () => {
    for (const name of [
      'db:migrate', 'db:migrate:mainnet-v1', 'db:activate:mainnet', 'db:verify', 'deploy:self',
      'compass:deploy', 'production:preflight', 'readiness:mainnet', 'providers:health',
      'signer:health', 'fetch:abi', 'preview', 'web:smoke',
    ]) {
      expect(mapped[name], name).toBe(`bash Veyra-github/studio/refuse.sh ${name}`);
    }
  });

  it('delegates only read-only verification scripts, and each really exists in the repo', () => {
    for (const name of SAFE_DELEGATED_SCRIPTS) {
      expect(repoScripts[name], `${name} missing from package.json`).toBeDefined();
      const segments = name.split(':');
      for (const risky of ['deploy', 'activate', 'migrate', 'production', 'signer', 'providers', 'readiness', 'fetch', 'server', 'dev', 'preview']) {
        expect(segments, `${name} must not delegate '${risky}'`).not.toContain(risky);
      }
      expect(mapped[name]).toBe(`bun run --cwd Veyra-github ${name}`);
    }
  });
});

describe('Studio launchers keep development isolated from Production', () => {
  const dev = code('studio/dev.sh');
  const backend = code('studio/local-backend.sh');
  const build = read('studio/build.sh');

  it('Preview launcher: one capped Vite process on the repo Mainnet profile', () => {
    expect(dev).toContain('GOMEMLIMIT');
    expect(dev).toContain('--strictPort');
    expect(dev).toContain('exec bun run --cwd "$REPO" dev');
    expect(dev).toContain('scripts/build-mainnet-pilot.ts');
    expect(dev).not.toMatch(/onrender\.com|vercel\.app|CIRCLE_|RELAY_|VERCEL_ENV\s*=\s*production/);
  });

  it('Local backend: scratch environment, local database, no credentials', () => {
    expect(backend).toContain('env -i');
    expect(backend).toContain('VEYRA_ENV=local');
    expect(backend).toContain('@127.0.0.1:5432/${DB_NAME}');
    expect(backend).toContain('DB_NAME="veyra_studio_dev"');
    expect(backend).toMatch(/\.env\.production/);
    expect(backend).not.toMatch(/VEYRA_ENV=(mainnet|testnet)/);
    expect(backend).not.toMatch(/VEYRA_HOSTED_BACKEND|VEYRA_MAINNET_IDENTITY_ONLY/);
    expect(backend).not.toMatch(/CIRCLE_API|CIRCLE_ENTITY|X_CLIENT|RELAY_PRIVATE|ANTHROPIC|OPENAI|SIGNER|RPC_PROXY|onrender\.com|vercel\.app/);
    // It may only ever name the isolated database, never the snapshot's `veyra` one.
    expect(backend).not.toMatch(/\/veyra["'\s]/);
  });

  it('Build wrapper refuses when memory is too low unless explicitly overridden', () => {
    expect(build).toContain('MemAvailable');
    expect(build).toContain('STUDIO_ALLOW_BUILD');
  });

  it('Frontend /api proxy targets only the local backend', () => {
    const vite = read('vite.config.ts');
    expect(vite).toContain("target: 'http://localhost:3001'");
    expect(vite).not.toMatch(/onrender\.com/);
    expect(vite.match(/target:/g)).toHaveLength(1);
  });
});

describe('Mainnet identity authority cannot be obtained from a Preview or local backend', () => {
  const production = {
    environment: 'mainnet',
    nodeEnv: 'production',
    hostedBackend: true,
    appOrigin: OFFICIAL_VEYRA_ORIGIN,
    sessionSecretConfigured: true,
    databaseUrl: 'postgres://redacted',
    testnetSecondaryAppOrigin: undefined,
  } as const;
  const local = { ...production, environment: 'local', nodeEnv: 'development', hostedBackend: false, appOrigin: 'http://localhost:5173' } as const;

  it('is granted only to the official origin on a hosted production Mainnet backend', () => {
    expect(evaluateMainnetIdentityAuthority(production, OFFICIAL_VEYRA_ORIGIN)?.ok).toBe(true);
  });

  it.each([
    'http://localhost:5173',
    'https://ibb9vwyygkkct5eupl9ay.preview.studio.arc.io',
    'https://veyra-unified-testnet-v2.vercel.app',
    'https://veyra-seven-beta.vercel.app.evil.example',
    undefined,
  ])('refuses origin %s even on the production backend', (origin) => {
    expect(evaluateMainnetIdentityAuthority(production, origin)).toBeNull();
  });

  it('refuses every origin, including the official one, on a local backend', () => {
    for (const origin of [OFFICIAL_VEYRA_ORIGIN, 'http://localhost:5173', undefined]) {
      expect(evaluateMainnetIdentityAuthority(local, origin)).toBeNull();
    }
  });
});
