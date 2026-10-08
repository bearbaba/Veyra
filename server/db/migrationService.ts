import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

export interface MigrationRunResult {
  ok: true;
  durationMs: number;
}

export async function runDatabaseMigrations(
  databaseUrl: string,
  logger: Pick<Console, 'log'> = console,
): Promise<MigrationRunResult> {
  const startedAt = Date.now();
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  const db = drizzle(pool);
  const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), 'migrations');
  try {
    logger.log(`[migrate] connecting to ${databaseUrl.replace(/:[^:@]+@/, ':***@')}`);
    logger.log(`[migrate] applying migrations from ${migrationsDir}`);
    await migrate(db, { migrationsFolder: migrationsDir });
    logger.log('[migrate] all migrations applied successfully');
    return { ok: true, durationMs: Date.now() - startedAt };
  } finally {
    await pool.end().catch(() => undefined);
  }
}
