/**
 * Public, fixed HTTPS Render Testnet origin. No runtime-configurable URLs,
 * credentials, cookies, localStorage or sessionStorage.
 */
import { BFF_ORIGIN, type Friend, type IdentityProfile, type SignedChallenge } from './protocol';

interface ErrorPayload {
  ok?: boolean;
  error?: string;
  message?: string;
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
  const response = await fetch(BFF_ORIGIN + path, {
    method,
    headers,
    credentials: 'omit',
    cache: 'no-store',
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const result = await response.json() as ErrorPayload;
  if (!response.ok || result.ok === false) {
    if (response.status === 401) throw new Error('Session expired or unauthorized. Sign in again.');
    if (response.status === 404 && path.endsWith('/wallet-login/challenge')) {
      throw new Error('This wallet has no Veyra ID. Register first.');
    }
    throw new Error(typeof result.message === 'string' ? result.message :
      typeof result.error === 'string' ? result.error :
      `Backend request failed (HTTP ${response.status}).`);
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
