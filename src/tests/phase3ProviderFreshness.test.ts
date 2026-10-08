import { describe, expect, it } from 'vitest';
import { SECURITY_CONFIG } from '../lib/securityConfig.js';
import { REQUIRED_PRODUCTION_TABLES, assessDatabaseSnapshot } from '../../server/readiness/databaseReadiness.js';
import { evaluateMainnetReadiness } from '../../server/readiness/mainnetReadiness.js';
import { MAINNET_PROVIDER_MANIFEST } from '../providers/registry/mainnetProviderManifest.js';

const safeEnv: NodeJS.ProcessEnv = {
  NODE_ENV: 'production', DATABASE_URL: 'postgres://u:p@db.example.com/v',
  VEYRA_SESSION_SECRET: '01234567890123456789012345678901', VEYRA_APP_ORIGIN: 'https://app.example.com',
  VEYRA_SIGNER_BACKEND: 'kms', VEYRA_KMS_KEY_ID: 'alias/key', VEYRA_SIGNER_URL: 'https://signer.example.com',
  VEYRA_SIGNER_AUTH_TOKEN: '01234567890123456789012345678901', X_CLIENT_ID: 'x', X_REDIRECT_URI: 'https://app.example.com/cb',
};

const database = assessDatabaseSnapshot({ connected: true, tables: [...REQUIRED_PRODUCTION_TABLES], drizzleMigrationCount: 6 });
const signer = { ready: true, checks: [{ id: 'signer-health', ok: true, detail: 'ok' }] };

describe('Phase 3C provider freshness gate', () => {
  it('rejects stale health even for an otherwise enabled provider', () => {
    const provider = { ...MAINNET_PROVIDER_MANIFEST[0], enabled: true, lifecycleStage: 'ENABLED' as const };
    const now = 1_000_000;
    const report = evaluateMainnetReadiness(safeEnv, [provider], {
      database,
      signer,
      now,
      providerHealth: [{ providerId: provider.providerId, status: 'OK', checkedAt: now - SECURITY_CONFIG.MAX_PROVIDER_HEALTH_AGE_MS - 1 }],
    });
    expect(report.checks.find((check) => check.id === 'provider-runtime-health')?.ok).toBe(false);
  });
});
