/**
 * Drizzle ORM database client.
 * Uses a pooled pg connection (amendment: no per-request dedicated connections).
 * DATABASE_URL must be set in .env before the BFF starts.
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema/index.js';

if (!process.env['DATABASE_URL']) {
  throw new Error('[db/client] DATABASE_URL is not set. Add it to .env before starting the BFF.');
}

const pool = new Pool({
  connectionString: process.env['DATABASE_URL'],
  max: 20,               // pooled connections (amendment: no per-request dedicated connections)
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on('error', (err) => {
  console.error('[db/pool] Unexpected error on idle client:', err.message);
});

export const db = drizzle(pool, { schema });
export type DbClient = typeof db;
