import type { PreflightResult } from '../../providers/bridge/bridgeProviderTypes';

const DEV_USER_ID = import.meta.env.VITE_DEV_VEYRA_USER_ID as string | undefined;

function authHeaders(): Record<string, string> {
  if (typeof sessionStorage === 'undefined') return {};
  const token = sessionStorage.getItem('veyra:session-token');
  if (token) return { Authorization: `Bearer ${token}` };
  if (import.meta.env.DEV && DEV_USER_ID) {
    return { 'X-Veyra-User-Id': DEV_USER_ID };
  }
  return {};
}

export type ActivityReceiptStatus =
  | 'INTENT_CAPTURED'
  | 'QUOTE_RESERVED'
  | 'PREFLIGHT_PASSED'
  | 'SIGNED'
  | 'BROADCAST'
  | 'CONFIRMING'
  | 'CONFIRMED'
  | 'SOURCE_CONFIRMED'
  | 'ATTESTATION_PENDING'
  | 'FAILED'
  | 'RECEIVE_PENDING'
  | 'RECEIVE_FAILED_RETRYABLE'
  | 'COMPLETE'
  | 'DUPLICATE_DETECTED'
  | 'INVALIDATED'
  | 'CANCELLED';

export interface ActivityReceiptRemoteRecord {
  receiptId: string;
  clientIntentId: string;
  senderAddress: string;
  senderChainId: number;
  recipientAddress: string;
  recipientChainId: number;
  amountRaw: string;
  amountDecimals: number;
  assetId: string;
  tokenAddress: string;
  providerId: string;
  providerVersion: string;
  routeId: string;
  status: ActivityReceiptStatus;
  revision: number;
  burnTxHash: string | null;
  burnChainId: number | null;
  burnBlockNumber: number | null;
  receiveTxHash: string | null;
  receiveChainId: number | null;
  receiveBlockNumber: number | null;
  resumable: boolean;
  resumePayload: Record<string, unknown> | null;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
  confirmedAt: string | null;
  completedAt: string | null;
  failedAt: string | null;
  cancelledAt: string | null;
}

export interface ActivityReceiptHandle {
  receiptId: string;
  revision: number;
}

export interface CreateBridgeActivityReceiptRequest {
  clientIntentId: string;
  routeId: string;
  senderAddress: string;
  sourceChainId: number;
  destinationAddress: string;
  destinationChainId: number;
  amountRaw: string;
  tokenAddress: string;
  recipientSnapshotId?: string | null;
  policyResult: Record<string, unknown>;
  preflightResults: PreflightResult[];
}

export interface ActivityReceiptSyncRequest {
  receiptId: string;
  revision: number;
  status: ActivityReceiptStatus;
  burnTxHash?: string;
  burnChainId?: number;
  burnBlockNumber?: number;
  receiveTxHash?: string;
  receiveChainId?: number;
  receiveBlockNumber?: number;
  messageHash?: string;
  messageBytes?: string;
  attestationNonce?: string;
  failureReason?: string;
  resumable?: boolean;
  resumePayload?: Record<string, unknown> | null;
}

export class ActivityReceiptApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ActivityReceiptApiError';
  }
}

async function parseResponse(
  response: Response,
): Promise<Record<string, unknown>> {
  const payload = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;

  if (!response.ok) {
    throw new ActivityReceiptApiError(
      response.status,
      typeof payload.error === 'string' ? payload.error : 'REQUEST_FAILED',
      typeof payload.message === 'string'
        ? payload.message
        : `Activity receipt request failed (${response.status})`,
    );
  }

  return payload;
}

function requireAuthHeaders(): Record<string, string> {
  const headers = authHeaders();
  if (Object.keys(headers).length === 0) {
    throw new ActivityReceiptApiError(
      401,
      'AUTH_REQUIRED',
      'Create or sign in to your Veyra identity before executing a production money action.',
    );
  }
  return headers;
}

export async function createBridgeActivityReceiptRemote(
  request: CreateBridgeActivityReceiptRequest,
): Promise<ActivityReceiptHandle> {
  const response = await fetch('/api/receipts/bridge', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...requireAuthHeaders(),
    },
    body: JSON.stringify(request),
  });

  const payload = await parseResponse(response);
  if (
    typeof payload.receiptId !== 'string' ||
    typeof payload.revision !== 'number'
  ) {
    throw new ActivityReceiptApiError(
      502,
      'INVALID_RECEIPT_RESPONSE',
      'Veyra receipt service returned an invalid create response.',
    );
  }

  return {
    receiptId: payload.receiptId,
    revision: payload.revision,
  };
}

export async function syncActivityReceiptRemote(
  request: ActivityReceiptSyncRequest,
): Promise<{
  conflict: boolean;
  serverRecord: ActivityReceiptRemoteRecord;
}> {
  const response = await fetch('/api/receipts/sync', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...requireAuthHeaders(),
    },
    body: JSON.stringify(request),
  });

  const payload = await parseResponse(response);
  if (
    typeof payload.conflict !== 'boolean' ||
    !payload.serverRecord ||
    typeof payload.serverRecord !== 'object'
  ) {
    throw new ActivityReceiptApiError(
      502,
      'INVALID_RECEIPT_RESPONSE',
      'Veyra receipt service returned an invalid sync response.',
    );
  }

  return {
    conflict: payload.conflict,
    serverRecord: payload.serverRecord as unknown as ActivityReceiptRemoteRecord,
  };
}

export async function loadActivityReceiptsRemote(
  limit = 100,
): Promise<ActivityReceiptRemoteRecord[]> {
  const headers = authHeaders();
  if (Object.keys(headers).length === 0) return [];

  const response = await fetch(
    `/api/receipts?limit=${Math.max(1, Math.min(250, Math.trunc(limit)))}`,
    { headers },
  );

  if (response.status === 401) return [];
  const payload = await parseResponse(response);
  return Array.isArray(payload.receipts)
    ? (payload.receipts as ActivityReceiptRemoteRecord[])
    : [];
}

export async function loadResumableActivityReceiptsRemote(): Promise<
  ActivityReceiptRemoteRecord[]
> {
  const headers = authHeaders();
  if (Object.keys(headers).length === 0) return [];

  const response = await fetch('/api/receipts/resumable', { headers });
  if (response.status === 401) return [];
  const payload = await parseResponse(response);
  return Array.isArray(payload.receipts)
    ? (payload.receipts as ActivityReceiptRemoteRecord[])
    : [];
}
