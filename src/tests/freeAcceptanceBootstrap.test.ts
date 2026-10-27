import { describe, expect, it } from 'vitest';
import { assertFreeAcceptanceBootstrapEnvironment } from '../../server/db/freeAcceptanceBootstrap';

const valid = (): NodeJS.ProcessEnv => ({
  VEYRA_ENV: 'testnet',
  NODE_ENV: 'production',
  VEYRA_HOSTED_BACKEND: '1',
  VEYRA_ACCEPTANCE_BOOTSTRAP: '1',
  VEYRA_DATABASE_PRIVATE_NETWORK: '1',
  DATABASE_URL: 'postgres://user:secret@dpg-private.internal:5432/veyra_testnet_acceptance_db',
  VEYRA_SESSION_SECRET: 'this-is-a-disposable-test-secret-only-12345',
  VEYRA_APP_ORIGIN: 'https://veyra.example',
  VEYRA_SIGNER_BACKEND: 'none',
});

describe('Render Free disposable acceptance bootstrap', () => {
  it('permits exactly the reviewed private Testnet database', () => {
    expect(assertFreeAcceptanceBootstrapEnvironment(valid()))
      .toBe('postgres://user:secret@dpg-private.internal:5432/veyra_testnet_acceptance_db');
  });
  it.each([
    { VEYRA_ENV: 'mainnet' },
    { NODE_ENV: 'development' },
    { VEYRA_HOSTED_BACKEND: '0' },
    { VEYRA_ACCEPTANCE_BOOTSTRAP: '0' },
    { VEYRA_DATABASE_PRIVATE_NETWORK: '0' },
    { DATABASE_URL: 'postgres://user:secret@dpg-private.internal:5432/mainnet' },
    { DATABASE_URL: 'postgres://user:secret@localhost:5432/veyra_testnet_acceptance_db' },
    { VEYRA_SESSION_SECRET: 'short' },
    { VEYRA_APP_ORIGIN: 'http://veyra.example' },
    { RELAY_PRIVATE_KEY: '0xdo-not-use-this' },
    { VEYRA_ENABLE_TESTNET_RELAY: '1' },
    { VEYRA_SIGNER_BACKEND: 'dev-private-key' },
    { VEYRA_SIGNER_BACKEND: 'kms' },
  ])('refuses unsafe configuration %j', (overrides) => {
    expect(() => assertFreeAcceptanceBootstrapEnvironment({ ...valid(), ...overrides }))
      .toThrow();
  });
});
