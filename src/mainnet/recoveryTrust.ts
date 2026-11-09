/**
 * Which stored Swap/Bridge records may be shown as "Destination verified".
 *
 * The exchange component writes status VERIFIED only after it has checked the
 * destination onchain, and at that moment it also stores the proof it used:
 *   swap   -> `hash`            (the swap transaction)
 *   bridge -> `burnHash` and `mintHash` (source burn and destination mint)
 * localStorage is only a cache, though. A record that says VERIFIED but carries no
 * proof (corrupted, left by an older build, or edited) must not be shown as verified.
 * It is downgraded to PENDING: still locked against a second attempt, with the
 * existing "Verify destination onchain" recheck available (which never signs).
 *
 * Evidence is never discarded. Every field, including each transaction hash, is kept, and
 * `downgradedFrom` records that the entry was saved as verified. A missing LOCAL proof is not
 * evidence that the transfer failed, so the status is "unresolved" (PENDING), never REVERTED.
 *
 * This only ever makes a record MORE conservative; it never upgrades one.
 */
export interface StoredExchangeRecord {
  mode: 'swap' | 'bridge';
  status: 'UNKNOWN' | 'PENDING' | 'VERIFIED' | 'REVERTED';
  hash?: string;
  burnHash?: string;
  mintHash?: string;
  /** Set when a stored VERIFIED entry was found without its proof and treated as unresolved. */
  downgradedFrom?: 'VERIFIED';
}

export function hasVerificationProof(record: StoredExchangeRecord): boolean {
  return record.mode === 'swap'
    ? record.hash !== undefined
    : record.burnHash !== undefined && record.mintHash !== undefined;
}

export function withTrustedStatus<T extends StoredExchangeRecord>(record: T): T {
  return record.status === 'VERIFIED' && !hasVerificationProof(record)
    ? { ...record, status: 'PENDING', downgradedFrom: 'VERIFIED' }
    : record;
}
