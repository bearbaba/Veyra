import { describe, expect, it } from 'vitest';
import { describeIdentityApiError } from '../identity-beta/api';

describe('identity-only API error distinctions', () => {
  it('does not mislabel a registration signature failure as session expiry', () => {
    const message = describeIdentityApiError('/api/identity/register/complete', 401, {
      error: 'INVALID_SIGNATURE',
      message: 'Identity claim was not signed by the connected wallet',
    });
    expect(message).toContain('Wallet signature verification failed');
    expect(message).not.toContain('session');
    expect(message).not.toContain('Sign in again');
  });

  it('suggests a fresh challenge if an HMAC claim token is rejected', () => {
    const message = describeIdentityApiError('/api/identity/register/complete', 401, {
      error: 'INVALID_CLAIM_TOKEN',
    });
    expect(message).toContain('fresh registration');
    expect(message).not.toContain('session');
  });

  it('handles missing details without exposing opaque or untrusted data', () => {
    const message = describeIdentityApiError('/api/identity/register/complete', 401, {
      error: 'UNEXPECTED_TOKEN_abc',
    });
    expect(message).toContain('HTTP 401');
    expect(message).not.toContain('UNEXPECTED_TOKEN');
  });

  it('keeps actual Bearer-session rejection separate', () => {
    expect(describeIdentityApiError('/api/social/friends', 401, {error: 'AUTH_REQUIRED'}))
      .toContain('session');
  });

  it('guides already-bound owners to sign in instead of duplicating identity', () => {
    expect(describeIdentityApiError('/api/identity/register/challenge', 409, {error: 'WALLET_ALREADY_BOUND'}))
      .toContain('Sign in with wallet');
  });

  it('distinguishes expired signing challenges', () => {
    expect(describeIdentityApiError('/api/identity/register/complete', 410, {error: 'CLAIM_EXPIRED'}))
      .toContain('expired');
  });

  it('does not relay potentially sensitive response objects', () => {
    const secret = '0x' + 'a'.repeat(130);
    const message = describeIdentityApiError('/api/identity/register/complete', 401, {
      error: 'INVALID_SIGNATURE', message: secret,
    });
    expect(message).not.toContain(secret);
  });
});
