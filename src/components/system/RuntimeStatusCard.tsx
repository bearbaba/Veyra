import { useEffect, useState } from 'react';
import { CheckCircle2, CircleAlert, Loader2, Server } from 'lucide-react';

type Status = 'loading' | 'online' | 'degraded' | 'offline';

interface ReadinessPayload {
  ok?: boolean;
  environment?: string;
  checks?: Array<{ id?: string; ok?: boolean; detail?: string }>;
}

export function RuntimeStatusCard() {
  const [status, setStatus] = useState<Status>('loading');
  const [environment, setEnvironment] = useState<string>('unknown');
  const [summary, setSummary] = useState('Checking backend readiness...');

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 3000);

    void fetch('/api/health/readiness', { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as ReadinessPayload;
        setEnvironment(payload.environment ?? 'unknown');
        const failed = payload.checks?.filter((check) => check.ok === false).length ?? 0;
        if (payload.ok === true) {
          setStatus('online');
          setSummary('Production readiness checks are passing.');
        } else {
          setStatus('degraded');
          setSummary(`${failed} readiness gate${failed === 1 ? '' : 's'} remain closed.`);
        }
      })
      .catch(() => {
        setStatus('offline');
        setSummary('BFF is not running. The interface is still available for UI testing.');
      })
      .finally(() => window.clearTimeout(timer));

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, []);

  const icon = status === 'loading'
    ? <Loader2 className="size-4 animate-spin" />
    : status === 'online'
      ? <CheckCircle2 className="size-4" />
      : <CircleAlert className="size-4" />;

  const color = status === 'online'
    ? 'var(--success)'
    : status === 'loading'
      ? 'var(--accent)'
      : 'var(--warning)';

  return (
    <div className="rounded-2xl p-5" style={{ background: 'var(--surface-strong)', border: '1px solid var(--border)' }}>
      <div className="mb-3 flex items-center gap-2">
        <Server className="size-4" style={{ color: 'var(--accent)' }} />
        <h2 className="text-sm font-semibold uppercase tracking-wider" style={{ color: 'var(--muted)' }}>
          Runtime status
        </h2>
      </div>
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5" style={{ color }}>{icon}</span>
        <div>
          <p className="text-sm font-medium" style={{ color: 'var(--ink)' }}>
            {status === 'loading' ? 'Checking' : status === 'online' ? 'Ready' : status === 'degraded' ? 'Protected' : 'UI-only'}
          </p>
          <p className="mt-0.5 text-xs" style={{ color: 'var(--muted)' }}>{summary}</p>
          <p className="mt-2 text-xs font-mono" style={{ color: 'var(--subtle)' }}>environment: {environment}</p>
        </div>
      </div>
    </div>
  );
}
