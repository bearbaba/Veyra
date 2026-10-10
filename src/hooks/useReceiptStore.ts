/**
 * React hook: hydrate Veyra receipts from the local cache and, when an
 * authenticated session exists, reconcile them with the Postgres system of
 * record.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  loadAllReceipts,
  saveReceipt,
} from '@/core/receipt/receiptStore';
import { reconcileVeyraReceipts } from '@/core/receipt/receiptReconciliation';
import { retryReceiptRemoteSync } from '@/core/receipt/receiptSync';
import { loadRemoteActivityReceipts } from '@/lib/api/activityReceiptApi';
import type { VeyraReceipt } from '@/core/receipt/receiptTypes';

async function reconcileRemoteReceipts(
  localReceipts: VeyraReceipt[],
): Promise<void> {
  let remoteReceipts: VeyraReceipt[];
  try {
    remoteReceipts = await loadRemoteActivityReceipts();
  } catch {
    // Local IndexedDB stays usable while BFF/DB/network is unavailable.
    return;
  }

  const localById = new Map(
    localReceipts.map((receipt) => [receipt.receiptId, receipt]),
  );

  for (const remote of remoteReceipts) {
    const local = localById.get(remote.receiptId);
    const merged = local
      ? reconcileVeyraReceipts(local, remote)
      : remote;
    await saveReceipt(merged);
    localById.set(merged.receiptId, merged);
  }
}

async function retryPendingRemoteWrites(
  receipts: VeyraReceipt[],
): Promise<void> {
  const pending = receipts.filter(
    (receipt) => receipt.syncPending === true && receipt.executionContext,
  );
  if (pending.length === 0) return;

  await Promise.allSettled(
    pending.map((receipt) => retryReceiptRemoteSync(receipt)),
  );
}

export function useReceiptStore() {
  const [receipts, setReceipts] = useState<VeyraReceipt[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const local = await loadAllReceipts();

      await reconcileRemoteReceipts(local);

      // Re-read after remote hydration so retry decisions use the reconciled
      // revision/status, not a stale pre-hydration snapshot.
      const reconciled = await loadAllReceipts();
      await retryPendingRemoteWrites(reconciled);

      const finalReceipts = await loadAllReceipts();
      finalReceipts.sort((a, b) => b.createdAt - a.createdAt);
      setReceipts(finalReceipts);
    } catch {
      try {
        const local = await loadAllReceipts();
        local.sort((a, b) => b.createdAt - a.createdAt);
        setReceipts(local);
      } catch {
        setReceipts([]);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { receipts, loading, reload: load };
}
