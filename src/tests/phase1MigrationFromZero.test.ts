/**
 * Phase 1 — migration-from-zero integration test.
 *
 * Creates a clean `veyra_migration_test` database, applies all migration
 * files in journal order (0000 through 0011), then verifies:
 *   - all 27 expected tables exist
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
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../server/db/schema/index.js';
import {
  claimDestinationSubmission,
  getDestinationSubmissionClaim,
  recordDestinationSubmission,
} from '../../server/db/repositories/bridgeDestinationSubmissionRepository.js';
import { recordVerifiedFirstDestinationRevert } from '../../server/db/repositories/bridgeDestinationRevertRepository.js';
import {
  recordVerifiedSecondDestinationMint,
} from '../../server/db/repositories/bridgeSecondDestinationVerificationRepository.js';
import {
  claimSecondDestinationAttempt,
  getSecondDestinationAttempt,
  getOwnedDestinationAttemptHistory,
  recordSecondDestinationAttemptHash,
} from '../../server/db/repositories/bridgeDestinationRetryRepository.js';

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
  // Multiple connections are required to exercise simultaneous relay claims.
  testPool = new Pool({ connectionString: testUrl, max: 3 });

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
    // 0007: Phase 5 ActivityReceipt lifecycle
    await execMigration(
      client,
      loadMigration('0007_phase5_activity_receipt_lifecycle.sql'),
    );
    // 0008: Phase 5 first destination relay claim and append-only audit.
    await execMigration(
      client,
      loadMigration('0008_phase5_destination_submission_claims.sql'),
    );
    // 0009: Chain-verified and append-only destination attempt resolution.
    await execMigration(
      client,
      loadMigration('0009_phase5_destination_revert_evidence.sql'),
    );
    // 0010: Distinct second-attempt claim, first hash preserved and audit log.
    await execMigration(
      client,
      loadMigration('0010_phase5_second_destination_attempt.sql'),
    );
    // 0011: Independently verified successful second receive, append-only.
    await execMigration(
      client,
      loadMigration('0011_phase5_second_destination_verification.sql'),
    );
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

describe('migration-from-zero: all 27 tables exist', () => {
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
    'bridge_destination_submission_claims',
    'bridge_destination_attempt_events',
    'bridge_destination_attempt_resolutions',
    'bridge_destination_retry_attempts',
    'bridge_destination_retry_events',
    'bridge_destination_retry_verifications',
  ];

  pgTest('all expected tables are created', async () => {
    const res = await testPool.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
    );
    const actual = new Set(res.rows.map((r) => r.tablename));
    for (const tbl of EXPECTED_TABLES) {
      expect(actual.has(tbl), `missing table: ${tbl}`).toBe(true);
    }
    expect(res.rows.length).toBeGreaterThanOrEqual(27);
  });
});

describe('migration-from-zero: destination relay claim integrity', () => {
  pgTest('destination claims are unique and audit events are immutable', async () => {
    await testPool.query(`
      INSERT INTO veyra_users (veyr_user_id, veyr_handle, identity_revision, status)
      VALUES ('usr_relaymig', 'relaymig', 1, 'ACTIVE')
      ON CONFLICT DO NOTHING
    `);
    await testPool.query(`
      INSERT INTO bridge_recovery_checkpoints
        (plan_id, owner_user_id, stage, burn_tx_hash, source_chain_id,
         destination_chain_id, wallet_address, recipient_address,
         amount_raw, token_address, balance_before_raw)
      VALUES
        ('migration-relay-plan', 'usr_relaymig', 'ATTESTATION_READY',
         '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
         5042002, 11155111, '0x1111111111111111111111111111111111111111',
         '0x2222222222222222222222222222222222222222', 1000000,
         '0x3333333333333333333333333333333333333333', 0)
      ON CONFLICT DO NOTHING
    `);
    await testPool.query(`
      INSERT INTO bridge_destination_submission_claims (plan_id, owner_user_id)
      VALUES ('migration-relay-plan', 'usr_relaymig')
    `);
    await expect(
      testPool.query(`
        INSERT INTO bridge_destination_submission_claims (plan_id, owner_user_id)
        VALUES ('migration-relay-plan', 'usr_relaymig')
      `),
    ).rejects.toMatchObject({ code: '23505' });

    await testPool.query(`
      INSERT INTO bridge_destination_attempt_events (event_id, plan_id, event_type)
      VALUES ('relay-event-1', 'migration-relay-plan', 'SUBMISSION_STARTED')
    `);
    await expect(
      testPool.query(`
        UPDATE bridge_destination_attempt_events SET event_type = 'BROADCAST_RECORDED'
        WHERE event_id = 'relay-event-1'
      `),
    ).rejects.toMatchObject({ code: 'P0001' });
    await expect(
      testPool.query(`
        DELETE FROM bridge_destination_attempt_events WHERE event_id = 'relay-event-1'
      `),
    ).rejects.toMatchObject({ code: 'P0001' });
  });
});

describe('migration-from-zero: destination relay exactly-once submission', () => {
  pgTest('concurrent requests claim once and keep the exact first destination tx', async () => {
    await testPool.query(`
      INSERT INTO veyra_users (veyr_user_id, veyr_handle, identity_revision, status)
      VALUES ('usr_relay_claims', 'relayclaims', 1, 'ACTIVE')
      ON CONFLICT DO NOTHING
    `);
    await testPool.query(`
      INSERT INTO bridge_recovery_checkpoints
        (plan_id, owner_user_id, stage, burn_tx_hash, source_chain_id,
         destination_chain_id, wallet_address, recipient_address,
         amount_raw, token_address, balance_before_raw,
         attestation_message, attestation_signature)
      VALUES
        ('claims-concurrency-plan', 'usr_relay_claims', 'ATTESTATION_READY',
         '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
         5042002, 11155111, '0x1111111111111111111111111111111111111111',
         '0x2222222222222222222222222222222222222222', 1000000,
         '0x3333333333333333333333333333333333333333', 0,
         '0x1234', '0xabcd')
    `);

    const db = drizzle(testPool, { schema });
    const claims = await Promise.all([
      claimDestinationSubmission(db, 'usr_relay_claims', 'claims-concurrency-plan'),
      claimDestinationSubmission(db, 'usr_relay_claims', 'claims-concurrency-plan'),
    ]);

    expect(claims.map((r) => r.mode).sort()).toEqual(['CLAIMED', 'UNCERTAIN']);
    expect(await getDestinationSubmissionClaim(
      db, 'usr_relay_claims', 'claims-concurrency-plan',
    )).toEqual({ mode: 'UNCERTAIN' });

    const hash = `0x${'c'.repeat(64)}`;
    await recordDestinationSubmission(
      db, 'usr_relay_claims', 'claims-concurrency-plan', hash,
    );
    // Persisting the SAME hash is idempotent; a second hash must fail.
    await recordDestinationSubmission(
      db, 'usr_relay_claims', 'claims-concurrency-plan', hash,
    );
    await expect(recordDestinationSubmission(
      db, 'usr_relay_claims', 'claims-concurrency-plan', `0x${'d'.repeat(64)}`,
    )).rejects.toThrow(/already recorded/i);

    expect(await claimDestinationSubmission(
      db, 'usr_relay_claims', 'claims-concurrency-plan',
    )).toEqual({ mode: 'ALREADY_SUBMITTED', txHash: hash });

    const events = await testPool.query<{
      event_type: string;
      receive_tx_hash: string | null;
    }>(`
      SELECT event_type, receive_tx_hash FROM bridge_destination_attempt_events
      WHERE plan_id = 'claims-concurrency-plan' ORDER BY occurred_at
    `);
    expect(events.rows).toHaveLength(2);
    expect(events.rows.map((x) => x.event_type).sort())
      .toEqual(['BROADCAST_RECORDED', 'SUBMISSION_STARTED']);

    await expect(testPool.query(`
      UPDATE bridge_destination_submission_claims
        SET receive_tx_hash = '0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd'
        WHERE plan_id = 'claims-concurrency-plan'
    `)).rejects.toMatchObject({ code: 'P0001' });
    await expect(testPool.query(`
      DELETE FROM bridge_destination_submission_claims
        WHERE plan_id = 'claims-concurrency-plan'
    `)).rejects.toMatchObject({ code: 'P0001' });

    const checkpoint = await testPool.query<{ stage: string; receive_tx_hash: string }>(`
      SELECT stage, receive_tx_hash FROM bridge_recovery_checkpoints
      WHERE plan_id = 'claims-concurrency-plan'
    `);
    expect(checkpoint.rows[0]).toMatchObject({
      stage: 'DESTINATION_BROADCAST',
      receive_tx_hash: hash,
    });
  });
});

describe('migration-from-zero: self-relay cross-device hash reconciliation', () => {
  pgTest('accepts exact RPC-verified hash after browser checkpoint mirroring, never another hash', async () => {
    await testPool.query(`
      INSERT INTO veyra_users (veyr_user_id, veyr_handle, identity_revision, status)
      VALUES ('usr_self_relay', 'selfrelay', 1, 'ACTIVE')
      ON CONFLICT DO NOTHING
    `);
    await testPool.query(`
      INSERT INTO bridge_recovery_checkpoints
        (plan_id, owner_user_id, stage, burn_tx_hash, source_chain_id,
         destination_chain_id, wallet_address, recipient_address,
         amount_raw, token_address, balance_before_raw,
         attestation_message, attestation_signature)
      VALUES
        ('claims-self-relay-plan', 'usr_self_relay', 'ATTESTATION_READY',
         '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
         5042002, 11155111, '0x1111111111111111111111111111111111111111',
         '0x2222222222222222222222222222222222222222', 1000000,
         '0x3333333333333333333333333333333333333333', 0,
         '0x1234', '0xabcd')
    `);

    const db = drizzle(testPool, { schema });
    expect(await claimDestinationSubmission(
      db, 'usr_self_relay', 'claims-self-relay-plan',
    )).toEqual({ mode: 'CLAIMED' });
    const original = `0x${'f'.repeat(64)}`;

    // The client's best-effort checkpoint mirror may beat RPC indexing.
    await testPool.query(`
      UPDATE bridge_recovery_checkpoints
      SET stage = 'DESTINATION_BROADCAST', receive_tx_hash = $1
      WHERE plan_id = 'claims-self-relay-plan'
    `, [original]);

    await recordDestinationSubmission(
      db, 'usr_self_relay', 'claims-self-relay-plan', original,
    );
    expect(await getDestinationSubmissionClaim(
      db, 'usr_self_relay', 'claims-self-relay-plan',
    )).toEqual({ mode: 'ALREADY_SUBMITTED', txHash: original });

    await expect(recordDestinationSubmission(
      db, 'usr_self_relay', 'claims-self-relay-plan', `0x${'1'.repeat(64)}`,
    )).rejects.toThrow(/already recorded/i);
    const events = await testPool.query<{ event_type: string }>(
      `SELECT event_type FROM bridge_destination_attempt_events
       WHERE plan_id = 'claims-self-relay-plan'`,
    );
    expect(events.rows).toHaveLength(2);
  });
});

describe('migration-from-zero: append-only first destination revert proof', () => {
  pgTest('writes immutable evidence once and rejects changed blocks or deletions', async () => {
    const hash = `0x${'c'.repeat(64)}`;
    const block = `0x${'d'.repeat(64)}`;
    const proof = {
      receiveTxHash: hash,
      destinationChainId: 11155111,
      destinationBlockNumber: 100,
      destinationBlockHash: block,
      confirmations: 12,
    };
    const db = drizzle(testPool, { schema });

    const first = await recordVerifiedFirstDestinationRevert(
      db, 'usr_relay_claims', 'claims-concurrency-plan', proof,
    );
    expect(first).toMatchObject(proof);
    expect(await recordVerifiedFirstDestinationRevert(
      db, 'usr_relay_claims', 'claims-concurrency-plan', proof,
    )).toMatchObject(proof);

    await expect(recordVerifiedFirstDestinationRevert(
      db,
      'usr_relay_claims',
      'claims-concurrency-plan',
      { ...proof, destinationBlockHash: `0x${'e'.repeat(64)}` },
    )).rejects.toThrow(/conflicts with newly verified evidence/i);

    await expect(testPool.query(`
      UPDATE bridge_destination_attempt_resolutions SET confirmations = 13
      WHERE plan_id = 'claims-concurrency-plan'
    `)).rejects.toMatchObject({ code: 'P0001' });
    await expect(testPool.query(`
      DELETE FROM bridge_destination_attempt_resolutions
      WHERE plan_id = 'claims-concurrency-plan'
    `)).rejects.toMatchObject({ code: 'P0001' });

    const events = await testPool.query<{ receive_tx_hash: string }>(`
      SELECT receive_tx_hash FROM bridge_destination_attempt_resolutions
      WHERE plan_id = 'claims-concurrency-plan' AND attempt_number = 1
    `);
    expect(events.rows).toHaveLength(1);
    expect(events.rows[0]?.receive_tx_hash).toBe(hash);
  });
});

describe('migration-from-zero: second destination attempt safety', () => {
  pgTest('cannot reserve before verified reverted first receive and never overwrites the original hash', async () => {
    await testPool.query(`
      INSERT INTO veyra_users (veyr_user_id, veyr_handle, identity_revision, status)
      VALUES ('usr_retry_two', 'retrytwo', 1, 'ACTIVE')
      ON CONFLICT DO NOTHING
    `);
    const planId = 'retry-two-plan';
    const firstHash = `0x${'7'.repeat(64)}`;
    const secondHash = `0x${'8'.repeat(64)}`;
    const blockHash = `0x${'9'.repeat(64)}`;
    await testPool.query(`
      INSERT INTO bridge_recovery_checkpoints
        (plan_id, owner_user_id, stage, burn_tx_hash, source_chain_id,
         destination_chain_id, wallet_address, recipient_address,
         amount_raw, token_address, balance_before_raw,
         attestation_message, attestation_signature)
      VALUES
        ($1, 'usr_retry_two', 'ATTESTATION_READY',
         '0x7777777777777777777777777777777777777777777777777777777777777777',
         5042002, 11155111, '0x1111111111111111111111111111111111111111',
         '0x2222222222222222222222222222222222222222', 1000000,
         '0x3333333333333333333333333333333333333333', 0,
         '0x1234', '0xabcd')
    `, [planId]);
    const db = drizzle(testPool, { schema });

    await expect(claimSecondDestinationAttempt(
      db, 'usr_retry_two', planId,
    )).rejects.toThrow(/verified reverted FIRST/i);

    expect(await claimDestinationSubmission(db, 'usr_retry_two', planId))
      .toEqual({ mode: 'CLAIMED' });
    await recordDestinationSubmission(db, 'usr_retry_two', planId, firstHash);

    await expect(claimSecondDestinationAttempt(
      db, 'usr_retry_two', planId,
    )).rejects.toThrow(/verified reverted FIRST/i);

    await recordVerifiedFirstDestinationRevert(db, 'usr_retry_two', planId, {
      receiveTxHash: firstHash,
      destinationChainId: 11155111,
      destinationBlockNumber: 100,
      destinationBlockHash: blockHash,
      confirmations: 12,
    });

    const competing = await Promise.all([
      claimSecondDestinationAttempt(db, 'usr_retry_two', planId),
      claimSecondDestinationAttempt(db, 'usr_retry_two', planId),
    ]);
    expect(competing.map((r) => r.mode).sort())
      .toEqual(['CLAIMED', 'UNCERTAIN']);
    expect(await getSecondDestinationAttempt(db, 'usr_retry_two', planId))
      .toEqual({ mode: 'UNCERTAIN' });

    // Claim persists through a crash and cannot be reacquired.
    expect(await claimSecondDestinationAttempt(db, 'usr_retry_two', planId))
      .toEqual({ mode: 'UNCERTAIN' });
    await expect(claimSecondDestinationAttempt(
      db, 'usr_retry_intruder', planId,
    )).rejects.toThrow(/Owned destination retry plan not found/i);

    await expect(recordSecondDestinationAttemptHash(
      db, 'usr_retry_two', planId, firstHash,
    )).rejects.toThrow(/preserve the original first destination tx/i);
    await recordSecondDestinationAttemptHash(
      db, 'usr_retry_two', planId, secondHash,
    );
    await recordSecondDestinationAttemptHash(
      db, 'usr_retry_two', planId, secondHash,
    );
    await expect(recordSecondDestinationAttemptHash(
      db, 'usr_retry_two', planId, `0x${'a'.repeat(64)}`,
    )).rejects.toThrow(/immutable once recorded/i);

    expect(await getSecondDestinationAttempt(db, 'usr_retry_two', planId))
      .toEqual({ mode: 'ALREADY_SUBMITTED', txHash: secondHash });
    expect(await claimSecondDestinationAttempt(db, 'usr_retry_two', planId))
      .toEqual({ mode: 'ALREADY_SUBMITTED', txHash: secondHash });

    const original = await testPool.query<{
      receive_tx_hash: string;
      stage: string;
    }>(`
      SELECT receive_tx_hash, stage FROM bridge_recovery_checkpoints
      WHERE plan_id = 'retry-two-plan'
    `);
    expect(original.rows[0]).toMatchObject({
      receive_tx_hash: firstHash,
      stage: 'DESTINATION_BROADCAST',
    });
    const legacy = await testPool.query<{ receive_tx_hash: string }>(`
      SELECT receive_tx_hash FROM bridge_destination_submission_claims
      WHERE plan_id = 'retry-two-plan'
    `);
    expect(legacy.rows[0]?.receive_tx_hash).toBe(firstHash);

    const events = await testPool.query<{ event_type: string }>(`
      SELECT event_type FROM bridge_destination_retry_events
      WHERE plan_id = 'retry-two-plan'
    `);
    expect(events.rows.map((r) => r.event_type).sort())
      .toEqual(['BROADCAST_RECORDED', 'SUBMISSION_STARTED']);

    const history = await getOwnedDestinationAttemptHistory(
      db, 'usr_retry_two', planId,
    );
    expect(history).toMatchObject({
      planId,
      first: {
        receiveTxHash: firstHash,
        state: 'RECORDED',
        reverted: true,
        revertBlockHash: blockHash,
      },
      second: { receiveTxHash: secondHash, state: 'RECORDED' },
    });
    expect(history?.history).toHaveLength(4);
    expect(await getOwnedDestinationAttemptHistory(
      db, 'usr_self_relay', planId,
    )).toBeNull();

    await expect(testPool.query(`
      UPDATE bridge_destination_retry_attempts SET receive_tx_hash = $1
      WHERE plan_id = 'retry-two-plan'
    `, [`0x${'a'.repeat(64)}`])).rejects.toMatchObject({ code: 'P0001' });
    await expect(testPool.query(`
      DELETE FROM bridge_destination_retry_attempts
      WHERE plan_id = 'retry-two-plan'
    `)).rejects.toMatchObject({ code: 'P0001' });
    await expect(testPool.query(`
      UPDATE bridge_destination_retry_events SET event_type = 'BROADCAST_RECORDED'
      WHERE plan_id = 'retry-two-plan'
    `)).rejects.toMatchObject({ code: 'P0001' });
    await expect(testPool.query(`
      DELETE FROM bridge_destination_retry_events
      WHERE plan_id = 'retry-two-plan'
    `)).rejects.toMatchObject({ code: 'P0001' });
  });
});

describe('migration-from-zero: second receive verified mint invariants', () => {
  pgTest('inserts unique finality proof, rejects changed mint evidence, and preserves immutable first tx', async () => {
    const db = drizzle(testPool, { schema });
    const planId = 'retry-two-plan';
    const proof = {
      receiveTxHash: `0x${'8'.repeat(64)}`,
      destinationChainId: 11155111,
      destinationBlockNumber: 200,
      destinationBlockHash: `0x${'a'.repeat(64)}`,
      mintToken: '0x3333333333333333333333333333333333333333',
      mintRecipient: '0x2222222222222222222222222222222222222222',
      mintAmountRaw: '1000000',
      confirmations: 12,
    };

    const verified = await recordVerifiedSecondDestinationMint(
      db, 'usr_retry_two', planId, proof, proof.mintToken,
    );
    expect(verified).toEqual(proof);

    expect(await recordVerifiedSecondDestinationMint(
      db, 'usr_retry_two', planId, proof, proof.mintToken,
    )).toMatchObject(proof);

    for (const invalid of [
      { ...proof, receiveTxHash: `0x${'7'.repeat(64)}` },
      { ...proof, mintAmountRaw: '999999' },
      { ...proof, mintRecipient: '0x1111111111111111111111111111111111111111' },
      { ...proof, confirmations: 11 },
    ]) {
      await expect(recordVerifiedSecondDestinationMint(
        db, 'usr_retry_two', planId, invalid, proof.mintToken,
      )).rejects.toThrow(/Second mint proof must match/i);
    }

    await expect(recordVerifiedSecondDestinationMint(
      db, 'usr_self_relay', planId, proof, proof.mintToken,
    )).rejects.toThrow(/Owned second-mint checkpoint/i);

    const firstCheckpoint = await testPool.query<{ receive_tx_hash: string }>(`
      SELECT receive_tx_hash FROM bridge_recovery_checkpoints
      WHERE plan_id = 'retry-two-plan'
    `);
    expect(firstCheckpoint.rows[0]?.receive_tx_hash).toBe(`0x${'7'.repeat(64)}`);

    const minted = await testPool.query<{
      mint_amount_raw: string;
      receive_tx_hash: string;
    }>(`
      SELECT receive_tx_hash, mint_amount_raw
      FROM bridge_destination_retry_verifications
      WHERE plan_id = 'retry-two-plan' AND attempt_number = 2
    `);
    expect(minted.rows).toHaveLength(1);
    expect(minted.rows[0]).toEqual({
      receive_tx_hash: proof.receiveTxHash,
      mint_amount_raw: proof.mintAmountRaw,
    });

    const history = await getOwnedDestinationAttemptHistory(
      db, 'usr_retry_two', planId,
    );
    expect(history?.second).toMatchObject({
      receiveTxHash: proof.receiveTxHash,
      state: 'RECORDED',
      verifiedMint: true,
      mintBlockHash: proof.destinationBlockHash,
      confirmations: 12,
    });
    expect(await getOwnedDestinationAttemptHistory(
      db, 'usr_self_relay', planId,
    )).toBeNull();

    await expect(testPool.query(`
      UPDATE bridge_destination_retry_verifications
      SET confirmations = 13 WHERE plan_id = 'retry-two-plan'
    `)).rejects.toMatchObject({ code: 'P0001' });
    await expect(testPool.query(`
      DELETE FROM bridge_destination_retry_verifications
      WHERE plan_id = 'retry-two-plan'
    `)).rejects.toMatchObject({ code: 'P0001' });
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
