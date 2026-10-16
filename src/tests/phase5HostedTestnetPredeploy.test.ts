import { describe, expect, it } from 'vitest';
import { assertHostedTestnetMigrationEnvironment } from '../../server/db/hostedTestnetPredeploy.js';

const validEnv: NodeJS.ProcessEnv = {
  NODE_ENV: 'production',
  VEYRA_ENV: 'testnet',
  VEYRA_HOSTED_BACKEND: '1',
  VEYRA_DATABASE_PRIVATE_NETWORK: '1',
  VEYRA_SESSION_SECRET: '01234567890123456789012345678901',
  VEYRA_APP_ORIGIN: 'https://veyra.example',
  DATABASE_URL: 'postgresql://app:example@internal.postgres/veyra',
};

describe('Hosted testnet pre-deploy migration authorization', () => {
  it('accepts only the fully specified production-shaped testnet context', () => {
    expect(assertHostedTestnetMigrationEnvironment(validEnv)).toBe(validEnv.DATABASE_URL);
  });

  it('refuses mainnet, local, dev and missing hosted flag before database access', () => {
    for (const override of [
      { VEYRA_ENV: 'mainnet' },
      { VEYRA_ENV: 'local' },
      { NODE_ENV: 'development' },
      { VEYRA_HOSTED_BACKEND: '0' },
    ]) {
      expect(() => assertHostedTestnetMigrationEnvironment({ ...validEnv, ...override }))
        .toThrow('Refusing to run migrations');
    }
  });

  it('refuses missing storage credentials, session secret or HTTPS app origin', () => {
    for (const override of [
      { DATABASE_URL: '' },
      { VEYRA_SESSION_SECRET: '' },
      { VEYRA_APP_ORIGIN: 'http://veyra.example' },
    ]) {
      expect(() => assertHostedTestnetMigrationEnvironment({ ...validEnv, ...override })).toThrow();
    }
  });
});
