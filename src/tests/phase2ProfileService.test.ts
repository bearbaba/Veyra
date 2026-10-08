import { describe, expect, it } from 'vitest';
import { validateXIdentityImport } from '../../server/services/profileService.js';

describe('Phase 2B profile/X identity validation', () => {
  it('accepts immutable numeric X account IDs and mutable handles separately', () => {
    const result = validateXIdentityImport({
      xAccountId: '1234567890123456789',
      xHandle: 'Bearcrypto2021',
      xDisplayName: 'Bear Crypto',
      xAvatarUrl: 'https://pbs.twimg.com/profile_images/example.jpg',
      xBio: 'Veyra test profile',
    });
    expect(result.xAccountId).toBe('1234567890123456789');
    expect(result.xHandle).toBe('Bearcrypto2021');
  });

  it('rejects a handle used as the canonical X account id', () => {
    expect(() => validateXIdentityImport({
      xAccountId: 'Bearcrypto2021',
      xHandle: 'Bearcrypto2021',
    })).toThrow('immutable numeric account id');
  });

  it('rejects non-HTTPS avatar URLs', () => {
    expect(() => validateXIdentityImport({
      xAccountId: '123456789',
      xHandle: 'bearcrypto',
      xAvatarUrl: 'http://example.com/avatar.png',
    })).toThrow('HTTPS');
  });
});
