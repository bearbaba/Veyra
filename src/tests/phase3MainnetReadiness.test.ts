import { describe, expect, it } from 'vitest';
import { PROVIDER_MANIFEST } from '../providers/registry/providerManifest.js';
import { evaluateMainnetReadiness } from '../../server/readiness/mainnetReadiness.js';

describe('Phase 3A mainnet readiness gate', () => {
  it('fails closed until at least one mainnet provider is explicitly enabled', () => {
    const report = evaluateMainnetReadiness({
      NODE_ENV: 'production', DATABASE_URL: 'postgres://u:p@db.example.com/v',
      VEYRA_SESSION_SECRET: '01234567890123456789012345678901', VEYRA_APP_ORIGIN: 'https://app.example.com',
      VEYRA_SIGNER_BACKEND: 'kms', VEYRA_KMS_KEY_ID: 'alias/key', X_CLIENT_ID: 'x', X_REDIRECT_URI: 'https://app.example.com/cb',
    }, PROVIDER_MANIFEST);
    expect(report.ready).toBe(false);
    expect(report.checks.find((c) => c.id === 'mainnet-provider-present')?.ok).toBe(false);
  });
});
