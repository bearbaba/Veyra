/**
 * Wallet-scoped local Activity with read-only on-chain Pay reconciliation.
 * Changing accounts never reveals receipts cached for the previous wallet.
 * Legacy unbound receipts stay hidden, not guessed into an owner's history.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useAccount, usePublicClient } from 'wagmi';
import { loadAllReceipts, saveReceipt, RECEIPT_CHANGED_EVENT } from '@/core/receipt/receiptStore';
import type { VeyraReceipt } from '@/core/receipt/receiptTypes';
import {
  receiptBelongsToWallet,
  canReconcilePendingPay,
  reconcilePendingPayReceipt,
} from '@/core/receipt/payReceiptReconciliation';
import { MANIFEST_CONSTANTS } from '@/providers/registry/providerManifest';

export function useReceiptStore() {
  const { address } = useAccount();
  const walletKey = address?.toLowerCase() ?? null;
  const publicClient = usePublicClient({ chainId: MANIFEST_CONSTANTS.ARC_TESTNET_CHAIN_ID });
  const [receipts, setReceipts] = useState<VeyraReceipt[]>([]);
  const [loadedOwner, setLoadedOwner] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestEpoch = useRef(0);

  const load = useCallback(async () => {
    const epoch = ++requestEpoch.current;
    if (!walletKey) {
      setReceipts([]);
      setLoadedOwner(null);
      setError(null);
      setLoading(false);
      return;
    }
    try {
      const all = await loadAllReceipts();
      const owned = all.filter((receipt) => receiptBelongsToWallet(receipt, walletKey));
      let syncFailed = false;
      if (publicClient) {
        for (let i = 0; i < owned.length; i += 1) {
          const previous = owned[i];
          if (!canReconcilePendingPay(previous)) continue;
          try {
            // Read-only RPC call: never requests a signature or resubmits funds.
            const verified = await reconcilePendingPayReceipt(
              previous,
              (hash) => publicClient.getTransactionReceipt({ hash }),
            );
            if (verified !== previous) {
              owned[i] = verified;
              // A still-PENDING receipt is a fresh display hint, not a new
              // durable state. Avoid write/event/reload loops when RPC cannot
              // establish a terminal status.
              if (verified.status === 'VERIFIED' || verified.status === 'FAILED') {
                try { await saveReceipt(verified); }
                catch { syncFailed = true; }
              }
            }
          } catch {
            // RPC unavailable or transaction not indexed yet: retain PENDING.
            syncFailed = true;
          }
        }
      }
      if (epoch !== requestEpoch.current) return;
      owned.sort((a, b) => b.createdAt - a.createdAt);
      setReceipts(owned);
      setLoadedOwner(walletKey);
      setError(syncFailed
        ? 'Some payment confirmations are delayed or could not be saved locally. Keep the transaction hash; do not resend.'
        : null);
    } catch {
      if (epoch !== requestEpoch.current) return;
      // A failed IndexedDB read is not an empty transaction history.
      setReceipts([]);
      setLoadedOwner(walletKey);
      setError('Could not load local transaction history. Your blockchain transactions are unaffected. Try again.');
    } finally {
      if (epoch === requestEpoch.current) setLoading(false);
    }
  }, [walletKey, publicClient]);

  useEffect(() => {
    void load();
    // Continues checking saved Pending payments after reload/tab return.
    // No wallet call, new signature, token approval or rebroadcast.
    const interval = window.setInterval(() => { void load(); }, 15000);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void load();
    };
    document.addEventListener('visibilitychange', onVisibility);
    // Pay/Agent/Activity can all commit receipts without navigating. Refresh
    // their wallet-scoped views only after the IndexedDB transaction commits.
    const onReceiptChanged = () => { void load(); };
    window.addEventListener(RECEIPT_CHANGED_EVENT, onReceiptChanged);
    return () => {
      requestEpoch.current += 1; // invalidate results from a previous wallet
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener(RECEIPT_CHANGED_EVENT, onReceiptChanged);
    };
  }, [load]);

  return {
    receipts: loadedOwner === walletKey ? receipts : [],
    loading: loading || loadedOwner !== walletKey,
    error: loadedOwner === walletKey ? error : null,
    reload: load,
  };
}
