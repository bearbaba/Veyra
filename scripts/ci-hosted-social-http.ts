/**
 * CI-only authenticated HTTP + real PostgreSQL acceptance.
 *
 * This is NOT a wallet signature test. Tokens identify disposable seeded
 * Testnet fixtures and are generated with a TEST-ONLY session secret.
 * Refuses non-CI or non-loopback databases, and never changes a deployed DB.
 *
 *   bun scripts/ci-hosted-social-http.ts bootstrap
 *   bun scripts/ci-hosted-social-http.ts verify
 */
import assert from 'node:assert/strict';
import { Client, Pool } from 'pg';
import { issueSessionToken } from '../server/auth/session.js';
import { runDatabaseMigrations } from '../server/db/migrationService.js';

const TEST_DATABASE = 'veyra_hosted_http_ci';
const USER_A = 'usr_123456789ABCDEFGJ';
const USER_B = 'usr_23456789ABCDEFGJK';
const USER_C = 'usr_3456789ABCDEFGJKL';
const ORIGIN = 'https://veyra.example';
const BASE_URL = 'http://127.0.0.1:3001';

function assertEphemeralCiOnly() {
  assert.equal(process.env.CI, 'true', 'Refusing acceptance outside isolated CI');
  const admin = process.env.DATABASE_ADMIN_URL;
  assert.ok(admin, 'DATABASE_ADMIN_URL is required');
  const url = new URL(admin);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname),
    'Only disposable loopback PostgreSQL is permitted');
  assert.equal(url.pathname, '/postgres', 'CI admin URL must target postgres maintenance database');
  assert.ok(process.env.VEYRA_SESSION_SECRET && process.env.VEYRA_SESSION_SECRET.length >= 32,
    'A dedicated CI-only session secret is required');
  return url;
}

function databaseUrl(admin: URL) {
  const dbUrl = new URL(admin);
  dbUrl.pathname = '/' + TEST_DATABASE;
  return dbUrl.toString();
}

async function bootstrap(admin: URL) {
  const client = new Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    // Fresh PostgreSQL service belongs to this one CI job. Never DROP any DB.
    await client.query('CREATE DATABASE ' + TEST_DATABASE);
  } finally {
    await client.end();
  }
  const url = databaseUrl(admin);
  await runDatabaseMigrations(url, { log: () => undefined });
  const pool = new Pool({ connectionString: url, max: 2 });
  try {
    await pool.query(
      `INSERT INTO veyra_users (veyr_user_id, veyr_handle, identity_revision, status)
       VALUES ($1, 'acceptalice', 1, 'ACTIVE'),
              ($2, 'acceptbob', 1, 'ACTIVE'),
              ($3, 'acceptother', 1, 'ACTIVE')`,
      [USER_A, USER_B, USER_C],
    );
    const tables = await pool.query<{ name: string }>(
      "SELECT to_regclass('public.social_connections')::text AS name",
    );
    assert.equal(tables.rows[0]?.name, 'social_connections');
  } finally {
    await pool.end();
  }
  console.log('CI disposable PostgreSQL: migrations + seeded identity fixtures PASS');
}

async function http(
  path: string,
  token?: string,
  body?: Record<string, unknown>,
  options: { origin?: string; mockHeader?: string } = {},
) {
  const headers: Record<string, string> = {
    Origin: options.origin ?? ORIGIN,
  };
  if (token) headers.Authorization = 'Bearer ' + token;
  if (options.mockHeader) headers['X-Veyra-User-Id'] = options.mockHeader;
  if (body) headers['Content-Type'] = 'application/json';
  const response = await fetch(BASE_URL + path, {
    method: body ? 'POST' : 'GET',
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(8_000),
  });
  const data = await response.json() as Record<string, unknown>;
  return { status: response.status, data, headers: response.headers };
}

async function verify() {
  const secret = process.env.VEYRA_SESSION_SECRET!;
  const alice = issueSessionToken(USER_A, secret, { ttlSeconds: 600 });
  const bob = issueSessionToken(USER_B, secret, { ttlSeconds: 600 });
  const stranger = issueSessionToken(USER_C, secret, { ttlSeconds: 600 });

  const anonymous = await http('/api/social/friends');
  assert.equal(anonymous.status, 401);
  const spoofed = await http('/api/social/friends', undefined, undefined, { mockHeader: USER_A });
  assert.equal(spoofed.status, 401, 'Hosted BFF must never trust development identity headers');
  const hostile = await http('/api/social/friends', alice, undefined, { origin: 'https://evil.example' });
  assert.equal(hostile.status, 403, 'Hostile Origin must be rejected before route execution');

  const initial = await http('/api/social/friends', alice);
  assert.equal(initial.status, 200, JSON.stringify(initial.data));
  assert.deepEqual(initial.data.items, []);
  assert.equal(initial.headers.get('cache-control'), 'no-store');
  assert.equal(initial.headers.get('access-control-allow-origin'), ORIGIN);

  const invite = await http('/api/social/friend/request', alice, { veyraUserId: USER_B });
  assert.equal(invite.status, 200, JSON.stringify(invite.data));
  const outgoing = await http('/api/social/friends', alice);
  assert.equal(outgoing.status, 200);
  assert.deepEqual((outgoing.data.items as Array<{veyraUserId:string;state:string}>)
    .map(item => [item.veyraUserId, item.state]), [[USER_B, 'OUTGOING_PENDING']]);
  const incoming = await http('/api/social/friends', bob);
  assert.equal(incoming.status, 200);
  assert.deepEqual((incoming.data.items as Array<{veyraUserId:string;state:string}>)
    .map(item => [item.veyraUserId, item.state]), [[USER_A, 'INCOMING_PENDING']]);
  assert.deepEqual((await http('/api/social/friends', stranger)).data.items, []);

  const accept = await http('/api/social/friend/respond', bob, { veyraUserId: USER_A, decision: 'ACCEPT' });
  assert.equal(accept.status, 200, JSON.stringify(accept.data));
  const connected = await http('/api/social/friends', alice);
  assert.equal((connected.data.items as Array<{state:string}>)[0]?.state, 'CONNECTED');

  const block = await http('/api/social/block', bob, { veyraUserId: USER_A });
  assert.equal(block.status, 200, JSON.stringify(block.data));
  assert.deepEqual((await http('/api/social/friends', alice)).data.items, []);
  assert.deepEqual((await http('/api/social/friends', bob)).data.items, []);

  const unblock = await http('/api/social/unblock', bob, { veyraUserId: USER_A });
  assert.equal(unblock.status, 200, JSON.stringify(unblock.data));
  assert.deepEqual((await http('/api/social/friends', alice)).data.items, [],
    'Unblock must not restore an old friendship');

  const renewed = await http('/api/social/friend/request', bob, { veyraUserId: USER_A });
  assert.equal(renewed.status, 200, JSON.stringify(renewed.data));
  const freshRequest = await http('/api/social/friends', alice);
  assert.equal((freshRequest.data.items as Array<{state:string}>)[0]?.state, 'INCOMING_PENDING');

  // Neither user nor their connection list can be swapped using an unsigned
  // identity header. Session-protected results expose only pair state and ID.
  const result = JSON.stringify(freshRequest.data);
  assert.ok(!result.includes('walletAddress') && !result.includes('balance'));
  console.log('Hosted BFF authenticated HTTP + real PostgreSQL Friends lifecycle: PASS');
}

const operation = process.argv[2];
const admin = assertEphemeralCiOnly();
if (operation === 'bootstrap') await bootstrap(admin);
else if (operation === 'verify') await verify();
else throw new Error('Expected bootstrap or verify');
