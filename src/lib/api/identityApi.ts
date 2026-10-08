const DEV_USER_ID = import.meta.env.VITE_DEV_VEYRA_USER_ID as string | undefined;

function authHeaders(): Record<string, string> {
  const token = sessionStorage.getItem('veyra:session-token');
  if (token) return { Authorization: `Bearer ${token}` };
  if (import.meta.env.DEV && DEV_USER_ID) return { 'X-Veyra-User-Id': DEV_USER_ID };
  return {};
}

async function postJson<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  });
  const payload = await response.json() as Record<string, unknown>;
  if (!response.ok) {
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
  };
}

export async function preparePaymentRecipient(recipient: string, chainId: number): Promise<PreparedRecipient> {
  const result = await postJson<{ ok: true; prepared: PreparedRecipient }>('/api/identity/prepare-payment', {
    recipient,
    chainId,
  });
  return result.prepared;
}

export async function verifyPaymentRecipient(input: {
  snapshotId: string;
  expectedWalletAddress: string;
  expectedChainId: number;
}): Promise<void> {
  const result = await postJson<{ ok: boolean; reason?: string }>('/api/identity/verify-payment', input);
  if (!result.ok) throw new Error(result.reason ?? 'Recipient identity changed since review');
}


export interface MyProfile {
  veyraUserId: string;
  veyraHandle: string;
  displayName: string;
  x: null | { xAccountId: string; xHandle: string | null };
}

export async function getMyProfile(): Promise<MyProfile> {
  const response = await fetch('/api/profile/me', { headers: authHeaders() });
  const payload = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof payload.message === 'string' ? payload.message : `Request failed (${response.status})`);
  return (payload as unknown as { profile: MyProfile }).profile;
}

export async function beginXLink(returnPath = '/settings'): Promise<string> {
  const result = await postJson<{ ok: true; authorizeUrl: string }>('/api/auth/x/start', { returnPath });
  return result.authorizeUrl;
}
