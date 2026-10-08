import { describe, expect, it } from 'vitest';
import { validateServerRuntimeConfig } from '../../server/config/runtimeConfig.js';

describe('Phase 3A production runtime gate', () => {
  const safeMainnetEnv: NodeJS.ProcessEnv = {
    VEYRA_ENV: 'mainnet', NODE_ENV: 'production',
    DATABASE_URL: 'postgres://veyra:secret@db.example.com:5432/veyra',
    VEYRA_SESSION_SECRET: '01234567890123456789012345678901',
    VEYRA_APP_ORIGIN: 'https://app.veyra.example',
    VEYRA_SIGNER_BACKEND: 'kms', VEYRA_KMS_KEY_ID: 'alias/veyra-mainnet-relayer',
    X_CLIENT_ID: 'client', X_REDIRECT_URI: 'https://app.veyra.example/api/auth/x/callback',
  };

  it('accepts a production-shaped mainnet configuration', () => {
    expect(validateServerRuntimeConfig(safeMainnetEnv).ok).toBe(true);
  });

  it('rejects a raw private key in mainnet', () => {
    const result = validateServerRuntimeConfig({ ...safeMainnetEnv, RELAY_PRIVATE_KEY: '0xdeadbeef' });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('RELAY_PRIVATE_KEY'))).toBe(true);
  });

  it('rejects testnet RPC leakage in mainnet', () => {
    const result = validateServerRuntimeConfig({ ...safeMainnetEnv, ETH_RPC_URL: 'https://sepolia.example.com' });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('testnet marker'))).toBe(true);
  });
});
