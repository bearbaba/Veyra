import { useMemo, useRef, useState } from 'react';
import {
  ArrowUpRight, ChevronDown, ChevronUp, CircleDollarSign, Compass,
  ExternalLink, Loader2, Search, ShieldCheck, Wallet,
} from 'lucide-react';
import {
  CIRCLE_DISCOVERY_CATEGORIES,
  previewServiceSpend,
  type CircleServicePreview,
} from '@/core/agent/circleServiceDiscovery';

const CATEGORY_LABELS: Record<string, string> = {
  SOCIAL_INTELLIGENCE: 'Social intelligence',
  FINANCIAL_ANALYSIS: 'Financial analysis',
  WEB_SEARCH_RESEARCH: 'Web & research',
  PREDICTION_MARKETS: 'Prediction markets',
  CREATIVE: 'Creative',
  INFRASTRUCTURE: 'Infrastructure',
};

interface CircleSearchResponse {
  ok: boolean;
  mode?: string;
  services?: CircleServicePreview[];
  error?: string;
  asOf?: string;
}

/**
 * Circle Agent Economy: marketplace discovery + local budget exploration.
 * No endpoint in this component funds wallets, pays sellers, or triggers x402.
 * Provider data is presented as a listing, never as a Veyra-executable quote.
 */
export function CircleAgentEconomyPanel() {
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [services, setServices] = useState<CircleServicePreview[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [calls, setCalls] = useState('1');
  const [budget, setBudget] = useState('0.10');
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [asOf, setAsOf] = useState<string | null>(null);
  const requestNumber = useRef(0);

  const selected = useMemo(() => services.find((service) => service.id === selectedId), [services, selectedId]);
  const spendPreview = selected ? previewServiceSpend(selected.amountAtomic, calls, budget) : null;

  async function findServices() {
    const request = ++requestNumber.current;
    setLoading(true);
    setSearched(true);
    setError(null);
    setSelectedId(null);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 9000);
    const params = new URLSearchParams();
    if (query.trim()) params.set('q', query.trim().slice(0, 100));
    if (category) params.set('category', category);
    if (maxPrice.trim()) params.set('maxUsdPrice', maxPrice.trim());

    try {
      const response = await fetch('/api/agent/services?' + params.toString(), {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      const raw: unknown = await response.json();
      const data: Partial<CircleSearchResponse> | null = raw && typeof raw === 'object' && !Array.isArray(raw)
        ? raw as Partial<CircleSearchResponse>
        : null;
      if (!response.ok || data?.ok !== true || data.mode !== 'DISCOVERY_ONLY' || !Array.isArray(data.services)) {
        throw new Error(data?.error || 'Service discovery is unavailable.');
      }
      if (request !== requestNumber.current) return;
      setServices(data.services.slice(0, 18));
      setAsOf(typeof data.asOf === 'string' ? data.asOf : null);
    } catch {
      if (request !== requestNumber.current) return;
      setServices([]);
      setAsOf(null);
      setError('Live discovery is unavailable. Please retry when the Veyra server and Circle API are reachable.');
    } finally {
      window.clearTimeout(timeout);
      if (request === requestNumber.current) setLoading(false);
    }
  }

  return (
    <section className="mt-4 overflow-hidden rounded-2xl" style={{ border: '1px solid var(--border-strong)', background: 'var(--surface)' }} aria-label="Agent economy discovery">
      <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div className="flex min-w-0 gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl" style={{ background: 'var(--accent-muted)', color: 'var(--accent)' }}>
            <Compass className="size-5" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-black uppercase tracking-[0.15em]" style={{ color: 'var(--accent)' }}>Agent economy</span>
              <span className="rounded-md px-2 py-0.5 text-[10px] font-bold" style={{ border: '1px solid var(--border)', color: 'var(--muted)' }}>Read-only preview</span>
            </div>
            <div className="mt-1 text-sm font-bold" style={{ color: 'var(--ink)' }}>Discover USDC-paid services. Plan before spending.</div>
            <p className="mt-1 text-xs leading-5" style={{ color: 'var(--muted)' }}>Powered by Circle's public x402 catalog. No wallet connection, approval or payment is made here.</p>
          </div>
        </div>
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
          className="flex shrink-0 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold transition-opacity hover:opacity-85"
          style={{ background: 'var(--accent-muted)', color: 'var(--accent)', border: '1px solid var(--border-strong)' }}
        >
          {expanded ? 'Close explorer' : 'Explore services'}
          {expanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
        </button>
      </div>
      {expanded && (
        <div className="border-t px-4 pb-5 pt-4 sm:px-5" style={{ borderColor: 'var(--border)' }}>
          <form className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_170px_120px_auto]" onSubmit={(event) => { event.preventDefault(); void findServices(); }}>
            <label className="flex min-w-0 items-center gap-2 rounded-xl px-3" style={{ background: 'var(--surface-strong)', border: '1px solid var(--border)' }}>
              <Search className="size-4 shrink-0" style={{ color: 'var(--muted)' }} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} maxLength={100} placeholder="Search APIs or services" className="min-w-0 flex-1 bg-transparent py-3 text-xs outline-none" style={{ color: 'var(--ink)' }} aria-label="Search services" />
            </label>
            <select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Service category" className="min-w-0 rounded-xl px-3 py-3 text-xs outline-none" style={{ background: 'var(--surface-strong)', border: '1px solid var(--border)', color: 'var(--ink)' }}>
              <option value="">All categories</option>
              {CIRCLE_DISCOVERY_CATEGORIES.map((value) => <option key={value} value={value}>{CATEGORY_LABELS[value]}</option>)}
            </select>
            <input value={maxPrice} onChange={(event) => setMaxPrice(event.target.value)} placeholder="Max $/call" maxLength={12} inputMode="decimal" aria-label="Maximum USDC per call" className="min-w-0 rounded-xl px-3 py-3 text-xs outline-none" style={{ background: 'var(--surface-strong)', border: '1px solid var(--border)', color: 'var(--ink)' }} />
            <button type="submit" disabled={loading} className="flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-xs font-bold disabled:opacity-50" style={{ background: 'var(--accent)', color: 'var(--bg)' }}>
              {loading ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />} Find
            </button>
          </form>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px]" style={{ color: 'var(--muted)' }}>
            <span>{loading ? 'Checking Circle’s live catalog…' : searched && !error ? services.length + ' matching services shown' : 'Explore live listings without funding a wallet'}</span>
            <a href="https://agents.circle.com/services" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold" style={{ color: 'var(--accent)' }}>Circle marketplace <ArrowUpRight className="size-3" /></a>
          </div>
          {error && <div role="alert" className="mt-3 rounded-xl px-3 py-3 text-xs" style={{ color: 'var(--warning)', border: '1px solid var(--border)' }}>{error}</div>}
          {!loading && searched && !error && services.length === 0 && (
            <div className="mt-3 rounded-xl px-4 py-6 text-center text-xs" style={{ color: 'var(--muted)', border: '1px dashed var(--border)' }}>
              No listings matched the filters in this response. Try a broader search.
            </div>
          )}
          {services.length > 0 && (
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {services.map((service) => {
                const active = service.id === selectedId;
                return (
                  <button
                    type="button"
                    key={service.id}
                    onClick={() => { setSelectedId(service.id); setCalls('1'); }}
                    className="min-w-0 rounded-xl p-3 text-left transition-colors"
                    style={{ background: active ? 'var(--accent-muted)' : 'var(--surface-strong)', border: active ? '1px solid var(--accent)' : '1px solid var(--border)' }}
                    aria-pressed={active}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--subtle)' }}>{service.provider}</div>
                        <div className="mt-1 line-clamp-2 text-xs font-bold" style={{ color: 'var(--ink)' }}>{service.title}</div>
                      </div>
                      <span className="shrink-0 text-xs font-black" style={{ color: service.priceUsdc ? 'var(--accent)' : 'var(--muted)' }}>
                        {service.priceUsdc ? service.priceUsdc + ' USDC' : 'Quote unknown'}
                      </span>
                    </div>
                    <p className="mt-2 line-clamp-2 text-[11px] leading-5" style={{ color: 'var(--muted)' }}>{service.description}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5 text-[10px]" style={{ color: 'var(--subtle)' }}>
                      <span className="rounded-md px-1.5 py-1" style={{ border: '1px solid var(--border)' }}>{CATEGORY_LABELS[service.category] || service.category}</span>
                      <span className="rounded-md px-1.5 py-1" style={{ border: '1px solid var(--border)' }}>{service.network}</span>
                      {service.gateway && <span className="rounded-md px-1.5 py-1" style={{ border: '1px solid var(--border)' }}>Gateway</span>}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
          {selected && spendPreview && (
            <div className="mt-4 rounded-2xl p-4" style={{ background: 'var(--surface-strong)', border: '1px solid var(--border-strong)' }}>
              <div className="flex items-center gap-2">
                <CircleDollarSign className="size-4" style={{ color: 'var(--accent)' }} />
                <h3 className="text-xs font-bold" style={{ color: 'var(--ink)' }}>Draft cost check: {selected.provider}</h3>
              </div>
              <p className="mt-1 text-[11px]" style={{ color: 'var(--muted)' }}>Informational estimate only. This does not set a spending limit or authorize a payment.</p>
              <div className="mt-3 flex flex-wrap items-end gap-3">
                <label className="flex flex-col gap-1.5 text-[11px]" style={{ color: 'var(--muted)' }}>Calls (1–100)
                  <input value={calls} onChange={(event) => setCalls(event.target.value)} inputMode="numeric" className="w-28 rounded-lg px-3 py-2 text-xs outline-none" style={{ border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--ink)' }} />
                </label>
                <label className="flex flex-col gap-1.5 text-[11px]" style={{ color: 'var(--muted)' }}>Draft budget (USDC)
                  <input value={budget} onChange={(event) => setBudget(event.target.value)} inputMode="decimal" className="w-36 rounded-lg px-3 py-2 text-xs outline-none" style={{ border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--ink)' }} />
                </label>
                <div className="flex-1 pb-1 text-xs font-semibold" style={{ color: spendPreview.status === 'WITHIN_DRAFT_BUDGET' ? 'var(--success)' : 'var(--warning)' }}>
                  {spendPreview.status === 'WITHIN_DRAFT_BUDGET' && 'Within draft budget'}
                  {spendPreview.status === 'OVER_DRAFT_BUDGET' && 'Exceeds draft budget'}
                  {spendPreview.status === 'UNKNOWN_PRICE' && 'Cannot verify price for this asset/network'}
                  {spendPreview.status === 'INVALID_INPUT' && 'Enter valid call count and budget'}
                  {spendPreview.totalUsdc && <span className="ml-2" style={{ color: 'var(--ink)' }}>Total: {spendPreview.totalUsdc} USDC</span>}
                </div>
              </div>
              <div className="mt-3 flex items-start gap-2 text-[11px] leading-5" style={{ color: 'var(--muted)' }}>
                <ShieldCheck className="mt-0.5 size-4 shrink-0" style={{ color: 'var(--accent)' }} />
                Price and merchant terms must be rechecked before a future payment. Auto-pay, wallet provisioning and x402 execution remain disabled in Veyra.
              </div>
            </div>
          )}
          <div className="mt-4 flex flex-col gap-2 rounded-xl p-3 sm:flex-row sm:items-center sm:justify-between" style={{ border: '1px solid var(--border)' }}>
            <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--ink-2)' }}>
              <Wallet className="size-4" style={{ color: 'var(--accent)' }} />
              Agent wallets and mainnet spending policies are not activated in this preview.
            </div>
            <div className="flex flex-wrap gap-3 text-[11px] font-semibold" style={{ color: 'var(--accent)' }}>
              <a className="inline-flex items-center gap-1" target="_blank" rel="noopener noreferrer" href="https://github.com/circlefin/skills">Circle Skills <ExternalLink className="size-3" /></a>
              <a className="inline-flex items-center gap-1" target="_blank" rel="noopener noreferrer" href="https://agents.circle.com/skills/setup.md">Wallet setup guide <ExternalLink className="size-3" /></a>
            </div>
          </div>
          {asOf && !error && <p className="mt-2 text-[10px]" style={{ color: 'var(--subtle)' }}>Catalog response: {new Date(asOf).toLocaleString()} · Listings may change.</p>}
        </div>
      )}
    </section>
  );
}
