import { createHash } from 'crypto';
import { describe, expect, it } from 'vitest';
import { buildXAuthorizeUrl, createPkcePair, hashOAuthState, parseXMeResponse,
  buildXLinkedReturnUrl,isConfiguredXOAuth,checkedXReturnOrigin } from '../../server/services/xOAuthService';

describe('Phase 2C X OAuth', () => {
  it('builds an S256 PKCE pair with a bounded verifier', () => {
    const deterministic = () => Buffer.alloc(48, 7);
    const pair = createPkcePair(deterministic);
    expect(pair.verifier.length).toBeGreaterThan(43);
    expect(pair.challenge).toBe(hashToBase64Url(pair.verifier));
  });

  it('builds the X authorize URL with state, users.read and PKCE', () => {
    const url = new URL(buildXAuthorizeUrl({
      clientId: 'client-123',
      redirectUri: 'https://veyra.example/api/auth/x/callback',
      state: 'state-abc',
      codeChallenge: 'challenge-xyz',
    }));
    expect(url.origin).toBe('https://x.com');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('state')).toBe('state-abc');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('scope')).toContain('users.read');
  });

  it('uses immutable numeric X id and mutable username fields from /2/users/me', () => {
    const profile = parseXMeResponse({ data: {
      id: '1234567890', username: 'BearCrypto', name: 'Bear Crypto',
      description: 'hello', profile_image_url: 'https://pbs.twimg.com/avatar.jpg',
    }});
    expect(profile.xAccountId).toBe('1234567890');
    expect(profile.xHandle).toBe('BearCrypto');
  });

  it('rejects malformed X profile identity', () => {
    expect(() => parseXMeResponse({ data: { id: 'abc', username: 'ok' } })).toThrow();
  });

  it('only enables X after an exact callback and binds the return to the originating allowlisted host',()=>{
    const primary='https://veyra-unified-testnet.vercel.app';
    const v2='https://veyra-unified-testnet-v2.vercel.app';
    const allowed=[primary,v2];
    expect(isConfiguredXOAuth('client-ok','https://veyra-testnet-acceptance-bff.onrender.com/api/auth/x/callback')).toBe(true);
    for(const bad of ['https://evil.example/api/auth/x/callback','http://veyra-testnet-acceptance-bff.onrender.com/api/auth/x/callback','']) {
      expect(isConfiguredXOAuth('client-ok',bad)).toBe(false);
    }
    expect(checkedXReturnOrigin(v2,allowed)).toBe(v2);
    expect(buildXLinkedReturnUrl(v2,allowed)).toBe(v2+'/?x_linked=1');
    expect(buildXLinkedReturnUrl(primary,allowed)).toBe(primary+'/?x_linked=1');
    for(const evil of ['https://evil.example','https://veyra-unified-testnet-v2.vercel.app.evil.example',
      'javascript:alert(1)','//evil.example',null]){
      expect(()=>checkedXReturnOrigin(evil,allowed)).toThrow();
      expect(()=>buildXLinkedReturnUrl(String(evil),allowed)).toThrow();
    }
  });

  it('hashes OAuth state without persisting the raw state', () => {
    expect(hashOAuthState('secret-state')).toMatch(/^[0-9a-f]{64}$/);
    expect(hashOAuthState('secret-state')).not.toContain('secret-state');
  });
});

function hashToBase64Url(value: string): string {
  return createHash('sha256').update(value).digest('base64url');
}
