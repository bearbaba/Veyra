/**
 * Explicitly opted-in Render Free acceptance bootstrap.
 *
 * Render Free Web Services do not support a separate pre-deploy migration
 * command. This is a deliberately restricted, disposable Testnet alternative:
 * serialize an idempotent migration before importing and starting the BFF.
 * NEVER use for Mainnet or a production database.
 */
import { Client } from 'pg';
import { assertHostedTestnetMigrationEnvironment } from './hostedTestnetPredeploy.js';
import { runDatabaseMigrations } from './migrationService.js';
import { probeDatabaseReadiness } from '../readiness/databaseReadiness.js';

const ACCEPTANCE_DB_NAME = 'veyra_testnet_acceptance_db';

export function assertFreeAcceptanceBootstrapEnvironment(env: NodeJS.ProcessEnv): string {
  if (env.VEYRA_ACCEPTANCE_BOOTSTRAP !== '1') {
    throw new Error('[free-acceptance] Explicit VEYRA_ACCEPTANCE_BOOTSTRAP=1 is required.');
  }
  if (env.VEYRA_DATABASE_PRIVATE_NETWORK !== '1') {
    throw new Error('[free-acceptance] Private Render database network is required.');
  }
  if (env.RELAY_PRIVATE_KEY || env.VEYRA_ENABLE_TESTNET_RELAY === '1' ||
      (env.VEYRA_SIGNER_BACKEND && env.VEYRA_SIGNER_BACKEND !== 'none')) {
    throw new Error('[free-acceptance] Financial relay/signer configuration is forbidden.');
  }
  const url = assertHostedTestnetMigrationEnvironment(env);
  const parsed = new URL(url);
  // This acceptance bootstrap may only migrate the one named, disposable DB.
  if (parsed.pathname !== '/' + ACCEPTANCE_DB_NAME) {
    throw new Error('[free-acceptance] Refusing to migrate any database outside isolated Testnet acceptance.');
  }
  return url;
}

export async function bootstrapFreeAcceptance(): Promise<void> {
  const databaseUrl = assertFreeAcceptanceBootstrapEnvironment(process.env);
  const lockClient = new Client({ connectionString: databaseUrl });
  await lockClient.connect();
  try {
    // Session-scoped advisory lock serializes migrations between possible
    // overlapping deploys. Drizzle's migration journal remains the source
    // of truth for which migrations have been applied.
    await lockClient.query('SELECT pg_advisory_lock(8268, 32805)');
    try {
      await runDatabaseMigrations(databaseUrl);
      const readiness = await probeDatabaseReadiness(databaseUrl);
      if (!readiness.ready) {
        throw new Error('[free-acceptance] PostgreSQL schema readiness failed after migration.');
      }
    } finally {
      await lockClient.query('SELECT pg_advisory_unlock(8268, 32805)');
    }
  } finally {
    await lockClient.end();
  }
  console.log('[free-acceptance] Disposable Testnet migrations complete; starting BFF.');
  // Bun executes the TypeScript entrypoint only after the DB gate succeeds.
  // No financial transaction or wallet signing is performed by bootstrap.
  await import('../bff.ts');
}

if (import.meta.main) {
  bootstrapFreeAcceptance().catch((error: unknown) => {
    // Never print the database URL or raw driver error containing credentials.
    const reason = error instanceof Error && error.message.startsWith('[free-acceptance]')
      ? error.message
      : '[free-acceptance] Bootstrap failed. Review private service logs.';
    console.error(reason);
    process.exitCode = 1;
  });
}
