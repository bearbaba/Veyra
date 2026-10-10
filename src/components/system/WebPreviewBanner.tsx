import { ShieldCheck, Wifi, WifiOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import { VEYRA_ENV } from '@/lib/env';

type BffState = 'checking' | 'online' | 'offline';

export function WebPreviewBanner() {
  const [bffState, setBffState] = useState<BffState>('checking');

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 2500);

    void fetch('/api/health', { signal: controller.signal })
      .then((response) => {
        setBffState(response.ok ? 'online' : 'offline');
      })
      .catch(() => setBffState('offline'))
      .finally(() => window.clearTimeout(timer));

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, []);

  if (VEYRA_ENV === 'mainnet') return null;

  const online = bffState === 'online';
  const checking = bffState === 'checking';

  return (
    <div
      className="border-b px-4 py-2"
      style={{
        borderColor: 'var(--border)',
        background: 'rgba(124, 159, 212, 0.08)',
      }}
    >
      <div className="mx-auto flex max-w-5xl items-center gap-2 text-xs">
        <ShieldCheck className="size-3.5 shrink-0" style={{ color: 'var(--accent)' }} />
        <span className="font-semibold" style={{ color: 'var(--ink-2)' }}>
          Web Preview
        </span>
        <span className="hidden sm:inline" style={{ color: 'var(--muted)' }}>
          {VEYRA_ENV} · test funds only · mainnet execution remains locked
        </span>
        <span className="ml-auto flex items-center gap-1.5" style={{ color: online ? 'var(--success)' : 'var(--subtle)' }}>
          {online ? <Wifi className="size-3.5" /> : <WifiOff className="size-3.5" />}
          {checking ? 'Checking BFF' : online ? 'BFF online' : 'UI-only mode'}
        </span>
      </div>
    </div>
  );
}
