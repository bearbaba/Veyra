// A stand-in for the Veyra identity backend, living entirely inside the test.
// It enforces what the real one enforces for these scenarios (wallet-bound
// session, EIP-712 signature verification, one-time challenges) and counts every
// call so tests can assert behaviour such as "no second wallet prompt".
// It never talks to any real service.
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { verifyTypedData } = require('viem');

export const OFFICIAL_ORIGIN = 'https://veyra-seven-beta.vercel.app';
const LOGIN_PURPOSE = 'Sign in to Veyra. No payments or transfers.';
const ZERO = '0x0000000000000000000000000000000000000000';
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

const json = (route, status, body) => route.fulfill({
  status, contentType: 'application/json', headers: { 'cache-control': 'no-store' }, body: JSON.stringify(body),
});
const userId = () => `usr_${Array.from(randomBytes(12), (b) => B58[b % B58.length]).join('')}`;

export function createFakeBackend({ registered }) {
  const users = new Map();             // lowercased wallet -> profile
  for (const [wallet, handle] of Object.entries(registered)) {
    users.set(wallet.toLowerCase(), { veyraUserId: userId(), veyraHandle: handle, displayName: handle });
  }
  const challenges = new Map();
  const tokens = new Map();            // bearer token -> wallet
  let cookieWallet = null;             // simulated HttpOnly restore cookie
  const calls = new Map();
  const rejectedSignatures = [];
  const count = (key) => calls.set(key, (calls.get(key) ?? 0) + 1);

  async function handle(route, url) {
    const request = route.request();
    const key = `${request.method()} ${url.pathname}`;
    count(key);
    let body = {};
    try { body = request.postDataJSON() ?? {}; } catch { /* not JSON */ }

    switch (key) {
      case 'POST /api/identity/mainnet-capability':
        return json(route, 200, { ok: true, environment: 'mainnet', origin: OFFICIAL_ORIGIN, chainId: 5042,
          walletLogin: true, recipientSnapshots: true, cookieRestore: true });

      case 'POST /api/auth/session/restore': {
        const wallet = String(body.walletAddress ?? '').toLowerCase();
        const user = users.get(wallet);
        if (!user || cookieWallet !== wallet) return json(route, 401, { ok: false, error: 'NO_SESSION' });
        const sessionToken = `tok_${randomBytes(16).toString('hex')}`;
        tokens.set(sessionToken, wallet);
        return json(route, 200, { ok: true, veyraUserId: user.veyraUserId, sessionToken, profile: user });
      }

      case 'POST /api/auth/wallet-login/challenge': {
        const wallet = String(body.walletAddress ?? '').toLowerCase();
        const user = users.get(wallet);
        if (!user) return json(route, 404, { ok: false, error: 'IDENTITY_NOT_FOUND' });
        const challengeId = `lgn_${randomBytes(16).toString('hex')}`;
        const now = Date.now();
        const typedData = {
          domain: { name: 'Veyra Login', version: '1', chainId: 5042, verifyingContract: ZERO },
          primaryType: 'WalletLogin',
          types: { WalletLogin: [
            { name: 'veyraUserId', type: 'string' }, { name: 'walletAddress', type: 'address' },
            { name: 'chainId', type: 'uint256' }, { name: 'nonce', type: 'bytes32' },
            { name: 'issuedAt', type: 'uint256' }, { name: 'expiresAt', type: 'uint256' },
            { name: 'appOrigin', type: 'string' }, { name: 'purpose', type: 'string' },
          ] },
          message: { veyraUserId: user.veyraUserId, walletAddress: body.walletAddress, chainId: 5042,
            nonce: `0x${randomBytes(32).toString('hex')}`, issuedAt: now, expiresAt: now + 4 * 60_000,
            appOrigin: OFFICIAL_ORIGIN, purpose: LOGIN_PURPOSE },
        };
        challenges.set(challengeId, { wallet, typedData, used: false });
        return json(route, 201, { ok: true, challenge: { challengeId, typedData } });
      }

      case 'POST /api/auth/wallet-login/complete': {
        const challenge = challenges.get(String(body.challengeId ?? ''));
        if (!challenge || challenge.used) return json(route, 400, { ok: false, error: 'CHALLENGE_INVALID' });
        challenge.used = true;                                   // one-time use
        const { domain, types, primaryType, message } = challenge.typedData;
        const valid = await verifyTypedData({ address: challenge.wallet, domain, types, primaryType,
          message: { ...message, chainId: BigInt(message.chainId), issuedAt: BigInt(message.issuedAt),
            expiresAt: BigInt(message.expiresAt) }, signature: body.signature }).catch(() => false);
        if (!valid) { rejectedSignatures.push(challenge.wallet); return json(route, 401, { ok: false, error: 'BAD_SIGNATURE' }); }
        const user = users.get(challenge.wallet);
        const sessionToken = `tok_${randomBytes(16).toString('hex')}`;
        tokens.set(sessionToken, challenge.wallet);
        cookieWallet = challenge.wallet;
        return json(route, 200, { ok: true, veyraUserId: user.veyraUserId, walletAddress: challenge.wallet,
          chainId: 5042, sessionToken });
      }

      case 'GET /api/profile/me': {
        const token = (request.headers().authorization ?? '').replace(/^Bearer\s+/i, '');
        const wallet = tokens.get(token);
        if (!wallet) return json(route, 401, { ok: false, error: 'UNAUTHENTICATED' });
        return json(route, 200, { ok: true, profile: users.get(wallet) });
      }

      // Cross-device Pay journal. No journey yet is `journey: null`; the client then allows
      // signing. Requires a valid session like the real route (401 otherwise).
      case 'GET /api/mainnet/pay/journeys': {
        const token = (request.headers().authorization ?? '').replace(/^Bearer\s+/i, '');
        if (!tokens.get(token)) return json(route, 401, { ok: false, error: 'AUTH_REQUIRED' });
        return json(route, 200, { ok: true, journey: null });
      }

      case 'POST /api/auth/session/logout':
        cookieWallet = null;
        return json(route, 200, { ok: true });

      default:
        count(`UNHANDLED ${key}`);
        return json(route, 200, { ok: true, friends: [], notices: [], notifications: [], items: [], nextOffset: null });
    }
  }

  return {
    handle, users, calls, rejectedSignatures,
    callCount: (key) => calls.get(key) ?? 0,
    get restoreCookieWallet() { return cookieWallet; },
    unhandled: () => [...calls.keys()].filter((k) => k.startsWith('UNHANDLED ')).map((k) => k.slice(10)),
  };
}
