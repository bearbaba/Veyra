/**
 * Duplicate-send key construction.
 * Covers 9 axes (amendment 4: environment added as 9th axis).
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
  /** immutable snp_ snapshot ID — frozen recipient identity */
  recipientSnapshotId: string;
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
  // Canonical: sort keys alphabetically, stringify deterministically
  const sorted = Object.fromEntries(
    Object.entries(params).sort(([a], [b]) => a.localeCompare(b)),
  );
  return createHash('sha256')
    .update(JSON.stringify(sorted))
    .digest('hex');
}
