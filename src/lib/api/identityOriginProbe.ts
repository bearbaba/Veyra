/**
 * Fail-closed browser-origin probe for the authenticated Veyra ID surface.
 *
 * A GET /api/health can return "ok" even when Vercel's browser Origin is
 * refused by the hosted BFF on subsequent POST sign-in requests. The BFF
 * already validates Origin BEFORE the identity registration/complete handler.
 * Sending an intentionally incomplete, unsigned body to this endpoint is
 * read-only, requires no wallet permission and deterministically returns
 * INVALID_REQUEST (400) from an authorized BFF.
 *
 * This probe NEVER signs, creates an identity, calls an OAuth provider or
 * accesses user data. An unexpected response never enables signing.
 */
export type IdentityOriginStatus = 'checking' | 'ready' | 'origin_blocked' | 'offline';

export async function probeIdentityOrigin(signal?: AbortSignal): Promise<Exclude<IdentityOriginStatus, 'checking'>> {
  try {
    const response = await fetch('/api/identity/register/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: '{}',
      cache: 'no-store',
      credentials: 'same-origin',
      // Render Free may cold-start. Bound the spinner rather than leaving
      // the whole identity surface in "Checking" indefinitely. No auto-sign.
      signal: signal ? AbortSignal.any([signal,AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000),
    });
    const type = response.headers.get('content-type') ?? '';
    if (!type.toLowerCase().includes('application/json')) return 'offline';
    const result: unknown = await response.json();
    if (!result || typeof result !== 'object' || Array.isArray(result)) return 'offline';
    const code = 'error' in result ? result.error : undefined;
    if (response.status === 403 && code === 'ORIGIN_NOT_ALLOWED') return 'origin_blocked';
    if (response.status === 400 && code === 'INVALID_REQUEST') return 'ready';
    return 'offline';
  } catch {
    return 'offline';
  }
}
