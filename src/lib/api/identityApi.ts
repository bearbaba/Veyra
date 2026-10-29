import {activeSignedIdentityToken} from './liveIdentitySession';
import {verifyXAuthorizationUrl} from '../../identity-beta/protocol';

const DEV_USER_ID = import.meta.env.VITE_DEV_VEYRA_USER_ID as string | undefined;

/**
 * A payment to a human-readable ID must use the active, wallet-bound Social
 * session, not a leftover browser storage token from another wallet.
 * Other legacy identity endpoints retain their old behavior until migrated.
 */
export function requireSignedIdentityToken(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 8192 ||
      !/^[\x21-\x7e]+$/.test(value)) {
    throw new Error('Sign in to Veyra ID with your connected wallet before reviewing a recipient.');
  }
  return value;
}

function authHeaders(explicitToken?: string): Record<string, string> {
  if (explicitToken !== undefined) return { Authorization: `Bearer ${requireSignedIdentityToken(explicitToken)}` };
  const token = activeSignedIdentityToken();
  if (token) return { Authorization: `Bearer ${token}` };
  if (import.meta.env.DEV && DEV_USER_ID) return { 'X-Veyra-User-Id': DEV_USER_ID };
  return {};
}

async function postJson<T>(path: string, body: Record<string, unknown>, explicitToken?: string): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(explicitToken) },
    body: JSON.stringify(body),
  });
  // Vercel SPA fallbacks can return index.html (status 200) instead of an
  // unconfigured API route. Do not surface a raw "Unexpected token '<'" error.
  let payload: Record<string, unknown>;
  try {
    const parsed: unknown = await response.json();
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid JSON shape');
    payload = parsed as Record<string, unknown>;
  } catch {
    const label = path === '/api/auth/x/start' ? 'X linking' : 'Veyra';
    throw new Error(`${label} service is not available on this website. Your wallet and identity are unchanged.`);
  }
  if (!response.ok || payload.ok === false) {
    throw new Error(typeof payload.message === 'string' ? payload.message : `Request failed (${response.status})`);
  }
  return payload as T;
}

export interface PreparedRecipient {
  kind: 'WALLET' | 'VEYRA_IDENTITY';
  resolvedAddress: string;
  chainId: number;
  snapshot: null | {
    snapshotId: string;
    veyraUserId: string;
    veyraHandle: string;
    displayName: string;
    avatarUrl: string | null;
    expiresAt: string;
    walletId: string;
    reviewToken: string;
  };
}

export async function preparePaymentRecipient(recipient: string, chainId: number, sessionToken: string): Promise<PreparedRecipient> {
  const signedToken = requireSignedIdentityToken(sessionToken);
  const result = await postJson<{ ok: true; prepared: PreparedRecipient }>('/api/identity/prepare-payment', {
    recipient,
    chainId,
  }, signedToken);
  return result.prepared;
}

export async function verifyPaymentRecipient(input: {
  snapshotId: string;
  expectedWalletId: string;
  expectedWalletAddress: string;
  expectedChainId: number;
  reviewToken: string;
}, sessionToken: string): Promise<void> {
  const signedToken = requireSignedIdentityToken(sessionToken);
  const result = await postJson<{ ok: boolean; reason?: string }>('/api/identity/verify-payment', input, signedToken);
  if (!result.ok) throw new Error(result.reason ?? 'Recipient identity changed since review');
}


export interface MyProfile {
  veyraUserId: string;
  veyraHandle: string;
  displayName: string;
  x: null | { xAccountId: string; xHandle: string | null; avatarUrl?: string | null };
}

export async function getMyProfile(): Promise<MyProfile> {
  const response = await fetch('/api/profile/me', { headers: authHeaders() });
  const payload = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof payload.message === 'string' ? payload.message : `Request failed (${response.status})`);
  return (payload as unknown as { profile: MyProfile }).profile;
}

// Read-only capability probe. An older BFF (404), HTML fallback or missing
// provider config must leave the X button disabled, not offer dead OAuth.
export type XLinkReadiness = { available: boolean; reason: string };
/** Public status only: never expose X credentials, tokens or OAuth state. */
export async function probeXLinkReadiness():Promise<XLinkReadiness>{
  try{
    const response=await fetch('/api/auth/x/capability',{
      method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},
      credentials:'same-origin',cache:'no-store',body:'{}',
      signal:AbortSignal.timeout(12000),
    });
    if(response.status===403)
      return {available:false,reason:'This website is not an approved X-link return origin. Open the stable Veyra Testnet V2 domain.'};
    if(response.status===404)
      return {available:false,reason:'The identity backend does not expose X linking yet. The backend needs deployment.'};
    if(!response.ok)
      return {available:false,reason:'The X-link backend is unavailable (HTTP '+response.status+'). No account was changed.'};
    if(!response.headers.get('content-type')?.includes('application/json'))
      return {available:false,reason:'The X-link endpoint returned a webpage rather than verified JSON.'};
    const payload:unknown=await response.json();
    if(!payload||typeof payload!=='object'||Array.isArray(payload)||!('ok' in payload)||payload.ok!==true)
      return {available:false,reason:'X capability could not be verified against the identity backend.'};
    if(!('available' in payload)||payload.available!==true)
      return {available:false,reason:'X OAuth is not enabled on the identity backend. Check Render X_CLIENT_ID, pinned X_REDIRECT_URI and the X Developer Portal callback.'};
    return {available:true,reason:''};
  }catch{
    return {available:false,reason:'Cannot reach the X capability endpoint. Check the Veyra Testnet backend and try again.'};
  }
}
export async function getXLinkCapability():Promise<boolean>{
  return (await probeXLinkReadiness()).available;
}

export async function finishXLink(state: string, signedToken: string): Promise<void> {
  if (!/^[-_A-Za-z0-9]{30,128}$/.test(state)) throw new Error('X authorization state is invalid. Start again.');
  await postJson<{ ok: true }>('/api/auth/x/finish', { state }, requireSignedIdentityToken(signedToken));
}

export async function beginXLink(returnPath = '/settings'): Promise<string> {
  const result = await postJson<{ ok: true; authorizeUrl: string }>('/api/auth/x/start', { returnPath });
  return verifyXAuthorizationUrl(result.authorizeUrl);
}

export interface IdentityRegistrationChallenge {
  claimToken: string;
  expiresAt: string;
  typedData: {
    domain: { name: string; version: string; chainId: number; verifyingContract: `0x${string}` };
    types: {
      IdentityClaim: readonly [
        { readonly name: 'handle'; readonly type: 'string' },
        { readonly name: 'walletAddress'; readonly type: 'address' },
        { readonly name: 'chainId'; readonly type: 'uint256' },
        { readonly name: 'nonce'; readonly type: 'bytes32' },
        { readonly name: 'issuedAt'; readonly type: 'uint256' },
        { readonly name: 'expiresAt'; readonly type: 'uint256' },
      ];
    };
    primaryType: 'IdentityClaim';
    message: {
      handle: string;
      walletAddress: `0x${string}`;
      chainId: number;
      nonce: `0x${string}`;
      issuedAt: number;
      expiresAt: number;
    };
  };
}

export async function beginVeyraIdRegistration(input: {
  handle: string;
  walletAddress: string;
  chainId: number;
}): Promise<IdentityRegistrationChallenge> {
  const result = await postJson<{ ok: true; challenge: IdentityRegistrationChallenge }>('/api/identity/register/challenge', input);
  return result.challenge;
}

export async function completeVeyraIdRegistration(input: {
  claimToken: string;
  signature: `0x${string}`;
}): Promise<{ profile: MyProfile; sessionToken: string }> {
  const result = await postJson<{ ok: true; profile: MyProfile; sessionToken: string }>('/api/identity/register/complete', input);
  // The signed Social provider alone may activate a wallet-bound session.
  return { profile: result.profile, sessionToken: result.sessionToken };
}
