/**
 * One-shot, deliberately operator-authorized TESTNET database migration gate.
 * Used by the Render pre-deploy phase (never on concurrent HTTP server boots).
 * Refuses mainnet, dev, and incorrectly configured public backends.
 */
import { assertServerRuntimeConfig } from '../config/runtimeConfig.js';
import { runDatabaseMigrations } from './migrationService.js';
import { probeDatabaseReadiness } from '../readiness/databaseReadiness.js';

export function assertHostedTestnetMigrationEnvironment(env: NodeJS.ProcessEnv): string {
  if (env.VEYRA_ENV !== 'testnet' || env.NODE_ENV !== 'production' || env.VEYRA_HOSTED_BACKEND !== '1') {
    throw new Error('[testnet-predeploy] Refusing to run migrations outside the authorized hosted TESTNET environment.');
  }
  const result = assertServerRuntimeConfig(env);
  if (!result.databaseUrl) {
    throw new Error('[testnet-predeploy] DATABASE_URL is required.');
  }
  return result.databaseUrl;
}

async function main(): Promise<void> {
  const databaseUrl = assertHostedTestnetMigrationEnvironment(process.env);
  await runDatabaseMigrations(databaseUrl);
  const report = await probeDatabaseReadiness(databaseUrl);
  if (!report.ready) {
    throw new Error('[testnet-predeploy] Phase 5 database verification did not pass.');
  }
  console.log('[testnet-predeploy] Database migrations and Phase 5 readiness PASS (testnet infrastructure only).');
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : '[testnet-predeploy] Failed.');
    process.exitCode = 1;
  });
}
