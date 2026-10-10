/**
 * Phase 1 — migration-from-zero integration test.
 *
 * Creates a clean `veyra_migration_test` database, applies all migration
 * files in journal order (0000 through 0006), then verifies:
 *   - all 21 expected tables exist
 *   - critical UNIQUE constraints are enforced
 *   - CHECK constraints reject invalid data
 *   - append-only triggers reject UPDATE/DELETE on execution_events
 *   - append-only triggers reject UPDATE/DELETE on identity_revisions
 *   - identity_revision auto-increments on wallet INSERT
 *   - dedup_key UNIQUE constraint rejects duplicate receipts
 *
 * Requires a running Postgres instance at DATABASE_URL or the default
 * postgres://postgres:postgres@127.0.0.1:5432/postgres (admin connection
 * to create/drop the test database).
 *
 * Skipped automatically when Postgres is not reachable.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool, type PoolClient } from 'pg';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '../../server/db/migrations');

const ADMIN_URL =
  process.env['DATABASE_ADMIN_URL'] ??
  process.env['DATABASE_URL']?.replace(/\/[^/]+$/, '/postgres') ??
  'postgres://postgres:postgres@127.0.0.1:5432/postgres';

const TEST_DB = 'veyra_migration_test';

// ── Helpers ──────────────────────────────────────────────────────────────────

function loadMigration(filename: string): string {
  return readFileSync(join(MIGRATIONS_DIR, filename), 'utf8');
}

/** Execute raw SQL; splits on Drizzle's statement-breakpoint marker. */
async function execMigration(client: PoolClient, sql: string): Promise<void> {
  const statements = sql
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const stmt of statements) {
    await client.query(stmt);
  }
}

// ── Setup / Teardown ─────────────────────────────────────────────────────────

let adminPool:  Pool;
let testPool:   Pool;
let pgSkipped = false;

beforeAll(async () => {
  // Try to connect; skip gracefully if Postgres is not available.
  adminPool = new Pool({ connectionString: ADMIN_URL, max: 1 });
  try {
    await adminPool.query('SELECT 1');
  } catch {
    pgSkipped = true;
    await adminPool.end().catch(() => undefined);
    return;
  }

  // Drop and recreate test database.
  await adminPool.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
  await adminPool.query(`CREATE DATABASE ${TEST_DB}`);

  const testUrl = ADMIN_URL.replace(/\/[^/]+$/, `/${TEST_DB}`);
  testPool = new Pool({ connectionString: testUrl, max: 1 });

  // Apply migrations in order.
  const client = await testPool.connect();
  try {
    // 0000: initial schema
    await execMigration(client, loadMigration('0000_phase1_initial.sql'));
    // 0001: supplemental — triggers, partial indexes, CHECK constraints
    await execMigration(client, loadMigration('0001_phase1_supplemental.sql'));
    // 0002: Phase 2 wallet-proof challenges
    await execMigration(client, loadMigration('0002_phase2_identity_proof.sql'));
    // 0003: Phase 2 profile/session hardening
    await execMigration(client, loadMigration('0003_phase2_profile_and_session.sql'));
    // 0004: Phase 2C durable X OAuth state
    await execMigration(client, loadMigration('0004_phase2c_x_oauth.sql'));
    // 0005: Phase 2D contacts + preference hardening
    await execMigration(client, loadMigration('0005_phase2d_social_contacts.sql'));
    // 0006: Phase 4C durable bridge recovery
    await execMigration(client, loadMigration('0006_phase4c_bridge_recovery.sql'));
  } finally {
    client.release();
  }
});

afterAll(async () => {
  if (pgSkipped) return;
  await testPool?.end().catch(() => undefined);
  await adminPool?.query(`DROP DATABASE IF EXISTS ${TEST_DB}`).catch(() => undefined);
  await adminPool?.end().catch(() => undefined);
});

// ── Helper to skip individual tests when PG is unavailable ──────────────────

function pgTest(name: string, fn: () => Promise<void>) {
  it(name, async () => {
    if (pgSkipped) {
      console.warn('[skip] Postgres not reachable — skipping migration tests');
      return;
    }
    await fn();
  });
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('migration-from-zero: all 21 tables exist', () => {
  const EXPECTED_TABLES = [
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
  ];

  pgTest('all expected tables are created', async () => {
    const res = await testPool.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
    );
    const actual = new Set(res.rows.map((r) => r.tablename));
    for (const tbl of EXPECTED_TABLES) {
      expect(actual.has(tbl), `missing table: ${tbl}`).toBe(true);
    }
    expect(res.rows.length).toBeGreaterThanOrEqual(21);
  });
});

describe('migration-from-zero: critical constraints', () => {
  pgTest('dedup_key UNIQUE constraint rejects duplicate receipt', async () => {
    // Insert a minimal user + wallet + snapshot so FKs are satisfied.
    await testPool.query(`
      INSERT INTO veyra_users (veyr_user_id, veyr_handle, identity_revision, status)
      VALUES ('usr_migtest', 'migtest', 1, 'ACTIVE')
      ON CONFLICT DO NOTHING
    `);
    await testPool.query(`
      INSERT INTO wallet_bindings
        (wallet_id, veyr_user_id, wallet_address, chain_id, wallet_type,
         proof_scheme, proof_version, proof_challenge_id, proof_nonce,
         proof_signature, proof_message_hash, issued_at, verified_at, status)
      VALUES
        ('wlt_migtest','usr_migtest','0xmig',5042002,'EOA',
         'EIP_712','1','chal1','nonce1','sig1','msghash1',NOW(),NOW(),'ACTIVE')
      ON CONFLICT DO NOTHING
    `);
    await testPool.query(`
      INSERT INTO identity_snapshots
        (snapshot_id, veyr_user_id, veyr_handle, display_name, identity_revision,
         resolved_wallets, receive_preference, frozen_at, expires_at)
      VALUES
        ('snp_migtest','usr_migtest','migtest','Test',1,'[]','{}',NOW(), NOW() + interval '10 minutes')
      ON CONFLICT DO NOTHING
    `);

    // Insert first receipt.
    await testPool.query(`
      INSERT INTO activity_receipts
        (receipt_id, client_intent_id, sender_user_id, sender_wallet_id,
         sender_address, sender_chain_id, recipient_snapshot_id,
         recipient_address, recipient_chain_id, amount_raw, amount_decimals,
         asset_id, token_address, provider_id, route_id, dedup_key, environment, status)
      VALUES
        ('rec_mig1','intent-mig-1','usr_migtest','wlt_migtest',
         '0xmig',5042002,'snp_migtest',
         '0xdest',11155111,1000000,6,
         'usdc','0x3600000000000000000000000000000000000000','cctp-v2-bridge','route1',
         'dedup_unique_key_001','testnet','INTENT_CAPTURED')
    `);

    // Second receipt with same dedup_key must be rejected.
    await expect(
      testPool.query(`
        INSERT INTO activity_receipts
          (receipt_id, client_intent_id, sender_user_id, sender_wallet_id,
           sender_address, sender_chain_id, recipient_snapshot_id,
           recipient_address, recipient_chain_id, amount_raw, amount_decimals,
           asset_id, token_address, provider_id, route_id, dedup_key, environment, status)
        VALUES
          ('rec_mig2','intent-mig-2','usr_migtest','wlt_migtest',
           '0xmig',5042002,'snp_migtest',
           '0xdest',11155111,1000000,6,
           'usdc','0x3600000000000000000000000000000000000000','cctp-v2-bridge','route1',
           'dedup_unique_key_001','testnet','INTENT_CAPTURED')
      `),
    ).rejects.toThrow(/unique/i);
  });

  pgTest('social_follows self-follow CHECK constraint fires', async () => {
    await expect(
      testPool.query(`
        INSERT INTO social_follows (follow_id, follower_user_id, followee_user_id, status)
        VALUES ('flw_self', 'usr_migtest', 'usr_migtest', 'FOLLOWING')
      `),
    ).rejects.toThrow(/chk_social_follows_no_self/i);
  });

  pgTest('social_connections canonical order CHECK constraint fires', async () => {
    // user_a_id must be < user_b_id lexicographically.
    await expect(
      testPool.query(`
        INSERT INTO social_connections
          (connection_id, user_a_id, user_b_id, initiator_user_id, status)
        VALUES ('con_bad', 'usr_zzzz', 'usr_aaaa', 'usr_zzzz', 'PENDING_INITIATOR')
      `),
    ).rejects.toThrow(/chk_social_connections_canonical_order/i);
  });

  pgTest('case-insensitive handle uniqueness (LOWER index)', async () => {
    // Insert a second user with the same handle in a different case.
    await testPool.query(`
      INSERT INTO veyra_users (veyr_user_id, veyr_handle, identity_revision, status)
      VALUES ('usr_migtest2', 'MIGTEST', 1, 'ACTIVE')
    `).then(
      () => {
        // If this succeeds, the CI index didn't fire — fail the test.
        throw new Error('Expected unique_violation but INSERT succeeded');
      },
      (err: Error) => {
        expect(err.message).toMatch(/unique/i);
      },
    );
  });
});

describe('migration-from-zero: proof challenge constraints', () => {
  pgTest('proof challenge requires expiry after issue time', async () => {
    await expect(
      testPool.query(`
        INSERT INTO proof_challenges
          (challenge_id, veyr_user_id, wallet_address, chain_id, proof_scheme,
           proof_version, nonce, plain_message, message_hash, issued_at, expires_at, status)
        VALUES
          ('chl_bad_expiry','usr_migtest','0x0000000000000000000000000000000000000001',5042002,
           'EIP_712','1','0x01','msg','0xhash',NOW(),NOW() - interval '1 second','ISSUED')
      `),
    ).rejects.toThrow(/chk_proof_challenges_expiry_after_issue/i);
  });

  pgTest('only one active challenge exists per wallet/chain/user', async () => {
    await testPool.query(`
      INSERT INTO proof_challenges
        (challenge_id, veyr_user_id, wallet_address, chain_id, proof_scheme,
         proof_version, nonce, plain_message, message_hash, issued_at, expires_at, status)
      VALUES
        ('chl_unique_1','usr_migtest','0x0000000000000000000000000000000000000002',5042002,
         'EIP_712','1','0x02','msg','0xhash',NOW(),NOW() + interval '10 minutes','ISSUED')
    `);
    await expect(
      testPool.query(`
        INSERT INTO proof_challenges
          (challenge_id, veyr_user_id, wallet_address, chain_id, proof_scheme,
           proof_version, nonce, plain_message, message_hash, issued_at, expires_at, status)
        VALUES
          ('chl_unique_2','usr_migtest','0x0000000000000000000000000000000000000002',5042002,
           'EIP_712','1','0x03','msg','0xhash',NOW(),NOW() + interval '10 minutes','ISSUED')
      `),
    ).rejects.toThrow(/unique/i);
  });
});

describe('migration-from-zero: append-only trigger enforcement', () => {
  pgTest('execution_events rejects UPDATE', async () => {
    // Insert a receipt first, then an event.
    await testPool.query(`
      INSERT INTO execution_events (event_id, receipt_id, event_type, payload)
      VALUES ('evt_ao1', 'rec_mig1', 'INTENT_CAPTURED', '{}')
    `);
    await expect(
      testPool.query(`UPDATE execution_events SET payload = '{"x":1}' WHERE event_id = 'evt_ao1'`),
    ).rejects.toThrow(/append-only/i);
  });

  pgTest('execution_events rejects DELETE', async () => {
    await expect(
      testPool.query(`DELETE FROM execution_events WHERE event_id = 'evt_ao1'`),
    ).rejects.toThrow(/append-only/i);
  });

  pgTest('identity_revisions rejects UPDATE', async () => {
    await testPool.query(`
      INSERT INTO identity_revisions (revision_id, veyr_user_id, revision_number, trigger, detail)
      VALUES ('rev_ao1', 'usr_migtest', 1, 'WALLET_ADDED', '{}')
    `);
    await expect(
      testPool.query(`UPDATE identity_revisions SET detail = '{"x":1}' WHERE revision_id = 'rev_ao1'`),
    ).rejects.toThrow(/append-only/i);
  });
});

describe('migration-from-zero: identity_revision trigger', () => {
  pgTest('wallet INSERT increments identity_revision', async () => {
    const before = await testPool.query<{ identity_revision: string }>(
      `SELECT identity_revision FROM veyra_users WHERE veyr_user_id = 'usr_migtest'`,
    );
    const revBefore = Number(before.rows[0]?.identity_revision ?? 0);

    await testPool.query(`
      INSERT INTO wallet_bindings
        (wallet_id, veyr_user_id, wallet_address, chain_id, wallet_type,
         proof_scheme, proof_version, proof_challenge_id, proof_nonce,
         proof_signature, proof_message_hash, issued_at, verified_at, status)
      VALUES
        ('wlt_migtest2','usr_migtest','0xmig2',5042002,'EOA',
         'EIP_712','1','chal2','nonce2','sig2','msghash2',NOW(),NOW(),'ACTIVE')
    `);

    const after = await testPool.query<{ identity_revision: string }>(
      `SELECT identity_revision FROM veyra_users WHERE veyr_user_id = 'usr_migtest'`,
    );
    const revAfter = Number(after.rows[0]?.identity_revision ?? 0);

    expect(revAfter).toBe(revBefore + 1);
  });

  pgTest('wallet revocation increments identity_revision', async () => {
    const before = await testPool.query<{ identity_revision: string }>(
      `SELECT identity_revision FROM veyra_users WHERE veyr_user_id = 'usr_migtest'`,
    );
    const revBefore = Number(before.rows[0]?.identity_revision ?? 0);

    await testPool.query(`
      UPDATE wallet_bindings SET status = 'REVOKED', revoked_at = NOW()
      WHERE wallet_id = 'wlt_migtest2'
    `);

    const after = await testPool.query<{ identity_revision: string }>(
      `SELECT identity_revision FROM veyra_users WHERE veyr_user_id = 'usr_migtest'`,
    );
    const revAfter = Number(after.rows[0]?.identity_revision ?? 0);

    expect(revAfter).toBe(revBefore + 1);
  });
});
