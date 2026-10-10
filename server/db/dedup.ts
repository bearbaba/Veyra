/**
 * Duplicate-send key construction.
 * Covers 9 canonical axes. Recipient identity uses a frozen snapshot ID or a direct-address fallback.
 * clientIntentId must be server-issued crypto.randomUUID() (amendment 5).
 *
 * The key is a SHA-256 hex digest of the canonical sorted JSON of all 9 fields.
 * Stored in activity_receipts.dedup_key with a UNIQUE constraint.
 * A second INSERT with the same key is rejected at the DB level.
 */
import { createHash } from 'crypto';

export interface DedupParams {
  /** 'testnet' | 'mainnet' — prevents cross-environment collisions (amendment 4) */
  environment:         string;
  /** lowercase hex sender address */
  senderAddress:       string;
  /** immutable snp_ snapshot ID when the recipient is a Veyra identity */
  recipientSnapshotId?: string | null;
  /** direct EVM recipient fallback when no identity snapshot exists */
  recipientAddress?: string;
  /** amount in smallest unit, as decimal string */
  amountRaw:           string;
  /** e.g. 'usdc' */
  assetId:             string;
  sourceChainId:       number;
  destinationChainId:  number;
  /** e.g. 'cctp-v2-bridge' */
  providerId:          string;
  /** server-issued crypto.randomUUID() — never timestamp-derived (amendment 5) */
  clientIntentId:      string;
}

export function buildDedupKey(params: DedupParams): string {
  const snapshotId = params.recipientSnapshotId?.trim() || null;
  const recipientAddress = params.recipientAddress?.trim().toLowerCase() || null;
  if (!snapshotId && !recipientAddress) {
    throw new Error(
      '[dedup] recipientSnapshotId or recipientAddress is required.',
    );
  }

  const canonical = {
    environment: params.environment,
    senderAddress: params.senderAddress.trim().toLowerCase(),
    recipientKey: snapshotId ?? `wallet:${recipientAddress}`,
    amountRaw: params.amountRaw,
    assetId: params.assetId.trim().toLowerCase(),
    sourceChainId: params.sourceChainId,
    destinationChainId: params.destinationChainId,
    providerId: params.providerId.trim().toLowerCase(),
    clientIntentId: params.clientIntentId,
  };

  const sorted = Object.fromEntries(
    Object.entries(canonical).sort(([a], [b]) => a.localeCompare(b)),
  );
  return createHash('sha256')
    .update(JSON.stringify(sorted))
    .digest('hex');
}
