import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AtSign, CheckCircle2, Loader2, ShieldCheck, X } from 'lucide-react';
import { useAccount, useSignTypedData } from 'wagmi';
import { beginVeyraIdRegistration, completeVeyraIdRegistration, type MyProfile } from '@/lib/api/identityApi';
import { savePreviewVeyraIdentity } from '@/hooks/useVeyraIdentity';
import { VEYRA_ENV } from '@/lib/env';

interface CreateVeyraIdModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: (profile: MyProfile, preview: boolean) => void;
}

export function CreateVeyraIdModal({ open, onClose, onCreated }: CreateVeyraIdModalProps) {
  const { address, chainId, isConnected } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const [handle, setHandle] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const normalized = useMemo(() => handle.replace(/^@/, '').trim().toLowerCase(), [handle]);
  const handleValid = /^[a-z0-9](?:[a-z0-9_]{1,28}[a-z0-9])?$/.test(normalized) && !normalized.includes('__');
  const canCreate = isConnected && Boolean(address) && Boolean(chainId) && handleValid && !loading;

  async function createRealIdentity() {
    if (!canCreate || !address || !chainId) return;
    setLoading(true);
    setError(null);
    try {
      const challenge = await beginVeyraIdRegistration({ handle: normalized, walletAddress: address, chainId });
      // The challenge travels over JSON, so uint256 fields arrive as safe
      // integers. wagmi/viem requires uint256 message values as bigint.
      const signableTypedData = {
        ...challenge.typedData,
        message: {
          ...challenge.typedData.message,
          chainId: BigInt(challenge.typedData.message.chainId),
          issuedAt: BigInt(challenge.typedData.message.issuedAt),
          expiresAt: BigInt(challenge.typedData.message.expiresAt),
        },
      };
      const signature = await signTypedDataAsync(signableTypedData);
      const completed = await completeVeyraIdRegistration({ claimToken: challenge.claimToken, signature });
      onCreated(completed.profile, false);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create Veyra ID');
    } finally {
      setLoading(false);
    }
  }

  function createPreviewIdentity() {
    if (!handleValid) return;
    const profile = savePreviewVeyraIdentity(normalized);
    onCreated(profile, true);
    onClose();
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[120] flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          style={{ background: 'rgba(4,10,20,0.72)', backdropFilter: 'blur(14px)' }}
          onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
        >
          <motion.div
            initial={{ opacity: 0, y: 18, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            className="w-full max-w-md rounded-3xl p-5 shadow-2xl"
            style={{ background: 'linear-gradient(180deg, rgba(25,43,68,0.98), rgba(14,28,47,0.99))', border: '1px solid var(--border-strong)' }}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em]" style={{ color: 'var(--accent)' }}>
                  <ShieldCheck className="size-4" /> Veyra Identity
                </div>
                <h2 className="display mt-2 text-2xl font-bold" style={{ color: 'var(--ink)' }}>Create your Veyra ID</h2>
                <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>
                  One human-readable identity for your verified wallets and linked accounts.
                </p>
              </div>
              <button onClick={onClose} className="rounded-xl p-2 hover:bg-white/5" style={{ color: 'var(--muted)' }} aria-label="Close">
                <X className="size-4" />
              </button>
            </div>

            <div className="mt-5 rounded-2xl p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--muted)' }}>Your handle</label>
              <div className="mt-2 flex items-center gap-2">
                <AtSign className="size-5 shrink-0" style={{ color: 'var(--accent)' }} />
                <input
                  value={handle}
                  onChange={(event) => setHandle(event.target.value.replace(/\s/g, ''))}
                  placeholder="bear"
                  maxLength={31}
                  className="min-w-0 flex-1 bg-transparent text-lg font-semibold outline-none"
                  style={{ color: 'var(--ink)' }}
                  autoFocus
                />
              </div>
              <div className="mt-2 flex items-center justify-between gap-3 text-xs">
                <span style={{ color: handle && !handleValid ? 'var(--danger)' : 'var(--subtle)' }}>
                  3–30 chars · a-z · 0-9 · underscore
                </span>
                {handleValid && <span className="flex items-center gap-1" style={{ color: 'var(--success)' }}><CheckCircle2 className="size-3.5" /> @{normalized}</span>}
              </div>
            </div>

            {!isConnected && (
              <div className="mt-3 rounded-xl px-3 py-2.5 text-sm" style={{ background: 'var(--warning-muted)', color: 'var(--warning)', border: '1px solid var(--border)' }}>
                Connect a wallet first. The wallet signature proves ownership of the new Veyra ID.
              </div>
            )}

            {error && (
              <div className="mt-3 rounded-xl px-3 py-2.5 text-sm" style={{ background: 'var(--danger-muted)', color: 'var(--danger)', border: '1px solid var(--border)' }}>
                {error}
              </div>
            )}

            <button
              onClick={() => void createRealIdentity()}
              disabled={!canCreate}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-bold transition-all disabled:cursor-not-allowed disabled:opacity-40"
              style={{ background: 'linear-gradient(135deg, #c8ff65, #91e9b5)', color: '#0b1b25' }}
            >
              {loading ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
              {loading ? 'Creating identity…' : 'Sign & create Veyra ID'}
            </button>

            {VEYRA_ENV === 'local' && (
              <button
                onClick={createPreviewIdentity}
                disabled={!handleValid || loading}
                className="mt-2 w-full rounded-2xl py-3 text-sm font-semibold disabled:opacity-40"
                style={{ color: 'var(--muted)', border: '1px solid var(--border)', background: 'var(--surface)' }}
              >
                Create local preview ID
              </button>
            )}

            <p className="mt-3 text-center text-[11px] leading-relaxed" style={{ color: 'var(--subtle)' }}>
              Creating a real ID requires the Veyra BFF + Postgres. Local preview IDs are UI-only and never reserve a production handle.
            </p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
