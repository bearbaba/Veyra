import { describe, expect, it } from 'vitest';
import { PROVIDER_MANIFEST } from '../providers/registry/providerManifest.js';
import { REQUIRED_PRODUCTION_TABLES, REQUIRED_PHASE5_RECEIPT_COLUMNS, assessDatabaseSnapshot } from '../../server/readiness/databaseReadiness.js';
import { evaluateMainnetReadiness } from '../../server/readiness/mainnetReadiness.js';

describe('Phase 3C mainnet readiness gate', () => {
  const safeEnv: NodeJS.ProcessEnv = {
    NODE_ENV: 'production', DATABASE_URL: 'postgres://u:p@db.example.com/v',
    VEYRA_SESSION_SECRET: '01234567890123456789012345678901', VEYRA_APP_ORIGIN: 'https://app.example.com',
    VEYRA_SIGNER_BACKEND: 'kms', VEYRA_KMS_KEY_ID: 'alias/key',
    VEYRA_SIGNER_URL: 'https://signer.example.com', VEYRA_SIGNER_AUTH_TOKEN: '01234567890123456789012345678901',
    X_CLIENT_ID: 'x', X_REDIRECT_URI: 'https://app.example.com/cb',
  };

  it('recognizes the verified mainnet provider catalog but still blocks execution', () => {
    const database = assessDatabaseSnapshot({ connected: true, tables: [...REQUIRED_PRODUCTION_TABLES], activityReceiptColumns: [...REQUIRED_PHASE5_RECEIPT_COLUMNS], drizzleMigrationCount: 13 });
    const signer = { ready: true, checks: [{ id: 'signer-health', ok: true, detail: 'ok' }] };
    const report = evaluateMainnetReadiness(safeEnv, PROVIDER_MANIFEST, { database, signer });
    expect(report.checks.find((c) => c.id === 'mainnet-provider-catalog')?.ok).toBe(true);
    expect(report.checks.find((c) => c.id === 'mainnet-provider-present')?.ok).toBe(false);
    expect(report.ready).toBe(false);
  });

  it('blocks when production database verification is missing', () => {
    const report = evaluateMainnetReadiness(safeEnv, PROVIDER_MANIFEST);
    expect(report.checks.find((c) => c.id === 'database-readiness')?.ok).toBe(false);
  });

  it('fails closed for DEGRADED, future-dated and stale mainnet provider health', () => {
    const candidate = PROVIDER_MANIFEST.find((provider) => provider.providerId === 'mainnet-usdc-transfer')!;
    const enabled = { ...candidate, lifecycleStage: 'ENABLED' as const, enabled: true };
    const now = 1_000_000;
    for (const record of [
      { providerId: enabled.providerId, status: 'DEGRADED' as const, checkedAt: now - 1_000 },
      { providerId: enabled.providerId, status: 'OK' as const, checkedAt: now + 1 },
      { providerId: enabled.providerId, status: 'OK' as const, checkedAt: now - 1_000_000 },
    ]) {
      const report = evaluateMainnetReadiness(safeEnv, [enabled], { now, providerHealth: [record] });
      expect(report.checks.find((check) => check.id === 'provider-runtime-health')?.ok).toBe(false);
      expect(report.ready).toBe(false);
    }
    const good = evaluateMainnetReadiness(safeEnv, [enabled], {
      now, providerHealth: [{ providerId: enabled.providerId, status: 'OK', checkedAt: now - 1_000 }],
    });
    expect(good.checks.find((check) => check.id === 'provider-runtime-health')?.ok).toBe(true);
  });

  it('rejects a disabled-trust provider even if its runtime health is OK', () => {
    const candidate = PROVIDER_MANIFEST.find((provider) => provider.providerId === 'mainnet-usdc-transfer')!;
    const enabled = { ...candidate, enabled: true, lifecycleStage: 'ENABLED' as const, trustStatus: 'DISABLED' as const };
    const now = 1_000_000;
    const report = evaluateMainnetReadiness(safeEnv, [enabled], {
      now, providerHealth: [{ providerId: enabled.providerId, status: 'OK', checkedAt: now }],
    });
    expect(report.checks.find((check) => check.id === 'provider-verification')?.ok).toBe(false);
  });

});
