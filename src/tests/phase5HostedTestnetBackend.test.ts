import { describe, expect, it } from 'vitest';
import {
  assertServerRuntimeConfig,
  readServerRuntimeConfig,
  validateServerRuntimeConfig,
} from '../../server/config/runtimeConfig.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const hosted: NodeJS.ProcessEnv = {
  VEYRA_HOSTED_BACKEND: '1',
  VEYRA_ENV: 'testnet',
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://veyra:dummy@pg.testnet.example:5432/veyra?sslmode=require',
  VEYRA_APP_ORIGIN: 'https://veyra.example',
  VEYRA_SESSION_SECRET: '0123456789abcdef0123456789abcdef',
};

function rejects(change: NodeJS.ProcessEnv, part: string) {
  const result = validateServerRuntimeConfig({ ...hosted, ...change });
  expect(result.ok).toBe(false);
  expect(result.errors.join(' ')).toContain(part);
}

describe('Phase 5 hosted backend deployment gates', () => {
  it('allows safe hosted testnet but never silently activates mainnet', () => {
    expect(validateServerRuntimeConfig(hosted)).toEqual({
      ok: true, errors: [], warnings: [],
    });
    expect(readServerRuntimeConfig(hosted)).toMatchObject({
      environment: 'testnet',
      hostedBackend: true,
      sessionSecretConfigured: true,
    });
    expect(() => assertServerRuntimeConfig(hosted)).not.toThrow();
    rejects({ VEYRA_ENV: 'local' }, 'VEYRA_ENV=testnet');
    rejects({ NODE_ENV: 'development' }, 'NODE_ENV=production');
    expect(readServerRuntimeConfig({
      ...hosted, VEYRA_HOSTED_BACKEND: undefined,
    }).hostedBackend).toBe(true);
    expect(validateServerRuntimeConfig({
      ...hosted, VEYRA_HOSTED_BACKEND: undefined,
      DATABASE_URL: undefined,
    }).ok).toBe(false);
  });

  it('refuses a hosted public BFF without database credentials, TLS or a private network', () => {
    rejects({ DATABASE_URL: '' }, 'DATABASE_URL');
    rejects({ DATABASE_URL: 'sqlite://not-postgres/test' }, 'PostgreSQL');
    rejects({ DATABASE_URL: 'postgres://localhost:5432/veyra' }, 'non-local PostgreSQL');
    rejects({ DATABASE_URL: 'postgres://127.0.0.1:5432/veyra?sslmode=require' }, 'non-local PostgreSQL');
    rejects({ DATABASE_URL: 'postgres://[::1]:5432/veyra?sslmode=require' }, 'non-local PostgreSQL');
    rejects({
      DATABASE_URL: 'postgres://veyra:dummy@pg.testnet.example:5432/veyra',
    }, 'PostgreSQL TLS');
    const privateDatabase = {
      ...hosted,
      DATABASE_URL: 'postgres://veyra:dummy@pg.internal:5432/veyra',
      VEYRA_DATABASE_PRIVATE_NETWORK: '1',
    };
    expect(validateServerRuntimeConfig(privateDatabase).ok).toBe(true);
  });

  it('rejects missing session secret or insecure application origin', () => {
    rejects({ VEYRA_SESSION_SECRET: '' }, 'VEYRA_SESSION_SECRET');
    rejects({ VEYRA_SESSION_SECRET: 'short' }, 'VEYRA_SESSION_SECRET');
    rejects({ VEYRA_APP_ORIGIN: 'http://veyra.example' }, 'HTTPS');
    rejects({ VEYRA_APP_ORIGIN: '' }, 'HTTPS');
    rejects({ VEYRA_APP_ORIGIN: 'https://veyra.example/path' }, 'exact HTTPS origin');
    rejects({ VEYRA_APP_ORIGIN: 'https://user:pass@veyra.example' }, 'exact HTTPS origin');
  });

  it('cannot accidentally enable a funded relay key on the hosted backend', () => {
    rejects({ RELAY_PRIVATE_KEY: '0xPRIVATEKEY' }, 'RELAY_PRIVATE_KEY');
    expect(validateServerRuntimeConfig({
      ...hosted,
      RELAY_PRIVATE_KEY: '0xTESTKEYONLY',
      VEYRA_ENABLE_TESTNET_RELAY: '1',
    }).ok).toBe(true);
  });

  it('keeps pre-existing local dev and mainnet gates independent', () => {
    expect(validateServerRuntimeConfig({
      VEYRA_ENV: 'local',
      NODE_ENV: 'development',
    }).ok).toBe(true);
    expect(validateServerRuntimeConfig({
      VEYRA_ENV: 'local',
      NODE_ENV: 'production',
    }).errors.join(' ')).toContain('cannot start with VEYRA_ENV=local');
    expect(readServerRuntimeConfig({
      VEYRA_ENV: 'local',
    }).hostedBackend).toBe(false);
    expect(validateServerRuntimeConfig({
      ...hosted, VEYRA_ENV: 'mainnet',
    }).ok).toBe(false);
  });

  it('requires a dedicated container and prevents accidental secret packaging', () => {
    const read = (path: string) => readFileSync(
      fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8',
    );
    const docker = read('Dockerfile.bff');
    const ignore = read('.dockerignore');
    const bff = read('server/bff.ts');
    expect(docker).toContain('FROM oven/bun:1.3.14');
    expect(docker).toContain('VEYRA_HOSTED_BACKEND=1');
    expect(docker).toContain('NODE_ENV=production');
    expect(docker).toContain('COPY --chown=bun:bun server ./server');
    expect(docker).toContain('USER bun');
    expect(docker).not.toContain('db:migrate');
    expect(ignore).toContain('.env.*');
    expect(ignore).toContain('.circle');
    expect(ignore).toContain('node_modules');
    expect(bff).toContain('runtimeConfig.hostedBackend');
    expect(bff).toContain('process.env.PORT ?? process.env.BFF_PORT');
  });
});
