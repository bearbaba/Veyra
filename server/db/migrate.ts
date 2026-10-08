/**
 * Veyra database migration runner.
 *
 * Usage (from project root):
 *   bun run db:migrate
 *
 * Applies every migration in server/db/migrations/ in journal order.
 * Safe to re-run: drizzle-orm's migrator skips already-applied migrations
 * by tracking them in the __drizzle_migrations table.
 *
 * Environment:
 *   DATABASE_URL — Postgres connection string.
 *                  Default: postgres://postgres:postgres@127.0.0.1:5432/veyra
 *
 * Migration files applied in order:
 *   0000_phase1_initial.sql        — 17 tables, enums, FKs, basic indexes
 *   0001_phase1_supplemental.sql   — partial indexes, triggers, CHECK constraints,
 *                                    PLpgSQL functions, append-only enforcement
 *   0002_phase2_identity_proof.sql — single-use wallet proof challenges
 *
 * A clean-clone workflow:
 *   1. Start an empty Postgres instance (e.g. `docker compose up -d postgres`)
 *   2. Run `bun run db:migrate`
 *   3. The exact schema — 18 tables, all indexes, all triggers, all constraints —
 *      is created deterministically from zero, with no manual psql steps.
 */

import { drizzle }  from 'drizzle-orm/node-postgres';
import { migrate }  from 'drizzle-orm/node-postgres/migrator';
import { Pool }     from 'pg';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgres://postgres:postgres@127.0.0.1:5432/veyra';

const pool = new Pool({ connectionString: DATABASE_URL, max: 1 });
const db   = drizzle(pool);

const __dirname    = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, 'migrations');

async function run(): Promise<void> {
  console.log(`[migrate] connecting to ${DATABASE_URL.replace(/:[^:@]+@/, ':***@')}`);
  console.log(`[migrate] applying migrations from ${migrationsDir}`);

  await migrate(db, { migrationsFolder: migrationsDir });

  console.log('[migrate] all migrations applied successfully');
  await pool.end();
}

run().catch((err) => {
  console.error('[migrate] FATAL:', err);
  process.exit(1);
});
