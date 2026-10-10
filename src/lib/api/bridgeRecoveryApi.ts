import type { BridgeRecoveryCheckpoint } from '../../core/execution/bridgeCheckpointStore';

const DEV_USER_ID = import.meta.env.VITE_DEV_VEYRA_USER_ID as string | undefined;

function bridgeAuthHeaders(): Record<string, string> {
  if (typeof sessionStorage === 'undefined') return {};
  const token = sessionStorage.getItem('veyra:session-token');
  if (token) return { Authorization: `Bearer ${token}` };
  if (import.meta.env.DEV && DEV_USER_ID) return { 'X-Veyra-User-Id': DEV_USER_ID };
  return {};
}

function hasBridgeAuth(): boolean {
  return Object.keys(bridgeAuthHeaders()).length > 0;
}

/**
 * Best-effort authenticated server mirror. Local IndexedDB remains the immediate
 * recovery cache; Postgres adds cross-device/browser-loss durability.
 */
export async function persistBridgeCheckpointRemote(
  checkpoint: BridgeRecoveryCheckpoint,
): Promise<boolean> {
  if (!hasBridgeAuth()) return false;

  const response = await fetch('/api/bridge/persist', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...bridgeAuthHeaders(),
    },
    body: JSON.stringify(checkpoint),
  });

  if (response.status === 401) return false;

  const payload = await response.json() as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(
      typeof payload.message === 'string'
        ? payload.message
        : `Bridge recovery persistence failed (${response.status})`,
    );
  }

  return true;
}

export async function loadRemoteBridgeCheckpoints(): Promise<BridgeRecoveryCheckpoint[]> {
  if (!hasBridgeAuth()) return [];

  const response = await fetch('/api/bridge/pending', {
    headers: bridgeAuthHeaders(),
  });

  if (response.status === 401) return [];

  const payload = await response.json() as {
    pending?: BridgeRecoveryCheckpoint[];
    message?: string;
  };

  if (!response.ok) {
    throw new Error(
      typeof payload.message === 'string'
        ? payload.message
        : `Bridge recovery load failed (${response.status})`,
    );
  }

  return Array.isArray(payload.pending) ? payload.pending : [];
}


export type BridgeRelayRemoteResult =
  | { mode: 'UNAVAILABLE' }
  | { mode: 'SUBMITTED'; txHash: string }
  | { mode: 'ALREADY_SUBMITTED'; txHash: string }
  | { mode: 'ALREADY_RECEIVED' };

/**
 * Ask the authenticated BFF to relay the exact persisted recovery plan.
 *
 * The browser sends only planId. Message, attestation, destination chain and
 * ownership are loaded from the server-side checkpoint so request payloads
 * cannot substitute another CCTP message.
 */
export async function relayBridgeReceiveRemote(
  planId: string,
): Promise<BridgeRelayRemoteResult> {
  if (!hasBridgeAuth()) return { mode: 'UNAVAILABLE' };

  const response = await fetch('/api/bridge/relay-receive', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...bridgeAuthHeaders(),
    },
    body: JSON.stringify({ planId }),
  });

  if (response.status === 401 || response.status === 503) {
    return { mode: 'UNAVAILABLE' };
  }

  const payload = await response.json() as {
    ok?: boolean;
    alreadyReceived?: boolean;
    alreadySubmitted?: boolean;
    txHash?: string | null;
    message?: string;
    error?: string;
  };

  if (!response.ok || !payload.ok) {
    throw new Error(
      payload.message ??
        payload.error ??
        `Bridge relay failed (${response.status})`,
    );
  }

  if (payload.alreadySubmitted && typeof payload.txHash === 'string') {
    return { mode: 'ALREADY_SUBMITTED', txHash: payload.txHash };
  }

  if (payload.alreadyReceived) {
    return { mode: 'ALREADY_RECEIVED' };
  }

  if (typeof payload.txHash === 'string') {
    return { mode: 'SUBMITTED', txHash: payload.txHash };
  }

  throw new Error('Bridge relay response did not include a destination tx hash.');
}
