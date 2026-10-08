import { createHash, randomBytes } from 'crypto';
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { DbClient } from '../db/client.js';
import { newOAuthStateId } from '../db/ids.js';
import { oauthLinkStates } from '../db/schema/index.js';
import { linkXIdentityFromOAuth, type XIdentityImport } from './profileService.js';

const X_AUTHORIZE_URL = 'https://x.com/i/oauth2/authorize';
const X_TOKEN_URL = 'https://api.x.com/2/oauth2/token';
const X_ME_URL = 'https://api.x.com/2/users/me';
const STATE_TTL_MS = 10 * 60 * 1000;
const RETURN_PATH_RE = /^\/[A-Za-z0-9/_?=&.-]*$/;

export class XOAuthError extends Error {
  constructor(public readonly code: string, message: string, public readonly httpStatus = 400) {
    super(message);
    this.name = 'XOAuthError';
  }
}

function sha256Base64Url(value: string): string {
  return createHash('sha256').update(value).digest('base64url');
}

export function createPkcePair(random: (size: number) => Buffer = randomBytes): { verifier: string; challenge: string } {
  const verifier = random(48).toString('base64url');
  return { verifier, challenge: sha256Base64Url(verifier) };
}

export function hashOAuthState(state: string): string {
  return createHash('sha256').update(state).digest('hex');
}

export function buildXAuthorizeUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  const url = new URL(X_AUTHORIZE_URL);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', input.clientId);
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('scope', 'tweet.read users.read');
  url.searchParams.set('state', input.state);
  url.searchParams.set('code_challenge', input.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

function cleanReturnPath(value: string | undefined): string {
  if (!value) return '/settings';
  if (!RETURN_PATH_RE.test(value) || value.startsWith('//')) return '/settings';
  return value;
}

export async function beginXOAuthLink(
  db: DbClient,
  veyraUserId: string,
  input: { clientId: string; redirectUri: string; returnPath?: string },
): Promise<{ authorizeUrl: string; expiresAt: string }> {
  if (!input.clientId || !input.redirectUri) throw new XOAuthError('X_OAUTH_NOT_CONFIGURED', 'X OAuth is not configured', 503);
  const state = randomBytes(32).toString('base64url');
  const { verifier, challenge } = createPkcePair();
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + STATE_TTL_MS);

  await db.insert(oauthLinkStates).values({
    oauthStateId: newOAuthStateId(),
    stateHash: hashOAuthState(state),
    veyraUserId,
    provider: 'X',
    codeVerifier: verifier,
    redirectUri: input.redirectUri,
    returnPath: cleanReturnPath(input.returnPath),
    issuedAt,
    expiresAt,
  });

  return {
    authorizeUrl: buildXAuthorizeUrl({
      clientId: input.clientId,
      redirectUri: input.redirectUri,
      state,
      codeChallenge: challenge,
    }),
    expiresAt: expiresAt.toISOString(),
  };
}

interface XTokenResponse {
  access_token?: unknown;
  token_type?: unknown;
}

interface XMeResponse {
  data?: {
    id?: unknown;
    username?: unknown;
    name?: unknown;
    profile_image_url?: unknown;
    description?: unknown;
  };
}

export function parseXMeResponse(raw: unknown): XIdentityImport {
  if (!raw || typeof raw !== 'object') throw new XOAuthError('X_PROFILE_INVALID', 'Invalid X profile response', 502);
  const data = (raw as XMeResponse).data;
  if (!data || typeof data !== 'object') throw new XOAuthError('X_PROFILE_INVALID', 'X profile data missing', 502);
  if (typeof data.id !== 'string' || !/^\d{1,30}$/.test(data.id)) {
    throw new XOAuthError('X_PROFILE_INVALID', 'X profile id missing or invalid', 502);
  }
  if (typeof data.username !== 'string' || !/^[A-Za-z0-9_]{1,15}$/.test(data.username)) {
    throw new XOAuthError('X_PROFILE_INVALID', 'X username missing or invalid', 502);
  }
  return {
    xAccountId: data.id,
    xHandle: data.username,
    xDisplayName: typeof data.name === 'string' ? data.name : null,
    xAvatarUrl: typeof data.profile_image_url === 'string' ? data.profile_image_url : null,
    xBio: typeof data.description === 'string' ? data.description : null,
    metadata: null,
  };
}

async function exchangeCode(input: {
  clientId: string;
  clientSecret?: string;
  code: string;
  codeVerifier: string;
  redirectUri: string;
}): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: input.code,
    redirect_uri: input.redirectUri,
    code_verifier: input.codeVerifier,
    client_id: input.clientId,
  });
  const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' };
  if (input.clientSecret) {
    headers.Authorization = `Basic ${Buffer.from(`${input.clientId}:${input.clientSecret}`).toString('base64')}`;
  }
  const response = await fetch(X_TOKEN_URL, { method: 'POST', headers, body });
  if (!response.ok) throw new XOAuthError('X_TOKEN_EXCHANGE_FAILED', `X token exchange failed (${response.status})`, 502);
  const token = await response.json() as XTokenResponse;
  if (typeof token.access_token !== 'string' || !token.access_token) {
    throw new XOAuthError('X_TOKEN_EXCHANGE_FAILED', 'X access token missing', 502);
  }
  return token.access_token;
}

async function fetchXProfile(accessToken: string): Promise<XIdentityImport> {
  const url = new URL(X_ME_URL);
  url.searchParams.set('user.fields', 'id,name,username,profile_image_url,description');
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw new XOAuthError('X_PROFILE_FETCH_FAILED', `X profile fetch failed (${response.status})`, 502);
  return parseXMeResponse(await response.json());
}

export async function completeXOAuthLink(
  db: DbClient,
  input: { state: string; code: string; clientId: string; clientSecret?: string },
): Promise<{ veyraUserId: string; returnPath: string; profile: Awaited<ReturnType<typeof linkXIdentityFromOAuth>> }> {
  if (!input.state || !input.code) throw new XOAuthError('INVALID_OAUTH_CALLBACK', 'Missing OAuth state or code');
  const stateHash = hashOAuthState(input.state);
  const now = new Date();

  const row = await db.transaction(async (tx) => {
    const [candidate] = await tx.select().from(oauthLinkStates).where(and(
      eq(oauthLinkStates.stateHash, stateHash),
      eq(oauthLinkStates.provider, 'X'),
      isNull(oauthLinkStates.consumedAt),
      gt(oauthLinkStates.expiresAt, now),
    )).limit(1);
    if (!candidate) throw new XOAuthError('OAUTH_STATE_INVALID', 'OAuth state is invalid, expired, or already used', 409);

    const consumed = await tx.update(oauthLinkStates)
      .set({ consumedAt: now })
      .where(and(eq(oauthLinkStates.oauthStateId, candidate.oauthStateId), isNull(oauthLinkStates.consumedAt)))
      .returning({ id: oauthLinkStates.oauthStateId });
    if (consumed.length !== 1) throw new XOAuthError('OAUTH_STATE_INVALID', 'OAuth state was already consumed', 409);
    return candidate;
  });

  // Do not hold a database transaction open across remote X API requests.
  // The OAuth state is deliberately consumed before exchange, so failed callbacks
  // cannot be replayed and the user must begin a fresh linking attempt.
  const accessToken = await exchangeCode({
    clientId: input.clientId,
    clientSecret: input.clientSecret,
    code: input.code,
    codeVerifier: row.codeVerifier,
    redirectUri: row.redirectUri,
  });
  const xProfile = await fetchXProfile(accessToken);
  const profile = await linkXIdentityFromOAuth(db, row.veyraUserId, xProfile);
  return { veyraUserId: row.veyraUserId, returnPath: row.returnPath, profile };
}
