/**
 * Phase 8I: intentionally unauthenticated, read-only hosted HTTP acceptance.
 * No real wallet accounts, tokens, RPC signing, or financial endpoints.
 * Runs from GitHub Actions over public HTTPS to test the Vercel<->Render
 * boundary that Docker/CI loopback tests cannot prove.
 */
import assert from 'node:assert/strict';

const BETA_ORIGIN = 'https://veyra-identity-friends-beta.vercel.app';
const BFF_ORIGIN = 'https://veyra-testnet-acceptance-bff.onrender.com';
const TITLE = 'Veyra — Identity & Friends Beta';

async function probe(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    redirect: 'follow',
    signal: AbortSignal.timeout(100_000), // Render Free cold start can exceed 50s.
  });
  return response;
}

function checkNoRedirectToUnexpectedOrigin(res, expected) {
  assert.equal(new URL(res.url).origin, expected, 'Unexpected redirect or hosting protection flow');
}

console.log('[live-beta] Checking stable Vercel hostname (no credentials).');
const page = await probe(BETA_ORIGIN + '/');
checkNoRedirectToUnexpectedOrigin(page, BETA_ORIGIN);
assert.equal(page.status, 200, 'Identity Beta landing page must be available via stable HTTPS domain');
const html = await page.text();
assert.ok(html.includes(TITLE), 'Stable hostname is not serving isolated Identity Beta HTML');
// Do not print response body: it may include an authentication portal if protected.
console.log('[live-beta] Stable HTTPS origin serves the isolated identity-only app.');

console.log('[live-beta] Checking database infrastructure after Render Free warmup.');
const db = await probe(BFF_ORIGIN + '/api/health/database', {
  headers: { Origin: BETA_ORIGIN },
});
checkNoRedirectToUnexpectedOrigin(db, BFF_ORIGIN);
assert.equal(db.status, 200, 'Live test database health should return HTTP 200');
const body = await db.json();
assert.equal(body.ok, true);
assert.equal(body.scope, 'database-infrastructure-only');
assert.ok(Array.isArray(body.checks) && body.checks.length >= 4);
assert.ok(body.checks.every(check => check.ok === true));
console.log('[live-beta] PostgreSQL schema and migrations: healthy.');

console.log('[live-beta] Checking hosted CORS and owner-private Friends API.');
const preflight = await probe(BFF_ORIGIN + '/api/social/friends', {
  method: 'OPTIONS',
  headers: {
    Origin: BETA_ORIGIN,
    'Access-Control-Request-Method': 'GET',
    'Access-Control-Request-Headers': 'Authorization',
  },
});
assert.equal(preflight.status, 204, 'Browser preflight must be accepted for the stable beta origin');
assert.equal(preflight.headers.get('access-control-allow-origin'), BETA_ORIGIN);
assert.ok((preflight.headers.get('access-control-allow-headers') || '').toLowerCase().includes('authorization'));

const unauthenticated = await probe(BFF_ORIGIN + '/api/social/friends', {
  headers: {Origin: BETA_ORIGIN},
});
assert.equal(unauthenticated.status, 401, 'Friends must never disclose information without a signed session');
assert.equal(unauthenticated.headers.get('access-control-allow-origin'), BETA_ORIGIN);
assert.equal(unauthenticated.headers.get('cache-control'), 'no-store');

const spoofed = await probe(BFF_ORIGIN + '/api/social/friends', {
  headers: {Origin: BETA_ORIGIN, 'X-Veyra-User-Id':'usr_123456789ABCDEFGJ'},
});
assert.equal(spoofed.status, 401, 'Hosted Testnet must not trust unsigned development identity headers');

const hostile = await probe(BFF_ORIGIN + '/api/social/friends', {
  headers: {Origin: 'https://hostile.example'},
});
assert.equal(hostile.status, 403, 'A hostile Origin must be rejected before reaching authenticated routes');
assert.equal(hostile.headers.get('access-control-allow-origin'), null);

console.log('[live-beta] PASS: HTTPS beta, PostgreSQL, exact CORS, anonymous privacy, spoofed identity and hostile Origin.');
console.log('[live-beta] NOT TESTED: browser wallets, transaction signing, financial acceptance or Mainnet.');
