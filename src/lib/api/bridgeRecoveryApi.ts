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
