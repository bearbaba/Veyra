import { ShieldCheck, Wifi, WifiOff, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { IS_UI_ONLY_PREVIEW, VEYRA_ENV } from '@/lib/env';

type BffState = 'checking' | 'online' | 'unavailable';

/** Render Free may cold-start; a 2.5-second timeout must not claim the
 * whole unified dApp is a UI-only build. Only actual JSON {ok:true} from
 * the BFF health route is considered online; an HTML Vercel protection
 * response is never a successful API health check.
 */
export function WebPreviewBanner() {
  const [bffState, setBffState] = useState<BffState>('checking');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (IS_UI_ONLY_PREVIEW) return;
    let closed = false;
    let next: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    const started = Date.now();
    setBffState('checking');

    async function probe(): Promise<void> {
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), 10000);
      try {
        const response = await fetch('/api/health', {
          cache: 'no-store',
          headers: { Accept: 'application/json' },
          signal: controller.signal,
        });
        const type = response.headers.get('content-type') ?? '';
        const body = response.ok && type.includes('application/json')
          ? await response.json() as {ok?: boolean}
          : null;
        if (!closed && response.ok && body?.ok === true) {
          setBffState('online');
          return;
        }
      } catch {
        // BFF down, protected session, or cold start: never claim ready.
      } finally {
        clearTimeout(timeout);
      }
      if (closed) return;
      if (Date.now() - started >= 90000) {
        setBffState('unavailable');
        return;
      }
      next = setTimeout(() => { void probe(); }, 4000);
    }

    void probe();
    return () => {
      closed = true;
      clearTimeout(next);
      controller?.abort();
    };
  }, [retry]);

  if (VEYRA_ENV === 'mainnet' && !IS_UI_ONLY_PREVIEW) return null;
  const online = bffState === 'online';
  const checking = bffState === 'checking';

  return (
    <div className="border-b px-4 py-2" style={{
      borderColor: 'var(--border)', background: 'rgba(124, 159, 212, 0.08)',
    }}>
      <div className="mx-auto flex max-w-5xl items-center gap-2 text-xs">
        <ShieldCheck className="size-3.5 shrink-0" style={{ color: 'var(--accent)' }} />
        <span className="font-semibold" style={{ color: 'var(--ink-2)' }}>
          {IS_UI_ONLY_PREVIEW ? 'Vercel UI Preview · Signing disabled' : 'Veyra Testnet'}
        </span>
        <span className="hidden sm:inline" style={{ color: 'var(--muted)' }}>
          {IS_UI_ONLY_PREVIEW
            ? 'Explore the product · no payment, bridge or recovery signatures'
            : `${VEYRA_ENV} · test funds only · mainnet execution remains locked`}
        </span>
        <span role="status" className="ml-auto flex items-center gap-1.5" style={{ color: online ? 'var(--success)' : 'var(--subtle)' }}>
          {online ? <Wifi className="size-3.5" /> : <WifiOff className="size-3.5" />}
          {IS_UI_ONLY_PREVIEW ? 'Execution locked' : checking ? 'Connecting backend…' : online ? 'Backend online' : 'Backend unavailable'}
        </span>
        {!IS_UI_ONLY_PREVIEW && bffState === 'unavailable' && (
          <button type="button" onClick={() => setRetry(value => value + 1)}
            className="flex items-center gap-1 underline" style={{ color: 'var(--accent)' }}>
            <RefreshCw className="size-3.5" /> Retry
          </button>
        )}
      </div>
    </div>
  );
}
