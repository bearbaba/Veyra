import type { BridgeRecoveryCheckpoint } from '../../core/execution/bridgeCheckpointStore';
import {activeSignedIdentityToken} from './liveIdentitySession';

const DEV_USER_ID = import.meta.env.VITE_DEV_VEYRA_USER_ID as string | undefined;

function bridgeAuthHeaders(): Record<string, string> {
  const token = activeSignedIdentityToken();
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


/**
 * Claim the unique destination submission slot before presenting a wallet
 * signature for self-relay. Missing authentication/server errors are fatal:
 * no wallet broadcast may occur without this durable cross-device lock.
 */
export async function claimSelfRelayDestinationRemote(planId: string): Promise<void> {
  const headers = bridgeAuthHeaders();
  if (Object.keys(headers).length === 0) {
    throw new Error('Authenticated Veyra session required before self-relay signing.');
  }

  const response = await fetch('/api/bridge/claim-self-receive', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ planId }),
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok || payload.ok !== true || payload.mode !== 'CLAIMED') {
    throw new Error(
      typeof payload.message === 'string'
        ? payload.message
        : 'Destination relay claim could not be confirmed. Do not sign a new receive transaction.',
    );
  }
}

/**
 * A browser hash is only a hint. The server validates the transaction from
 * the destination RPC and binds calldata to the immutable Circle attestation
 * before writing the initial destination attempt to the shared audit ledger.
 */
export async function recordSelfRelayDestinationRemote(
  planId: string,
  txHash: string,
): Promise<void> {
  const headers = bridgeAuthHeaders();
  if (Object.keys(headers).length === 0) {
    throw new Error('Authenticated session required to reconcile a self-relay tx.');
  }
  const response = await fetch('/api/bridge/record-self-receive', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ planId, txHash }),
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (
    !response.ok ||
    payload.ok !== true ||
    typeof payload.txHash !== 'string' ||
    payload.txHash.toLowerCase() !== txHash.toLowerCase()
  ) {
    throw new Error(
      typeof payload.message === 'string'
        ? payload.message
        : 'Self-relay transaction has not yet been independently verified by the server.',
    );
  }
}

/**
 * Request independent proof that the immutable FIRST destination receive
 * reverted. This records only a canonical, finality-checked, append-only
 * resolution; it never grants permission for a new source burn/receive tx.
 */
export async function resolveFirstDestinationRevertRemote(
  planId: string,
): Promise<boolean> {
  const auth = bridgeAuthHeaders();
  if (Object.keys(auth).length === 0) return false;

  const response = await fetch('/api/bridge/resolve-destination-revert', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth },
    body: JSON.stringify({ planId }),
  });
  const result = await response.json().catch(() => ({})) as Record<string, unknown>;
  return response.ok &&
    result.ok === true &&
    result.planId === planId &&
    result.outcome === 'REVERTED' &&
    result.retryAuthorized === false;
}

/**
 * Owner-authenticated, read-only CCTP V2 usedNonces() inspection.
 *
 * Nonce=0 only means unused at a specific canonical destination block. It
 * NEVER grants a second submission. The server independently rechecks the
 * first revert and source Circle evidence before returning this observation.
 */
export interface DestinationNonceObservation {
  nonce: string;
  destinationChainId: number;
  destinationDomain: number;
  observedBlockNumber: number;
  observedBlockHash: string;
  usage: 'UNUSED_AT_OBSERVED_BLOCK' | 'ALREADY_CONSUMED';
  retryAuthorized: false;
}

export async function inspectDestinationNonceRemote(
  planId: string,
): Promise<DestinationNonceObservation> {
  const auth = bridgeAuthHeaders();
  if (Object.keys(auth).length === 0) {
    throw new Error('An authenticated Veyra session is required to inspect a CCTP nonce.');
  }

  const response = await fetch('/api/bridge/inspect-destination-nonce', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...auth,
    },
    body: JSON.stringify({ planId }),
  });
  const payload = await response.json().catch(() => ({})) as {
    ok?: boolean;
    planId?: string;
    observation?: Partial<DestinationNonceObservation>;
    retryAuthorized?: boolean;
    message?: string;
  };
  const observed = payload.observation;
  if (
    !response.ok ||
    payload.ok !== true ||
    payload.planId !== planId ||
    payload.retryAuthorized !== false ||
    !observed ||
    (observed.usage !== 'UNUSED_AT_OBSERVED_BLOCK' &&
      observed.usage !== 'ALREADY_CONSUMED') ||
    observed.retryAuthorized !== false ||
    typeof observed.nonce !== 'string' ||
    !/^0x[0-9a-fA-F]{64}$/.test(observed.nonce) ||
    typeof observed.observedBlockHash !== 'string' ||
    !/^0x[0-9a-fA-F]{64}$/.test(observed.observedBlockHash) ||
    !Number.isSafeInteger(observed.observedBlockNumber) ||
    !Number.isSafeInteger(observed.destinationChainId) ||
    !Number.isSafeInteger(observed.destinationDomain)
  ) {
    throw new Error(
      payload.message ??
      'The destination nonce could not be independently verified. Do not retry.',
    );
  }

  return {
    nonce: observed.nonce,
    destinationChainId: observed.destinationChainId as number,
    destinationDomain: observed.destinationDomain as number,
    observedBlockNumber: observed.observedBlockNumber as number,
    observedBlockHash: observed.observedBlockHash,
    usage: observed.usage,
    retryAuthorized: false,
  };
}

/**
 * Cross-device attempt ledger is read-only, owner-scoped and authoritative.
 * An UNCERTAIN slot (even with no hash) is NEVER an invitation to rebroadcast.
 */
export interface DestinationAttemptHistoryRemote {
  planId: string;
  sourceBurnTxHash: string;
  destinationChainId: number;
  first: {
    receiveTxHash: string | null;
    state: 'UNCLAIMED' | 'UNCERTAIN' | 'RECORDED';
    reverted: boolean;
    revertBlockHash: string | null;
    confirmations: number | null;
  };
  second: {
    receiveTxHash: string | null;
    state: 'UNCLAIMED' | 'UNCERTAIN' | 'RECORDED';
    verifiedMint: boolean;
    mintBlockHash: string | null;
    confirmations: number | null;
  };
  history: Array<{
    attemptNumber: number;
    eventType: string;
    txHash: string | null;
    occurredAt: string;
  }>;
}

export async function loadDestinationAttemptHistoryRemote(
  planId: string,
): Promise<DestinationAttemptHistoryRemote> {
  const auth = bridgeAuthHeaders();
  if (Object.keys(auth).length === 0) {
    throw new Error('Authenticated Veyra session required to load destination attempt history.');
  }
  const response = await fetch(
    `/api/bridge/destination-attempts?planId=${encodeURIComponent(planId)}`,
    { headers: auth },
  );
  const payload = await response.json().catch(() => ({})) as {
    ok?: boolean;
    retryAuthorized?: boolean;
    history?: Partial<DestinationAttemptHistoryRemote>;
    message?: string;
  };
  const h = payload.history;
  if (
    !response.ok ||
    payload.ok !== true ||
    payload.retryAuthorized !== false ||
    !h ||
    h.planId !== planId ||
    !h.first ||
    !h.second ||
    !Array.isArray(h.history) ||
    !['UNCLAIMED', 'UNCERTAIN', 'RECORDED'].includes(h.first.state) ||
    !['UNCLAIMED', 'UNCERTAIN', 'RECORDED'].includes(h.second.state)
  ) {
    throw new Error(
      payload.message ?? 'Authenticated attempt history unavailable. Do not retry.',
    );
  }
  return h as DestinationAttemptHistoryRemote;
}

/**
 * Recover an EXISTING attempt #2 broadcast hash only. The server rejects
 * missing reservations, changed first revert, swapped chain/tx, different
 * attestation or caller policy. This does not mark USDC minted or COMPLETE.
 */
export async function reconcileSecondReceiveRemote(
  planId: string,
  txHash: string,
): Promise<void> {
  const auth = bridgeAuthHeaders();
  if (
    Object.keys(auth).length === 0 ||
    !/^0x[0-9a-fA-F]{64}$/.test(txHash)
  ) {
    throw new Error('Authenticated session and full existing second receive hash required.');
  }
  const response = await fetch('/api/bridge/reconcile-second-receive', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth },
    body: JSON.stringify({ planId, txHash }),
  });
  const payload = await response.json().catch(() => ({})) as {
    ok?: boolean;
    attemptNumber?: number;
    txHash?: string;
    planId?: string;
    retryAuthorized?: boolean;
    message?: string;
  };
  if (
    !response.ok ||
    payload.ok !== true ||
    payload.planId !== planId ||
    payload.attemptNumber !== 2 ||
    payload.retryAuthorized !== false ||
    payload.txHash?.toLowerCase() !== txHash.toLowerCase()
  ) {
    throw new Error(
      payload.message ?? 'Second transaction not independently verified. Retry slot stays locked.',
    );
  }
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

/**
 * Finalize an EXISTING second destination receive only after the authenticated
 * BFF independently re-fetches the source/Circle proof and verifies the
 * canonical destination USDC mint. No wallet request or new broadcast.
 */
export async function finalizeVerifiedSecondSettlementRemote(
  planId: string,
): Promise<{ receiptId: string; settlementReceiveTxHash: string; status: 'COMPLETE' }> {
  const auth = bridgeAuthHeaders();
  if (Object.keys(auth).length === 0 || !planId || planId.length > 160) {
    throw new Error('Authenticated owned bridge plan is required for settlement verification.');
  }
  const response = await fetch('/api/bridge/finalize-second-settlement', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth },
    body: JSON.stringify({ planId }),
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok || payload.ok !== true ||
      payload.planId !== planId || payload.status !== 'COMPLETE' ||
      payload.retryAuthorized !== false ||
      typeof payload.receiptId !== 'string' || !payload.receiptId ||
      typeof payload.settlementReceiveTxHash !== 'string' ||
      !/^0x[0-9a-fA-F]{64}$/.test(payload.settlementReceiveTxHash) ||
      payload.settlementAttemptNumber !== 2) {
    throw new Error(typeof payload.message === 'string'
      ? payload.message
      : 'Canonical second destination USDC mint is not yet verified. No new transaction was sent.');
  }
  return {
    receiptId: payload.receiptId,
    settlementReceiveTxHash: payload.settlementReceiveTxHash,
    status: 'COMPLETE',
  };
}
