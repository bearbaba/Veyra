/**
 * Read-only acceptance of the actual deployed Veyra Identity Beta ↔ Render BFF.
 * No secrets, wallet signatures, accounts, financial requests or DB mutation.
 */
import assert from 'node:assert/strict';

const BETA_ORIGIN = 'https://veyra-identity-friends-beta.vercel.app';
const BFF_ORIGIN = 'https://veyra-testnet-acceptance-bff.onrender.com';
const TITLE = 'Veyra — Identity & Friends Beta';

async function probe(url: string, options: RequestInit = {}): Promise<Response> {
  return fetch(url, {
    ...options,
    redirect: 'follow',
    signal: AbortSignal.timeout(100_000),
  });
}

function requireSameOrigin(res: Response, expected: string): void {
  assert.equal(new URL(res.url).origin, expected, 'Unexpected redirect or protected sign-in portal');
}

function requireDatabaseChecks(value: unknown): void {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value));
  const result = value as { ok?: unknown; scope?: unknown; checks?: unknown };
  assert.equal(result.ok, true);
  assert.equal(result.scope, 'database-infrastructure-only');
  assert.ok(Array.isArray(result.checks) && result.checks.length >= 4);
  assert.ok(result.checks.every((check: unknown) =>
    check !== null && typeof check === 'object' && 'ok' in check && check.ok === true));
}

console.log('[live-beta] Checking HTTPS Beta landing page (no credentials).');
const landing = await probe(BETA_ORIGIN + '/');
requireSameOrigin(landing, BETA_ORIGIN);
assert.equal(landing.status, 200, 'Stable Identity Beta homepage must be available');
assert.ok((await landing.text()).includes(TITLE), 'Expected isolated Identity Beta HTML');
console.log('[live-beta] Stable HTTPS origin serves the isolated identity app.');

const database = await probe(BFF_ORIGIN + '/api/health/database', {
  headers: { Origin: BETA_ORIGIN },
});
requireSameOrigin(database, BFF_ORIGIN);
assert.equal(database.status, 200, 'Hosted PostgreSQL readiness must be 200');
requireDatabaseChecks(await database.json() as unknown);
console.log('[live-beta] Hosted PostgreSQL schema/migrations are healthy.');

const preflight = await probe(BFF_ORIGIN + '/api/social/friends', {
  method: 'OPTIONS',
  headers: {
    Origin: BETA_ORIGIN,
    'Access-Control-Request-Method': 'GET',
    'Access-Control-Request-Headers': 'Authorization',
  },
});
assert.equal(preflight.status, 204, 'Browser CORS preflight must succeed');
assert.equal(preflight.headers.get('access-control-allow-origin'), BETA_ORIGIN);
assert.ok((preflight.headers.get('access-control-allow-headers') ?? '')
  .toLowerCase().includes('authorization'));

const anonymous = await probe(BFF_ORIGIN + '/api/social/friends', {
  headers: {Origin: BETA_ORIGIN},
});
assert.equal(anonymous.status, 401, 'Friends requires authenticated owner');
assert.equal(anonymous.headers.get('access-control-allow-origin'), BETA_ORIGIN);
assert.equal(anonymous.headers.get('cache-control'), 'no-store', '401 must not be cached');

const spoofed = await probe(BFF_ORIGIN + '/api/social/friends', {
  headers: {Origin: BETA_ORIGIN, 'X-Veyra-User-Id': 'usr_123456789ABCDEFGJ'},
});
assert.equal(spoofed.status, 401, 'Unsigned fixture identity headers must fail');

const hostile = await probe(BFF_ORIGIN + '/api/social/friends', {
  headers: {Origin: 'https://hostile.example'},
});
assert.equal(hostile.status, 403, 'Hostile Origin must fail before auth');
assert.equal(hostile.headers.get('access-control-allow-origin'), null);
assert.equal(hostile.headers.get('cache-control'), 'no-store', '403 must not be cached');

console.log('[live-beta] PASS: real HTTPS, database health, exact CORS, 401/403 and no-store.');
console.log('[live-beta] Not proof of two real browser wallets or financial readiness.');
