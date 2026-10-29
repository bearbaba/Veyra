import type { ConvertPipelineStatus } from './convertPipeline';

/** Transport timeout after a remote trade attempt means UNKNOWN, never FAILED. */
export function convertErrorState(broadcastStarted: boolean): ConvertPipelineStatus {
  return broadcastStarted ? 'SETTLEMENT_PENDING' : 'FAILED';
}

/**
 * Signing, network submission and settlement cannot be reset by changing
 * text fields, pressing Refresh or selecting another asset. Refresh recovery
 * must read provider/chain state; it must not re-sign or re-broadcast.
 */
export function canDiscardConvertDraft(status: ConvertPipelineStatus): boolean {
  return !(
    status === 'SIGNING' ||
    status === 'BROADCASTING' ||
    status === 'VERIFYING' ||
    status === 'SETTLEMENT_PENDING'
  );
}
