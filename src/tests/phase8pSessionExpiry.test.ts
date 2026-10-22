import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  VeyraSessionExpiredError, readFriends, registerComplete,
} from '../identity-beta/api';

afterEach(() => vi.unstubAllGlobals());
function mockReply(status: number, body: Record<string, unknown>) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  })));
}
describe('Phase 8P — identity 401 cannot leave a stale signed session', () => {
  it('uses a typed auth failure for bearer-protected requests', async () => {
    mockReply(401, { ok: false, error: 'AUTH_REQUIRED' });
    await expect(readFriends('opaque-valid-looking-token')).rejects.toBeInstanceOf(
      VeyraSessionExpiredError,
    );
  });
  it('never interprets a first-time EIP-712 registration signature failure as session expiry', async () => {
    mockReply(401, {
      ok: false, error: 'INVALID_SIGNATURE',
      message: 'Identity claim was not signed by the connected wallet',
    });
    const request = registerComplete('fake-claim-token', '0x'+'ab'.repeat(65));
    await expect(request).rejects.toThrow('Wallet signature verification failed');
    await expect(request).rejects.not.toBeInstanceOf(VeyraSessionExpiredError);
  });
});
