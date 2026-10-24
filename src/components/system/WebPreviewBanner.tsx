import { ShieldCheck, Wifi, WifiOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import { IS_UI_ONLY_PREVIEW, VEYRA_ENV } from '@/lib/env';
import {useUnifiedSocial} from '../../features/social/UnifiedSocial';

type BffState = 'checking' | 'online' | 'offline';

export function WebPreviewBanner() {
  const [bffState, setBffState] = useState<BffState>('checking');
  const social=useUnifiedSocial();

  useEffect(() => {
    if (IS_UI_ONLY_PREVIEW) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 2500);

    void fetch('/api/health', { signal: controller.signal, cache: 'no-store' })
      .then(async response => {
        const type=response.headers.get('content-type') ?? '';
        if(!response.ok || !type.toLowerCase().includes('application/json')){
          setBffState('offline');return;
        }
        const payload:unknown=await response.json();
        const healthy=typeof payload==='object' && payload!==null &&
          'ok' in payload && payload.ok === true;
        setBffState(healthy?'online':'offline');
      })
      .catch(() => setBffState('offline'))
      .finally(() => window.clearTimeout(timer));

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, []);

  if (VEYRA_ENV === 'mainnet' && !IS_UI_ONLY_PREVIEW) return null;

  const online = bffState === 'online';
  const checking = bffState === 'checking';
  const originBlocked = social.identityOrigin === 'origin_blocked';
  const signInReady = online && social.identityOrigin === 'ready';

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
          {IS_UI_ONLY_PREVIEW ? 'Vercel UI Preview · Signing disabled' : 'Web Preview'}
        </span>
        <span className="hidden sm:inline" style={{ color: 'var(--muted)' }}>
          {IS_UI_ONLY_PREVIEW
            ? 'Explore the product · no payment, bridge or recovery signatures'
            : `${VEYRA_ENV} · test funds only · mainnet execution remains locked`}
        </span>
        <span className="ml-auto flex items-center gap-1.5" style={{ color: originBlocked ? 'var(--warning)' : signInReady ? 'var(--success)' : 'var(--subtle)' }}>
          {signInReady ? <Wifi className="size-3.5" /> : <WifiOff className="size-3.5" />}
          {IS_UI_ONLY_PREVIEW ? 'Execution locked'
            : originBlocked ? 'Veyra ID blocked on this Preview'
            : checking || social.identityOrigin === 'checking' ? 'Checking service'
            : signInReady ? 'BFF and ID origin ready'
            : 'Identity service unavailable'}
        </span>
      </div>
    </div>
  );
}
