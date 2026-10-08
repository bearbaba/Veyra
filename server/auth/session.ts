import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

const SESSION_VERSION = 1;
const DEFAULT_SESSION_TTL_SECONDS = 24 * 60 * 60;
const USER_ID_RE = /^usr_[1-9A-HJ-NP-Za-km-z]{10,}$/;

export interface VeyraSessionPayload {
  v: 1;
  sub: string;
  iat: number;
  exp: number;
  jti: string;
}

export class SessionError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'SessionError';
  }
}

function b64urlEncode(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function b64urlDecode(input: string): Buffer {
  return Buffer.from(input, 'base64url');
}

function signBody(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('base64url');
}

function assertSecret(secret: string): void {
  if (secret.length < 32) {
    throw new SessionError('SESSION_SECRET_TOO_SHORT', 'VEYRA_SESSION_SECRET must be at least 32 characters');
  }
}

export function issueSessionToken(
  veyraUserId: string,
  secret: string,
  options: { nowSeconds?: number; ttlSeconds?: number } = {},
): string {
  if (!USER_ID_RE.test(veyraUserId)) {
    throw new SessionError('INVALID_USER_ID', 'Invalid Veyra user id');
  }
  assertSecret(secret);

  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  const ttl = options.ttlSeconds ?? DEFAULT_SESSION_TTL_SECONDS;
  if (!Number.isInteger(ttl) || ttl < 60 || ttl > 7 * 24 * 60 * 60) {
    throw new SessionError('INVALID_SESSION_TTL', 'Session TTL must be between 60 seconds and 7 days');
  }

  const payload: VeyraSessionPayload = {
    v: SESSION_VERSION,
    sub: veyraUserId,
    iat: now,
    exp: now + ttl,
    jti: randomBytes(16).toString('hex'),
  };

  const body = b64urlEncode(JSON.stringify(payload));
  return `${body}.${signBody(body, secret)}`;
}

export function verifySessionToken(
  token: string,
  secret: string,
  options: { nowSeconds?: number } = {},
): VeyraSessionPayload {
  assertSecret(secret);
  const [body, signature, extra] = token.split('.');
  if (!body || !signature || extra !== undefined) {
    throw new SessionError('INVALID_SESSION', 'Malformed session token');
  }

  const expected = signBody(body, secret);
  const expectedBytes = Buffer.from(expected);
  const actualBytes = Buffer.from(signature);
  if (expectedBytes.length !== actualBytes.length || !timingSafeEqual(expectedBytes, actualBytes)) {
    throw new SessionError('INVALID_SESSION', 'Invalid session signature');
  }

  let payload: unknown;
  try {
    payload = JSON.parse(b64urlDecode(body).toString('utf8')) as unknown;
  } catch {
    throw new SessionError('INVALID_SESSION', 'Invalid session payload');
  }

  if (!payload || typeof payload !== 'object') {
    throw new SessionError('INVALID_SESSION', 'Invalid session payload');
  }
  const p = payload as Partial<VeyraSessionPayload>;
  if (
    p.v !== SESSION_VERSION ||
    typeof p.sub !== 'string' || !USER_ID_RE.test(p.sub) ||
    typeof p.iat !== 'number' || !Number.isInteger(p.iat) ||
    typeof p.exp !== 'number' || !Number.isInteger(p.exp) ||
    typeof p.jti !== 'string' || !/^[0-9a-f]{32}$/.test(p.jti)
  ) {
    throw new SessionError('INVALID_SESSION', 'Invalid session claims');
  }

  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (p.iat > now + 60) {
    throw new SessionError('INVALID_SESSION', 'Session issued in the future');
  }
  if (p.exp <= now) {
    throw new SessionError('SESSION_EXPIRED', 'Session expired');
  }
  if (p.exp - p.iat > 7 * 24 * 60 * 60) {
    throw new SessionError('INVALID_SESSION', 'Session lifetime exceeds maximum');
  }

  return p as VeyraSessionPayload;
}

export interface AuthRequestLike {
  header(name: string): string | undefined;
}

/**
 * Resolves the authenticated Veyra user.
 *
 * Production: requires Authorization: Bearer <signed Veyra session>.
 * Development: same bearer token is preferred; X-Veyra-User-Id remains a local-only fallback.
 */
export function getAuthenticatedVeyraUserId(req: AuthRequestLike): string | null {
  const authorization = req.header('authorization');
  if (authorization?.startsWith('Bearer ')) {
    const secret = process.env.VEYRA_SESSION_SECRET;
    if (!secret) return null;
    try {
      return verifySessionToken(authorization.slice(7).trim(), secret).sub;
    } catch {
      return null;
    }
  }

  if (process.env.NODE_ENV === 'production') return null;
  const raw = req.header('x-veyra-user-id');
  if (!raw || !USER_ID_RE.test(raw)) return null;
  return raw;
}
