import { eq } from 'drizzle-orm';
import type { DbClient } from '../db/client.js';
import { identitySnapshots } from '../db/schema/snapshots.js';
import { receiptStatusEnum } from '../db/schema/enums.js';
import {
  getActivityReceiptsForUser,
  syncActivityReceipt,
  ReceiptSyncConflictError,
  type ActivityReceiptSyncInput,
} from '../db/repositories/receiptRepository.js';
import { findActiveWalletBinding } from '../db/repositories/walletRepository.js';

const ACTION_TYPES = new Set([
  'TRANSFER',
  'CONVERT',
  'BRIDGE',
  'APPROVE',
  'SUPPLY',
  'WITHDRAW',
  'BORROW',
  'REPAY',
]);
const SURFACES = new Set(['PAY', 'AGENT', 'BRIDGE', 'SYSTEM']);
const RECEIPT_STATUSES = new Set<string>(receiptStatusEnum.enumValues);
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/;
const UINT_RE = /^(0|[1-9][0-9]*)$/;
const RECEIPT_ID_RE = /^veyra-[A-Za-z0-9:_-]{8,200}$/;
const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class ActivityReceiptSyncError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly httpStatus = 400,
  ) {
    super(message);
    this.name = 'ActivityReceiptSyncError';
  }
}

function textField(
  body: Record<string, unknown>,
  key: string,
  max = 500,
): string {
  const value = body[key];
  if (typeof value !== 'string') {
    throw new ActivityReceiptSyncError(
      'INVALID_RECEIPT_SYNC',
      `${key} must be a string`,
    );
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) {
    throw new ActivityReceiptSyncError(
      'INVALID_RECEIPT_SYNC',
      `${key} is missing or too long`,
    );
  }
  return trimmed;
}

function optionalTextField(
  body: Record<string, unknown>,
  key: string,
  max = 2_000,
): string | undefined {
  const value = body[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    throw new ActivityReceiptSyncError(
      'INVALID_RECEIPT_SYNC',
      `${key} must be a string`,
    );
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) {
    throw new ActivityReceiptSyncError(
      'INVALID_RECEIPT_SYNC',
      `${key} is empty or too long`,
    );
  }
  return trimmed;
}

function positiveSafeInt(
  body: Record<string, unknown>,
  key: string,
): number {
  const value = body[key];
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value <= 0
  ) {
    throw new ActivityReceiptSyncError(
      'INVALID_RECEIPT_SYNC',
      `${key} must be a positive safe integer`,
    );
  }
  return value;
}

function optionalSafeInt(
  body: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = body[key];
  if (value === undefined || value === null) return undefined;
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    throw new ActivityReceiptSyncError(
      'INVALID_RECEIPT_SYNC',
      `${key} must be a non-negative safe integer`,
    );
  }
  return value;
}

function optionalNullableString(
  body: Record<string, unknown>,
  key: string,
  max = 2_000,
): string | null | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string' || value.length > max) {
    throw new ActivityReceiptSyncError(
      'INVALID_RECEIPT_SYNC',
      `${key} must be null or a bounded string`,
    );
  }
  return value;
}

function assertAddress(value: string, key: string): void {
  if (!ADDRESS_RE.test(value)) {
    throw new ActivityReceiptSyncError(
      'INVALID_RECEIPT_SYNC',
      `${key} must be a valid EVM address`,
    );
  }
}

function assertOptionalTxHash(
  value: string | undefined,
  key: string,
): void {
  if (value !== undefined && !TX_HASH_RE.test(value)) {
    throw new ActivityReceiptSyncError(
      'INVALID_RECEIPT_SYNC',
      `${key} must be a 32-byte transaction hash`,
    );
  }
}

function assertUnsignedDecimal(
  value: string | null | undefined,
  key: string,
  positive = false,
): void {
  if (value === undefined || value === null) return;
  if (!UINT_RE.test(value) || (positive && BigInt(value) <= 0n)) {
    throw new ActivityReceiptSyncError(
      'INVALID_RECEIPT_SYNC',
      `${key} must be an unsigned decimal string`,
    );
  }
}

export function parseActivityReceiptSyncBody(
  body: Record<string, unknown>,
): ActivityReceiptSyncInput {
  const receiptId = textField(body, 'receiptId', 220);
  const clientIntentId = textField(body, 'clientIntentId', 64);
  const actionType = textField(body, 'actionType', 32);
  const surface = textField(body, 'surface', 32);
  const senderAddress = textField(body, 'senderAddress', 42);
  const recipientAddress = textField(body, 'recipientAddress', 42);
  const tokenAddress = textField(body, 'tokenAddress', 42);
  const amountRaw = textField(body, 'amountRaw', 80);
  const assetId = textField(body, 'assetId', 64);
  const providerId = textField(body, 'providerId', 120);
  const routeId = textField(body, 'routeId', 300);
  const environment = textField(body, 'environment', 20);
  const status = textField(body, 'status', 40);

  if (!RECEIPT_ID_RE.test(receiptId)) {
    throw new ActivityReceiptSyncError(
      'INVALID_RECEIPT_SYNC',
      'receiptId must use the veyra- receipt namespace',
    );
  }
  if (!UUID_V4_RE.test(clientIntentId)) {
    throw new ActivityReceiptSyncError(
      'INVALID_RECEIPT_SYNC',
      'clientIntentId must be a UUID v4',
    );
  }
  if (!ACTION_TYPES.has(actionType)) {
    throw new ActivityReceiptSyncError(
      'INVALID_RECEIPT_SYNC',
      'Unsupported actionType',
    );
  }
  if (!SURFACES.has(surface)) {
    throw new ActivityReceiptSyncError(
      'INVALID_RECEIPT_SYNC',
      'Unsupported receipt surface',
    );
  }
  if (!RECEIPT_STATUSES.has(status)) {
    throw new ActivityReceiptSyncError(
      'INVALID_RECEIPT_SYNC',
      'Unsupported receipt status',
    );
  }
  if (environment !== 'testnet' && environment !== 'mainnet') {
    throw new ActivityReceiptSyncError(
      'INVALID_RECEIPT_SYNC',
      'environment must be testnet or mainnet',
    );
  }

  assertAddress(senderAddress, 'senderAddress');
  assertAddress(recipientAddress, 'recipientAddress');
  assertAddress(tokenAddress, 'tokenAddress');
  assertUnsignedDecimal(amountRaw, 'amountRaw', true);

  const localRevision = positiveSafeInt(body, 'localRevision');
  const senderChainId = positiveSafeInt(body, 'senderChainId');
  const recipientChainId = positiveSafeInt(body, 'recipientChainId');
  const amountDecimals = optionalSafeInt(body, 'amountDecimals');
  if (amountDecimals === undefined || amountDecimals > 255) {
    throw new ActivityReceiptSyncError(
      'INVALID_RECEIPT_SYNC',
      'amountDecimals must be between 0 and 255',
    );
  }

  const recipientSnapshotId =
    optionalNullableString(body, 'recipientSnapshotId', 180) ?? null;
  const executionTxHash = optionalTextField(body, 'executionTxHash', 66);
  const burnTxHash = optionalTextField(body, 'burnTxHash', 66);
  const receiveTxHash = optionalTextField(body, 'receiveTxHash', 66);
  assertOptionalTxHash(executionTxHash, 'executionTxHash');
  assertOptionalTxHash(burnTxHash, 'burnTxHash');
  assertOptionalTxHash(receiveTxHash, 'receiveTxHash');

  const actualAmountRaw = optionalNullableString(body, 'actualAmountRaw', 80);
  const balanceBeforeRaw = optionalNullableString(body, 'balanceBeforeRaw', 80);
  const verifiedBalanceAfter = optionalNullableString(
    body,
    'verifiedBalanceAfter',
    80,
  );
  assertUnsignedDecimal(actualAmountRaw, 'actualAmountRaw');
  assertUnsignedDecimal(balanceBeforeRaw, 'balanceBeforeRaw');
  assertUnsignedDecimal(verifiedBalanceAfter, 'verifiedBalanceAfter');

  const riskScoreRaw = body.riskScore;
  let riskScore: number | null | undefined;
  if (riskScoreRaw === null) riskScore = null;
  else if (riskScoreRaw !== undefined) {
    if (
      typeof riskScoreRaw !== 'number' ||
      !Number.isInteger(riskScoreRaw) ||
      riskScoreRaw < 0 ||
      riskScoreRaw > 100
    ) {
      throw new ActivityReceiptSyncError(
        'INVALID_RECEIPT_SYNC',
        'riskScore must be null or an integer from 0 to 100',
      );
    }
    riskScore = riskScoreRaw;
  }

  const input: ActivityReceiptSyncInput = {
    receiptId,
    clientIntentId,
    localRevision,
    actionType,
    surface,
    senderAddress,
    senderChainId,
    recipientSnapshotId,
    recipientAddress,
    recipientChainId,
    amountRaw,
    amountDecimals,
    assetId,
    tokenAddress,
    providerId,
    routeId,
    environment,
    status: status as ActivityReceiptSyncInput['status'],
  };

  const quoteId = optionalTextField(body, 'quoteId', 200);
  const policyDecision = optionalNullableString(body, 'policyDecision', 100);
  const displaySummary = optionalNullableString(body, 'displaySummary', 1_000);
  const failureReason = optionalNullableString(body, 'failureReason', 1_000);
  const executionBlock = optionalSafeInt(body, 'executionBlock');
  const burnChainId = optionalSafeInt(body, 'burnChainId');
  const burnBlockNumber = optionalSafeInt(body, 'burnBlockNumber');
  const receiveChainId = optionalSafeInt(body, 'receiveChainId');
  const receiveBlockNumber = optionalSafeInt(body, 'receiveBlockNumber');
  const createdAt = optionalSafeInt(body, 'createdAt');
  const completedAt = optionalSafeInt(body, 'completedAt');

  if (quoteId !== undefined) input.quoteId = quoteId;
  if (executionTxHash !== undefined) input.executionTxHash = executionTxHash;
  if (executionBlock !== undefined) input.executionBlock = executionBlock;
  if (actualAmountRaw !== undefined) input.actualAmountRaw = actualAmountRaw;
  if (balanceBeforeRaw !== undefined) input.balanceBeforeRaw = balanceBeforeRaw;
  if (verifiedBalanceAfter !== undefined) {
    input.verifiedBalanceAfter = verifiedBalanceAfter;
  }
  if (riskScore !== undefined) input.riskScore = riskScore;
  if (policyDecision !== undefined) input.policyDecision = policyDecision;
  if (displaySummary !== undefined) input.displaySummary = displaySummary;
  if (burnTxHash !== undefined) input.burnTxHash = burnTxHash;
  if (burnChainId !== undefined) input.burnChainId = burnChainId;
  if (burnBlockNumber !== undefined) input.burnBlockNumber = burnBlockNumber;
  if (receiveTxHash !== undefined) input.receiveTxHash = receiveTxHash;
  if (receiveChainId !== undefined) input.receiveChainId = receiveChainId;
  if (receiveBlockNumber !== undefined) {
    input.receiveBlockNumber = receiveBlockNumber;
  }
  if (failureReason !== undefined) input.failureReason = failureReason;
  if (createdAt !== undefined) input.createdAt = createdAt;
  if (completedAt !== undefined) input.completedAt = completedAt;

  return input;
}

async function assertSnapshotMatchesStoredRecipient(
  db: DbClient,
  input: ActivityReceiptSyncInput,
): Promise<void> {
  if (!input.recipientSnapshotId) return;

  const [snapshot] = await db
    .select({ resolvedWallets: identitySnapshots.resolvedWallets })
    .from(identitySnapshots)
    .where(eq(identitySnapshots.snapshotId, input.recipientSnapshotId))
    .limit(1);

  if (!snapshot) {
    throw new ActivityReceiptSyncError(
      'RECIPIENT_SNAPSHOT_NOT_FOUND',
      'Recipient snapshot does not exist',
      409,
    );
  }

  const wallets = Array.isArray(snapshot.resolvedWallets)
    ? (snapshot.resolvedWallets as Array<Record<string, unknown>>)
    : [];
  const matches = wallets.some(
    (wallet) =>
      wallet.chainId === input.recipientChainId &&
      typeof wallet.walletAddress === 'string' &&
      wallet.walletAddress.toLowerCase() === input.recipientAddress.toLowerCase(),
  );

  if (!matches) {
    throw new ActivityReceiptSyncError(
      'RECIPIENT_SNAPSHOT_MISMATCH',
      'Recipient address/chain does not match the frozen snapshot',
      409,
    );
  }
}

export async function syncOwnedActivityReceipt(
  db: DbClient,
  ownerUserId: string,
  input: ActivityReceiptSyncInput,
) {
  const wallet = await findActiveWalletBinding(
    db,
    ownerUserId,
    input.senderAddress,
    input.senderChainId,
  );
  if (!wallet) {
    throw new ActivityReceiptSyncError(
      'SENDER_WALLET_NOT_OWNED',
      'Sender wallet is not an active verified wallet for this Veyra user',
      403,
    );
  }

  await assertSnapshotMatchesStoredRecipient(db, input);

  try {
    return await syncActivityReceipt(db, ownerUserId, wallet.walletId, input);
  } catch (error) {
    if (error instanceof ReceiptSyncConflictError) {
      throw new ActivityReceiptSyncError(
        'RECEIPT_SYNC_CONFLICT',
        error.message,
        409,
      );
    }
    throw error;
  }
}

function dateMs(value: Date | null): number | null {
  return value ? value.getTime() : null;
}

export function serializeActivityReceipt(
  row: Awaited<ReturnType<typeof getActivityReceiptsForUser>>[number],
) {
  return {
    ...row,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
    completedAt: dateMs(row.completedAt),
    failedAt: dateMs(row.failedAt),
  };
}

export async function listOwnedActivityReceipts(
  db: DbClient,
  ownerUserId: string,
  limit = 100,
) {
  const rows = await getActivityReceiptsForUser(db, ownerUserId, limit);
  return rows.map(serializeActivityReceipt);
}
