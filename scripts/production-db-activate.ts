import { assertServerRuntimeConfig } from '../server/config/runtimeConfig.js';
import { runDatabaseMigrations } from '../server/db/migrationService.js';
import { probeDatabaseReadiness } from '../server/readiness/databaseReadiness.js';

const runtime = assertServerRuntimeConfig({ ...process.env, VEYRA_ENV: 'mainnet' });
if (!runtime.databaseUrl) throw new Error('DATABASE_URL is required.');

await runDatabaseMigrations(runtime.databaseUrl);
const report = await probeDatabaseReadiness(runtime.databaseUrl);
console.log(JSON.stringify(report, null, 2));
if (!report.ready) process.exit(1);
