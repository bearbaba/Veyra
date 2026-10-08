import { afterEach, describe, expect, it } from 'vitest';
import {
  getAuthenticatedVeyraUserId,
  issueSessionToken,
  verifySessionToken,
} from '../../server/auth/session.js';

const USER_ID = 'usr_123456789ABCDEFGHJKLMNPQ';
const SECRET = 'veyra-test-session-secret-32-bytes-minimum';

function req(headers: Record<string, string | undefined>) {
  return { header: (name: string) => headers[name.toLowerCase()] };
}

afterEach(() => {
  delete process.env.VEYRA_SESSION_SECRET;
  delete process.env.NODE_ENV;
});

describe('Phase 2B signed sessions', () => {
  it('issues and verifies a chain-independent Veyra session', () => {
    const token = issueSessionToken(USER_ID, SECRET, { nowSeconds: 1_000, ttlSeconds: 600 });
    const payload = verifySessionToken(token, SECRET, { nowSeconds: 1_100 });
    expect(payload.sub).toBe(USER_ID);
    expect(payload.iat).toBe(1_000);
    expect(payload.exp).toBe(1_600);
  });

  it('rejects tampering and expiration', () => {
    const token = issueSessionToken(USER_ID, SECRET, { nowSeconds: 1_000, ttlSeconds: 600 });
    expect(() => verifySessionToken(`${token}x`, SECRET, { nowSeconds: 1_100 })).toThrow();
    expect(() => verifySessionToken(token, SECRET, { nowSeconds: 1_600 })).toThrow('Session expired');
  });

  it('requires bearer auth in production and keeps the dev header non-production only', () => {
    process.env.VEYRA_SESSION_SECRET = SECRET;
    const token = issueSessionToken(USER_ID, SECRET, { ttlSeconds: 600 });

    process.env.NODE_ENV = 'production';
    expect(getAuthenticatedVeyraUserId(req({ authorization: `Bearer ${token}` }))).toBe(USER_ID);
    expect(getAuthenticatedVeyraUserId(req({ 'x-veyra-user-id': USER_ID }))).toBeNull();

    process.env.NODE_ENV = 'development';
    expect(getAuthenticatedVeyraUserId(req({ 'x-veyra-user-id': USER_ID }))).toBe(USER_ID);
  });
});
