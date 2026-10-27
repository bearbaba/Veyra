import type { ActivityReceiptRemoteRecord } from '../../lib/api/activityReceiptApi';

type BridgeRecord = Pick<ActivityReceiptRemoteRecord,
  'providerId' | 'status' | 'burnTxHash' | 'failureReason'
>;

/**
 * A successful source burn is not a successful CCTP receive.
 * Do not permit another fresh burn when a confirmed or uncertain source
 * submission for this wallet is still awaiting canonical resolution.
 */
export function bridgeReceiptHasUnresolvedSource(record: BridgeRecord): boolean {
  if (record.providerId !== 'cctp-v2-bridge') return false;
  if (record.status === 'COMPLETE' || record.status === 'CANCELLED') return false;
  if (record.status === 'FAILED' &&
      record.failureReason === 'SOURCE_TRANSACTION_REVERTED_VERIFIED') return false;
  return Boolean(record.burnTxHash) ||
    record.status === 'SIGNED' || record.status === 'BROADCAST' ||
    record.status === 'SOURCE_CONFIRMED' || record.status === 'ATTESTATION_PENDING' ||
    record.status === 'RECEIVE_PENDING' || record.status === 'RECEIVE_FAILED_RETRYABLE' ||
    record.status === 'CONFIRMING' || record.status === 'CONFIRMED';
}

export function bridgeReceiptDisplayStatus(
  status: ActivityReceiptRemoteRecord['status'],
): {label: string; terminal: boolean; success: boolean} {
  if (status === 'COMPLETE') return {
    label: 'Destination verified', terminal: true, success: true,
  };
  if (status === 'RECEIVE_PENDING' || status === 'CONFIRMED')
    return {label:'Destination verification pending',terminal:false,success:false};
  if (status === 'RECEIVE_FAILED_RETRYABLE')
    return {label:'Receive needs verification',terminal:false,success:false};
  if (status === 'ATTESTATION_PENDING' || status === 'SOURCE_CONFIRMED')
    return {label:'Source confirmed · waiting for destination',terminal:false,success:false};
  if (status === 'FAILED')
    return {label:'Failed · inspect existing transaction',terminal:true,success:false};
  return {label:'Bridge in progress · check Activity',terminal:false,success:false};
}
