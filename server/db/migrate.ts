/**
 * Veyra database migration runner.
 *
 * Usage: bun run db:migrate
 * Applies every migration in server/db/migrations/ using Drizzle's migration journal.
 */
import { runDatabaseMigrations } from './migrationService.js';

const databaseUrl = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/veyra';

runDatabaseMigrations(databaseUrl).catch((error) => {
  console.error('[migrate] FATAL:', error);
  process.exit(1);
});
