import type { VeyraReceipt } from './receiptTypes';
import { getReceipt, saveReceipt } from './receiptStore';
import {
  remoteActivityReceiptToVeyra,
  syncActivityReceiptRemote,
} from '../../lib/api/activityReceiptApi';
import { reconcileVeyraReceipts } from './receiptReconciliation';

/**
 * Persist locally first, then attempt an authenticated Postgres mirror.
 *
 * Remote unavailability never blocks a verified user action. The local record
 * remains syncPending and Activity retries later.
 */
export async function saveReceiptWithRemoteSync(
  receipt: VeyraReceipt,
): Promise<VeyraReceipt> {
  const local: VeyraReceipt = {
    ...receipt,
    syncRevision: receipt.syncRevision ?? 1,
    syncPending: Boolean(receipt.executionContext),
  };

  await saveReceipt(local);
  if (!local.executionContext) return local;

  try {
    const remoteRow = await syncActivityReceiptRemote(local);
    if (!remoteRow) return local;

    const remoteReceipt = remoteActivityReceiptToVeyra(remoteRow);
    if (!remoteReceipt) return local;

    const latestLocal = (await getReceipt(local.receiptId)) ?? local;
    const merged = reconcileVeyraReceipts(latestLocal, remoteReceipt);
    const acknowledged =
      (remoteReceipt.syncRevision ?? 1) >= (latestLocal.syncRevision ?? 1) &&
      remoteReceipt.status === merged.status;

    const settled: VeyraReceipt = {
      ...merged,
      syncPending: !acknowledged,
    };
    await saveReceipt(settled);
    return settled;
  } catch {
    return local;
  }
}

export async function retryReceiptRemoteSync(
  receipt: VeyraReceipt,
): Promise<VeyraReceipt> {
  if (!receipt.executionContext) return receipt;
  return saveReceiptWithRemoteSync({
    ...receipt,
    syncPending: true,
  });
}
