import type {
  ReceiptExecutionContext,
  ReceiptStatus as LocalReceiptStatus,
  VeyraReceipt,
} from '../../core/receipt/receiptTypes';

const DEV_USER_ID = import.meta.env.VITE_DEV_VEYRA_USER_ID as
  | string
  | undefined;

function authHeaders(): Record<string, string> {
  if (typeof sessionStorage === 'undefined') return {};
  const token = sessionStorage.getItem('veyra:session-token');
  if (token) return { Authorization: `Bearer ${token}` };
  if (import.meta.env.DEV && DEV_USER_ID) {
    return { 'X-Veyra-User-Id': DEV_USER_ID };
  }
  return {};
}

function hasAuth(): boolean {
  return Object.keys(authHeaders()).length > 0;
}

type ServerReceiptStatus =
  | 'INTENT_CAPTURED'
  | 'QUOTE_RESERVED'
  | 'PREFLIGHT_PASSED'
  | 'SIGNED'
  | 'BROADCAST'
  | 'CONFIRMING'
  | 'CONFIRMED'
  | 'FAILED'
  | 'RECEIVE_PENDING'
  | 'RECEIVE_FAILED_RETRYABLE'
  | 'COMPLETE'
  | 'DUPLICATE_DETECTED'
  | 'INVALIDATED';

export interface ReceiptSyncPayload {
  receiptId: string;
  clientIntentId: string;
  localRevision: number;
  actionType: VeyraReceipt['actionType'];
  surface: ReceiptExecutionContext['surface'];
  senderAddress: string;
  senderChainId: number;
  recipientSnapshotId?: string | null;
  recipientAddress: string;
  recipientChainId: number;
  amountRaw: string;
  amountDecimals: number;
  assetId: string;
  tokenAddress: string;
  providerId: string;
  routeId: string;
  quoteId?: string;
  environment: ReceiptExecutionContext['environment'];
  status: ServerReceiptStatus;
  executionTxHash?: string;
  executionBlock?: number;
  actualAmountRaw?: string | null;
  balanceBeforeRaw?: string | null;
  verifiedBalanceAfter?: string | null;
  riskScore?: number | null;
  policyDecision?: string | null;
  displaySummary?: string | null;
  burnTxHash?: string;
  burnChainId?: number;
  burnBlockNumber?: number;
  receiveTxHash?: string;
  receiveChainId?: number;
  receiveBlockNumber?: number;
  failureReason?: string | null;
  createdAt?: number;
  completedAt?: number;
}

export interface RemoteReceiptRecord {
  receiptId: string;
  clientIntentId: string;
  senderAddress: string;
  senderChainId: number;
  recipientSnapshotId: string | null;
  recipientAddress: string;
  recipientChainId: number;
  amountRaw: string;
  amountDecimals: number;
  assetId: string;
  tokenAddress: string;
  providerId: string;
  routeId: string;
  quoteId: string | null;
  burnTxHash: string | null;
  burnChainId: number | null;
  burnBlockNumber: number | null;
  receiveTxHash: string | null;
  receiveChainId: number | null;
  receiveBlockNumber: number | null;
  environment: string;
  actionType: string | null;
  surface: string | null;
  planId: string | null;
  executionTxHash: string | null;
  executionBlock: number | null;
  actualAmountRaw: string | null;
  balanceBeforeRaw: string | null;
  verifiedBalanceAfter: string | null;
  riskScore: number | null;
  policyDecision: string | null;
  displaySummary: string | null;
  status: ServerReceiptStatus;
  revision: number;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
  failedAt: number | null;
  failureReason: string | null;
}

function localToServerStatus(
  receipt: VeyraReceipt,
): ServerReceiptStatus {
  switch (receipt.status) {
    case 'PENDING':
      return 'BROADCAST';
    case 'BRIDGE_PENDING':
      return 'BROADCAST';
    case 'BRIDGE_UNCONFIRMED':
      return 'RECEIVE_PENDING';
    case 'VERIFIED':
      return 'COMPLETE';
    case 'FAILED':
      return 'FAILED';
    case 'CANCELLED':
      return 'INVALIDATED';
  }
}

function serverToLocalStatus(
  actionType: string,
  status: ServerReceiptStatus,
): LocalReceiptStatus {
  if (status === 'COMPLETE') return 'VERIFIED';
  if (status === 'FAILED' || status === 'DUPLICATE_DETECTED') return 'FAILED';
  if (status === 'INVALIDATED') return 'CANCELLED';
  if (
    actionType === 'BRIDGE' &&
    (status === 'RECEIVE_PENDING' ||
      status === 'RECEIVE_FAILED_RETRYABLE')
  ) {
    return 'BRIDGE_UNCONFIRMED';
  }
  if (actionType === 'BRIDGE') return 'BRIDGE_PENDING';
  return 'PENDING';
}

export function buildReceiptSyncPayload(
  receipt: VeyraReceipt,
): ReceiptSyncPayload | null {
  const context = receipt.executionContext;
  const clientIntentId = receipt.planId;
  if (!context || !clientIntentId || !receipt.expectedAmountDelta) return null;

  const payload: ReceiptSyncPayload = {
    receiptId: receipt.receiptId,
    clientIntentId,
    localRevision: receipt.syncRevision ?? 1,
    actionType: receipt.actionType,
    surface: context.surface,
    senderAddress: context.senderAddress,
    senderChainId: receipt.chainId,
    recipientSnapshotId: context.recipientSnapshotId ?? null,
    recipientAddress: context.recipientAddress,
    recipientChainId: context.recipientChainId,
    amountRaw: receipt.expectedAmountDelta.toString(),
    amountDecimals: context.tokenDecimals,
    assetId: context.assetId,
    tokenAddress: context.tokenAddress,
    providerId: context.providerId,
    routeId: context.routeId,
    environment: context.environment,
    status: localToServerStatus(receipt),
    createdAt: receipt.createdAt,
  };

  if (context.quoteId) payload.quoteId = context.quoteId;
  if (receipt.executionTxHash) {
    payload.executionTxHash = receipt.executionTxHash;
  }
  if (receipt.executionBlock !== undefined) {
    payload.executionBlock = receipt.executionBlock;
  }
  if (receipt.actualAmountDelta !== null) {
    payload.actualAmountRaw = receipt.actualAmountDelta.toString();
  }
  if (receipt.verifiedBalanceAfter !== undefined) {
    payload.verifiedBalanceAfter = receipt.verifiedBalanceAfter.toString();
  }
  if (receipt.riskScore !== null) payload.riskScore = receipt.riskScore;
  if (receipt.policyDecision !== null) {
    payload.policyDecision = receipt.policyDecision;
  }
  if (receipt.displaySummary) payload.displaySummary = receipt.displaySummary;
  if (receipt.completedAt !== undefined) payload.completedAt = receipt.completedAt;

  if (receipt.transferTrace) {
    payload.balanceBeforeRaw = receipt.transferTrace.balanceBeforeRaw;
  }
  if (receipt.bridgeTrace) {
    payload.burnTxHash = receipt.bridgeTrace.sourceTxHash;
    payload.burnChainId = receipt.bridgeTrace.sourceChainId;
    if (receipt.bridgeTrace.sourceBlock !== undefined) {
      payload.burnBlockNumber = receipt.bridgeTrace.sourceBlock;
    }
    if (receipt.bridgeTrace.destinationTxHash) {
      payload.receiveTxHash = receipt.bridgeTrace.destinationTxHash;
    }
    payload.receiveChainId = receipt.bridgeTrace.destinationChainId;
    if (receipt.bridgeTrace.destinationBlock !== undefined) {
      payload.receiveBlockNumber = receipt.bridgeTrace.destinationBlock;
    }
  }

  return payload;
}

export async function syncActivityReceiptRemote(
  receipt: VeyraReceipt,
): Promise<RemoteReceiptRecord | null> {
  if (!hasAuth()) return null;
  const payload = buildReceiptSyncPayload(receipt);
  if (!payload) return null;

  const response = await fetch('/api/receipts/sync', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
    },
    body: JSON.stringify(payload),
  });

  if (response.status === 401) return null;

  const body = (await response.json()) as {
    ok?: boolean;
    record?: RemoteReceiptRecord;
    message?: string;
    error?: string;
  };
  if (!response.ok || !body.ok || !body.record) {
    throw new Error(
      body.message ??
        body.error ??
        `Activity receipt sync failed (${response.status})`,
    );
  }

  return body.record;
}

function isActionType(value: string | null): value is VeyraReceipt['actionType'] {
  return (
    value === 'TRANSFER' ||
    value === 'CONVERT' ||
    value === 'BRIDGE' ||
    value === 'APPROVE' ||
    value === 'SUPPLY' ||
    value === 'WITHDRAW' ||
    value === 'BORROW' ||
    value === 'REPAY'
  );
}

function isSurface(
  value: string | null,
): value is ReceiptExecutionContext['surface'] {
  return (
    value === 'PAY' ||
    value === 'AGENT' ||
    value === 'BRIDGE' ||
    value === 'SYSTEM'
  );
}

export function remoteActivityReceiptToVeyra(
  row: RemoteReceiptRecord,
): VeyraReceipt | null {
  if (
    !isActionType(row.actionType) ||
    !isSurface(row.surface) ||
    typeof row.revision !== 'number' ||
    !Number.isSafeInteger(row.revision) ||
    row.revision < 1 ||
    !/^0x[0-9a-fA-F]{40}$/.test(row.senderAddress) ||
    !/^0x[0-9a-fA-F]{40}$/.test(row.recipientAddress) ||
    !/^0x[0-9a-fA-F]{40}$/.test(row.tokenAddress) ||
    !/^(0|[1-9][0-9]*)$/.test(row.amountRaw)
  ) {
    return null;
  }

  const executionContext: ReceiptExecutionContext = {
    surface: row.surface,
    providerId: row.providerId,
    routeId: row.routeId,
    environment: row.environment === 'mainnet' ? 'mainnet' : 'testnet',
    senderAddress: row.senderAddress,
    recipientSnapshotId: row.recipientSnapshotId,
    recipientAddress: row.recipientAddress,
    recipientChainId: row.recipientChainId,
    assetId: row.assetId,
    tokenAddress: row.tokenAddress,
    tokenDecimals: row.amountDecimals,
    ...(row.quoteId ? { quoteId: row.quoteId } : {}),
  };

  const receipt: VeyraReceipt = {
    receiptId: row.receiptId,
    planId: row.planId ?? row.clientIntentId,
    actionType: row.actionType,
    status: serverToLocalStatus(row.actionType, row.status),
    syncRevision: row.revision,
    syncPending: false,
    chainId: row.senderChainId,
    ...(row.executionTxHash
      ? { executionTxHash: row.executionTxHash }
      : {}),
    ...(row.executionBlock !== null
      ? { executionBlock: row.executionBlock }
      : {}),
    createdAt: row.createdAt,
    ...(row.completedAt !== null ? { completedAt: row.completedAt } : {}),
    actualAmountDelta:
      row.actualAmountRaw !== null ? BigInt(row.actualAmountRaw) : null,
    expectedAmountDelta: BigInt(row.amountRaw),
    ...(row.verifiedBalanceAfter !== null
      ? { verifiedBalanceAfter: BigInt(row.verifiedBalanceAfter) }
      : {}),
    riskScore: row.riskScore,
    policyDecision: row.policyDecision,
    ...(row.displaySummary ? { displaySummary: row.displaySummary } : {}),
    executionContext,
  };

  if (
    row.actionType === 'TRANSFER' &&
    row.executionTxHash &&
    row.balanceBeforeRaw !== null
  ) {
    receipt.transferTrace = {
      providerId: row.providerId,
      tokenAddress: row.tokenAddress,
      tokenDecimals: row.amountDecimals,
      fromAddress: row.senderAddress,
      recipientAddress: row.recipientAddress,
      amountRaw: row.amountRaw,
      balanceBeforeRaw: row.balanceBeforeRaw,
    };
  }

  if (row.actionType === 'BRIDGE' && row.burnTxHash) {
    receipt.bridgeTrace = {
      sourceChainId: row.burnChainId ?? row.senderChainId,
      destinationChainId: row.receiveChainId ?? row.recipientChainId,
      sourceTxHash: row.burnTxHash,
      ...(row.receiveTxHash
        ? { destinationTxHash: row.receiveTxHash }
        : {}),
      ...(row.burnBlockNumber !== null
        ? { sourceBlock: row.burnBlockNumber }
        : {}),
      ...(row.receiveBlockNumber !== null
        ? { destinationBlock: row.receiveBlockNumber }
        : {}),
      bridgeStatus:
        receipt.status === 'VERIFIED'
          ? 'VERIFIED'
          : receipt.status === 'FAILED'
            ? 'FAILED'
            : receipt.status === 'BRIDGE_UNCONFIRMED'
              ? 'BRIDGE_UNCONFIRMED'
              : 'BRIDGE_PENDING',
    };
  }

  return receipt;
}

export async function loadRemoteActivityReceipts(): Promise<VeyraReceipt[]> {
  if (!hasAuth()) return [];

  const response = await fetch('/api/receipts?limit=200', {
    headers: authHeaders(),
  });
  if (response.status === 401) return [];

  const body = (await response.json()) as {
    ok?: boolean;
    receipts?: RemoteReceiptRecord[];
    error?: string;
  };
  if (!response.ok || !body.ok || !Array.isArray(body.receipts)) {
    throw new Error(
      body.error ?? `Activity receipt load failed (${response.status})`,
    );
  }

  return body.receipts
    .map(remoteActivityReceiptToVeyra)
    .filter((receipt): receipt is VeyraReceipt => receipt !== null);
}
