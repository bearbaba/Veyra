/**
 * React hook: load VeyraReceipts from IndexedDB (receiptStore).
 */

import { useState, useEffect, useCallback } from 'react';
import { loadAllReceipts } from '@/core/receipt/receiptStore';
import type { VeyraReceipt } from '@/core/receipt/receiptTypes';

export function useReceiptStore() {
  const [receipts, setReceipts] = useState<VeyraReceipt[]>([]);
  const [loading, setLoading]   = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const all = await loadAllReceipts();
      // Sort newest first
      all.sort((a, b) => b.createdAt - a.createdAt);
      setReceipts(all);
    } catch {
      setReceipts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { receipts, loading, reload: load };
}
