import type { TxStage } from '@/components/ui/primitives';

/**
 * Where a Swap or Bridge is in the shared lifecycle
 * (Enter details -> Review -> Confirm in wallet -> Processing -> Verified).
 *
 * Display only. "Verified" can come from exactly one place: a recovery record whose
 * status is VERIFIED, which the exchange component only sets after it has checked the
 * destination asset onchain. An unresolved record (UNKNOWN or PENDING, or storage we
 * cannot read) is Processing and flagged, so the screen says "do not submit again".
 */
export type RecoveryStatus = 'UNKNOWN' | 'PENDING' | 'VERIFIED' | 'REVERTED';

export interface ExchangeStageInput {
  /** A live (unexpired) provider quote is being shown. */
  hasLiveQuote: boolean;
  /** A request is in flight (getting a quote, or the wallet step after Confirm). */
  busy: boolean;
  recoveryStatus: RecoveryStatus | null;
  unknownStorage: boolean;
}

export function exchangeStageView(input: ExchangeStageInput): { stage: TxStage; stalled: boolean } | null {
  if (input.recoveryStatus === 'VERIFIED') return { stage: 'Verified', stalled: false };
  if (input.recoveryStatus === 'UNKNOWN' || input.recoveryStatus === 'PENDING' || input.unknownStorage) {
    return { stage: 'Processing', stalled: true };
  }
  if (input.recoveryStatus === 'REVERTED') return null;      // a failure has its own message; no progress bar
  if (input.hasLiveQuote) return { stage: input.busy ? 'Confirm in wallet' : 'Review', stalled: false };
  return { stage: 'Enter details', stalled: false };
}
