/**
 * Public, fixed HTTPS Render Testnet origin. No runtime-configurable URLs,
 * credentials, cookies or persisted browser sessions.
 */
import { BFF_ORIGIN, type Friend, type IdentityProfile, type SignedChallenge } from './protocol';

// Render Free can sleep and take 50+ seconds to wake. Never silently retry
// POST after a timeout: an identity action may already have succeeded.
export const BETA_HTTP_TIMEOUT_MS = 120_000;

interface ErrorPayload {
  ok?: boolean;
  error?: string;
  message?: string;
}
/**
 * Classify only server-approved error codes. Do not treat registration proof
 * rejection as an expired authenticated session: registration has no session yet.
 * No claim tokens, wallet signatures, authorization headers or request bodies
 * are ever embedded in user-visible errors.
 */
export function describeIdentityApiError(
  path: string,
  status: number,
  result: { error?: string; message?: string },
): string {
  const code = typeof result.error === 'string' ? result.error : '';
  const registrationProof = path === '/api/identity/register/complete';
  const loginProof = path === '/api/auth/wallet-login/complete';
  if ((registrationProof || loginProof) && status === 401) {
    if (code === 'INVALID_SIGNATURE' || code === 'INVALID_LOGIN_SIGNATURE') {
      return 'Wallet signature verification failed. Confirm the account in your wallet matches the connected address and request a fresh signature. If multiple wallet extensions are installed, use one active provider.';
    }
    if (code === 'INVALID_CLAIM_TOKEN') {
      return 'The registration challenge could not be verified. Start a fresh registration attempt; do not reuse an older signed claim.';
    }
    return 'Wallet identity verification was rejected (HTTP 401). Check the response error code in DevTools Network; do not share claim tokens or signatures.';
  }
  if (status === 401) {
    if (code === 'INVALID_SIGNATURE' || code === 'INVALID_LOGIN_SIGNATURE') {
      return 'Wallet signature verification failed. Request a fresh wallet challenge.';
    }
    return 'Your signed-in session is missing or expired. Sign in with your verified wallet.';
  }
  if (status === 410 && (code === 'CLAIM_EXPIRED' || code === 'LOGIN_CHALLENGE_EXPIRED_OR_MISMATCHED')) {
    return 'The identity signing challenge expired. Start again to get a fresh challenge.';
  }
  if (status === 409 && code === 'WALLET_ALREADY_BOUND') {
    return 'This wallet already belongs to a Veyra ID. Use Sign in with wallet instead of creating another ID.';
  }
  // Trust only the server-defined error code or a bounded server message; do
  // not interpolate URLs, signature data, tokens, or arbitrary response body.
  if (typeof result.message === 'string') return result.message.slice(0, 200);
  const safeCode = /^(?:[A-Z][A-Z0-9_]{1,55})$/.test(code) ? code : 'REQUEST_FAILED';
  return `Backend request failed (HTTP ${status}; ${safeCode}).`;
}

export interface FriendsPage {
  items: Friend[];
  hasMore: boolean;
  nextOffset: number | null;
}
async function api<T>(
  path: string,
  method: 'GET' | 'POST',
  body?: Record<string, unknown>,
  token?: string,
): Promise<T> {
  if (!path.startsWith('/api/') || path.includes('://') || path.includes('..')) {
    throw new Error('Unrecognized backend endpoint.');
  }
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  let response: Response;
  try {
    response = await fetch(BFF_ORIGIN + path, {
      method,
      headers,
      credentials: 'omit',
      cache: 'no-store',
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(BETA_HTTP_TIMEOUT_MS),
    });
  } catch (cause) {
    if (cause instanceof Error && (cause.name === 'TimeoutError' || cause.name === 'AbortError')) {
      throw new Error('The Testnet service took too long to respond. If you were registering an ID, try signing in before repeating registration.');
    }
    throw cause;
  }
  const result = await response.json() as ErrorPayload;
  if (!response.ok || result.ok === false) {
    if (response.status === 404 && path.endsWith('/wallet-login/challenge')) {
      throw new Error('This wallet has no Veyra ID. Register first.');
    }
    throw new Error(describeIdentityApiError(path, response.status, result));
  }
  return result as T;
}
export async function registerChallenge(handle: string, walletAddress: string) {
  const value = await api<{ ok: true; challenge: SignedChallenge }>(
    '/api/identity/register/challenge', 'POST',
    { handle, walletAddress, chainId: 5042002 },
  );
  return value.challenge;
}
export async function registerComplete(claimToken: string, signature: string) {
  return api<{ok: true; sessionToken: string; profile: IdentityProfile}>(
    '/api/identity/register/complete', 'POST', { claimToken, signature },
  );
}
export async function loginChallenge(walletAddress: string) {
  const value = await api<{ok: true; challenge: SignedChallenge}>(
    '/api/auth/wallet-login/challenge', 'POST', { walletAddress, chainId: 5042002 },
  );
  return value.challenge;
}
export async function loginComplete(challengeId: string, signature: string) {
  return api<{ok: true; sessionToken: string; veyraUserId: string}>(
    '/api/auth/wallet-login/complete', 'POST', { challengeId, signature },
  );
}
/** Begin a signed-session social link. Never creates a new Veyra identity. */
export async function beginXAccountLink(token: string) {
  return api<{ok: true; authorizeUrl: string; expiresAt: string}>(
    '/api/auth/x/start', 'POST', { returnPath: '/' }, token,
  );
}

export async function readProfile(token: string) {
  const value = await api<{ok: true; profile: IdentityProfile}>('/api/profile/me', 'GET', undefined, token);
  return value.profile;
}
export async function readFriends(token: string, offset = 0): Promise<FriendsPage> {
  return api<{ok: true} & FriendsPage>(
    `/api/social/friends?limit=20&offset=${offset}`, 'GET', undefined, token,
  );
}
export async function sendRequest(token: string, veyraUserId: string) {
  await api('/api/social/friend/request', 'POST', { veyraUserId }, token);
}
export async function respondRequest(token: string, veyraUserId: string, decision: 'ACCEPT'|'REJECT') {
  await api('/api/social/friend/respond', 'POST', { veyraUserId, decision }, token);
}
export async function changeBlock(token: string, veyraUserId: string, block: boolean) {
  await api(block ? '/api/social/block' : '/api/social/unblock', 'POST', { veyraUserId }, token);
}
