import { Pool } from 'pg';

export const REQUIRED_PRODUCTION_TABLES = [
  'veyra_users',
  'handle_history',
  'linked_identities',
  'wallet_bindings',
  'proof_challenges',
  'oauth_link_states',
  'contacts',
  'identity_snapshots',
  'receive_preferences',
  'social_follows',
  'social_connections',
  'social_blocks',
  'activity_receipts',
  'execution_events',
  'identity_revisions',
  'intents',
  'route_quotes',
  'posts',
  'post_interactions',
  'post_tips',
  'bridge_recovery_checkpoints',
  'bridge_destination_submission_claims',
  'bridge_destination_attempt_events',
  'bridge_destination_attempt_resolutions',
  'bridge_destination_retry_attempts',
  'bridge_destination_retry_events',
  'bridge_destination_retry_verifications',
] as const;

export const REQUIRED_PHASE5_RECEIPT_COLUMNS = [
  'settlement_receive_tx_hash',
  'settlement_receive_block_number',
  'settlement_attempt_number',
] as const;
export const REQUIRED_DATABASE_MIGRATIONS = 13; // 0000 through 0012 inclusive

export interface DatabaseProbeSnapshot {
  connected: boolean;
  databaseName?: string;
  serverVersion?: string;
  tables: string[];
  activityReceiptColumns?: string[];
  drizzleMigrationCount?: number;
  latencyMs?: number;
  error?: string;
}

export interface DatabaseReadinessReport {
  ready: boolean;
  checks: Array<{ id: string; ok: boolean; detail: string }>;
  snapshot: Omit<DatabaseProbeSnapshot, 'error'> & { error?: string };
}

export function assessDatabaseSnapshot(snapshot: DatabaseProbeSnapshot): DatabaseReadinessReport {
  const present = new Set(snapshot.tables);
  const missing = REQUIRED_PRODUCTION_TABLES.filter((table) => !present.has(table));
  const receiptColumns = new Set(snapshot.activityReceiptColumns ?? []);
  const missingPhase5Columns = REQUIRED_PHASE5_RECEIPT_COLUMNS.filter((column) => !receiptColumns.has(column));
  const checks = [
    {
      id: 'database-connectivity',
      ok: snapshot.connected,
      detail: snapshot.connected
        ? `Connected to ${snapshot.databaseName ?? 'Postgres'} in ${snapshot.latencyMs ?? 0}ms.`
        : `Database connection failed${snapshot.error ? `: ${snapshot.error}` : '.'}`,
    },
    {
      id: 'database-schema',
      ok: snapshot.connected && missing.length === 0,
      detail: missing.length === 0 ? `All ${REQUIRED_PRODUCTION_TABLES.length} required tables are present.` : `Missing tables: ${missing.join(', ')}`,
    },
    {
      id: 'phase5-settlement-columns',
      ok: snapshot.connected && missingPhase5Columns.length === 0,
      detail: missingPhase5Columns.length === 0
        ? 'All required Phase 5 second-settlement receipt columns are present.'
        : `Missing Phase 5 receipt columns: ${missingPhase5Columns.join(', ')}`,
    },
    {
      id: 'drizzle-migrations',
      ok: snapshot.connected && (snapshot.drizzleMigrationCount ?? 0) >= REQUIRED_DATABASE_MIGRATIONS,
      detail: `Drizzle migration records: ${snapshot.drizzleMigrationCount ?? 0}; expected at least ${REQUIRED_DATABASE_MIGRATIONS} (0000-0012).`,
    },
  ];
  return { ready: checks.every((check) => check.ok), checks, snapshot };
}

export async function probeDatabaseReadiness(
  databaseUrl: string | undefined = process.env.DATABASE_URL,
): Promise<DatabaseReadinessReport> {
  if (!databaseUrl) {
    return assessDatabaseSnapshot({ connected: false, tables: [], error: 'DATABASE_URL is not configured.' });
  }

  const startedAt = Date.now();
  const pool = new Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 5_000 });
  try {
    const meta = await pool.query<{ database_name: string; server_version: string }>(
      `SELECT current_database() AS database_name, current_setting('server_version') AS server_version`,
    );
    const tables = await pool.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
    );
    const receiptColumns = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'activity_receipts'
       ORDER BY column_name`,
    );
    const migrationTable = await pool.query<{ present: boolean }>(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'drizzle' AND table_name = '__drizzle_migrations'
      ) AS present
    `);
    let drizzleMigrationCount = 0;
    if (migrationTable.rows[0]?.present) {
      const count = await pool.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM drizzle.__drizzle_migrations`);
      drizzleMigrationCount = Number.parseInt(count.rows[0]?.count ?? '0', 10);
    }
    return assessDatabaseSnapshot({
      connected: true,
      databaseName: meta.rows[0]?.database_name,
      serverVersion: meta.rows[0]?.server_version,
      tables: tables.rows.map((row) => row.tablename),
      activityReceiptColumns: receiptColumns.rows.map((row) => row.column_name),
      drizzleMigrationCount,
      latencyMs: Date.now() - startedAt,
    });
  } catch (error) {
    return assessDatabaseSnapshot({
      connected: false,
      tables: [],
      latencyMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    await pool.end().catch(() => undefined);
  }
}
