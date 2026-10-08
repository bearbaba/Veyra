import { describe, expect, it } from 'vitest';
import { PROVIDER_MANIFEST } from '../providers/registry/providerManifest.js';
import { REQUIRED_PRODUCTION_TABLES, assessDatabaseSnapshot } from '../../server/readiness/databaseReadiness.js';
import { evaluateMainnetReadiness } from '../../server/readiness/mainnetReadiness.js';

describe('Phase 3B mainnet readiness gate', () => {
  const safeEnv: NodeJS.ProcessEnv = {
    NODE_ENV: 'production', DATABASE_URL: 'postgres://u:p@db.example.com/v',
    VEYRA_SESSION_SECRET: '01234567890123456789012345678901', VEYRA_APP_ORIGIN: 'https://app.example.com',
    VEYRA_SIGNER_BACKEND: 'kms', VEYRA_KMS_KEY_ID: 'alias/key', X_CLIENT_ID: 'x', X_REDIRECT_URI: 'https://app.example.com/cb',
  };

  it('recognizes the verified mainnet provider catalog but still blocks execution', () => {
    const database = assessDatabaseSnapshot({ connected: true, tables: [...REQUIRED_PRODUCTION_TABLES], drizzleMigrationCount: 6 });
    const report = evaluateMainnetReadiness(safeEnv, PROVIDER_MANIFEST, { database });
    expect(report.checks.find((c) => c.id === 'mainnet-provider-catalog')?.ok).toBe(true);
    expect(report.checks.find((c) => c.id === 'mainnet-provider-present')?.ok).toBe(false);
    expect(report.ready).toBe(false);
  });

  it('blocks when production database verification is missing', () => {
    const report = evaluateMainnetReadiness(safeEnv, PROVIDER_MANIFEST);
    expect(report.checks.find((c) => c.id === 'database-readiness')?.ok).toBe(false);
  });
});
