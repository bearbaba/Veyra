import { Clock3 } from 'lucide-react';

/**
 * The one banner Pay, Swap and Bridge use to say why signing is unavailable.
 * Wording comes from the signing-gate modules; this only draws it.
 */
export function SigningNoticeBanner({ headline, body }: { headline: string; body: string }) {
  return (
    <div role="status" className="flex items-start gap-2 rounded-xl border px-3 py-2.5 text-xs font-semibold"
      style={{ color: 'var(--warning)', borderColor: 'var(--border)', background: 'var(--surface-raised)' }}>
      <Clock3 className="mt-px size-4 shrink-0" aria-hidden="true" />
      <span>
        <span className="block">{headline}</span>
        <span className="mt-1 block font-normal leading-relaxed" style={{ color: 'var(--muted)' }}>{body}</span>
      </span>
    </div>
  );
}
