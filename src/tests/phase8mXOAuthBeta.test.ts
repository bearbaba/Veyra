import { describe, expect, it } from 'vitest';
import { BFF_ORIGIN, verifyXAuthorizationUrl } from '../identity-beta/protocol';

function officialXUrl(): string {
  const url = new URL('https://x.com/i/oauth2/authorize');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', 'public-test-client-id');
  url.searchParams.set('redirect_uri', BFF_ORIGIN + '/api/auth/x/callback');
  url.searchParams.set('scope', 'tweet.read users.read');
  url.searchParams.set('state', 'w'.repeat(43));
  url.searchParams.set('code_challenge', 'a'.repeat(43));
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

describe('Phase 8M — X OAuth remains a link on the existing Veyra ID', () => {
  it('accepts only official X authorization with a Testnet BFF callback', () => {
    expect(verifyXAuthorizationUrl(officialXUrl())).toBe(officialXUrl());
  });
  it('blocks phishing redirects, weaker PKCE and callback exfiltration', () => {
    for (const action of [
      (u: URL) => { u.hostname = 'x.com.evil.example'; },
      (u: URL) => { u.hostname = 'twitter.example'; },
      (u: URL) => { u.protocol = 'http:'; },
      (u: URL) => { u.pathname = '/wrong'; },
      (u: URL) => { u.searchParams.set('code_challenge_method', 'plain'); },
      (u: URL) => { u.searchParams.set('response_type', 'token'); },
      (u: URL) => { u.searchParams.set('redirect_uri', 'https://evil.example/steal'); },
      (u: URL) => { u.searchParams.delete('state'); },
      (u: URL) => { u.searchParams.delete('code_challenge'); },
      (u: URL) => { u.username = 'attacker'; },
    ]) {
      const url = new URL(officialXUrl());
      action(url);
      expect(() => verifyXAuthorizationUrl(url.toString())).toThrow();
    }
  });
  it('never trusts malformed external URL inputs', () => {
    for (const value of [null, {}, '', '//evil.example', 'javascript:alert(1)', 'https://x.com@evil.example/i/oauth2/authorize']) {
      expect(() => verifyXAuthorizationUrl(value)).toThrow();
    }
  });
});
