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
import {VEYRA_ENV} from '../env';

const OFFICIAL_ORIGIN='https://veyra-seven-beta.vercel.app';
export function isMainnetIdentityCapability(value:unknown):boolean{
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const v=value as Record<string,unknown>;
 return v.ok===true&&v.environment==='mainnet'&&v.origin===OFFICIAL_ORIGIN&&
  v.chainId===5042&&v.walletLogin===true&&v.recipientSnapshots===true&&v.cookieRestore===true;
}
export async function probeMainnetIdentityOrigin(
 signal?:AbortSignal,origin=typeof window==='undefined'?'':window.location.origin,
):Promise<'ready'|'origin_blocked'|'offline'>{
 if(origin!==OFFICIAL_ORIGIN)return 'origin_blocked';
 try{
  const response=await fetch('/api/identity/mainnet-capability',{
   method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},
   body:'{}',credentials:'same-origin',cache:'no-store',
   signal:signal?AbortSignal.any([signal,AbortSignal.timeout(30000)]):AbortSignal.timeout(30000),
  });
  if(!(response.headers.get('content-type')??'').toLowerCase().includes('application/json'))return 'offline';
  const payload:unknown=await response.json();
  if(response.status===403&&payload&&typeof payload==='object'&&'error' in payload&&
     payload.error==='ORIGIN_NOT_ALLOWED')return 'origin_blocked';
  return response.status===200&&isMainnetIdentityCapability(payload)?'ready':'offline';
 }catch{return 'offline';}
}
export type IdentityOriginStatus = 'checking' | 'ready' | 'origin_blocked' | 'offline';

export async function probeIdentityOrigin(signal?: AbortSignal): Promise<Exclude<IdentityOriginStatus, 'checking'>> {
  if(VEYRA_ENV==='mainnet')return probeMainnetIdentityOrigin(signal);
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
