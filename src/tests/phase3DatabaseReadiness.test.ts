import { describe, expect, it } from 'vitest';
import { assessDatabaseSnapshot, REQUIRED_PRODUCTION_TABLES } from '../../server/readiness/databaseReadiness.js';

describe('Phase 3B database readiness assessment', () => {
  it('passes only with connectivity, all tables, and migration history', () => {
    const report = assessDatabaseSnapshot({
      connected: true,
      databaseName: 'veyra',
      serverVersion: '16',
      tables: [...REQUIRED_PRODUCTION_TABLES],
      drizzleMigrationCount: 6,
      latencyMs: 4,
    });
    expect(report.ready).toBe(true);
  });

  it('fails when migrations or schema are incomplete', () => {
    const report = assessDatabaseSnapshot({
      connected: true,
      tables: REQUIRED_PRODUCTION_TABLES.slice(0, -1),
      drizzleMigrationCount: 5,
    });
    expect(report.ready).toBe(false);
    expect(report.checks.find((c) => c.id === 'database-schema')?.ok).toBe(false);
    expect(report.checks.find((c) => c.id === 'drizzle-migrations')?.ok).toBe(false);
  });
});
