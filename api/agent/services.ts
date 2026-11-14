/**
 * Vercel Function for the Vite deployment. Same-origin, read-only API only.
 * This does not expose Veyra's private Express BFF or any finance credentials.
 */
import { loadCircleServices, validateCircleFilters } from '../../src/core/agent/circleDiscoveryEndpoint.js';

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'GET') {
      return Response.json({ ok: false, error: 'Method not allowed' }, { status: 405, headers: { Allow: 'GET' } });
    }
    const url = new URL(request.url);
    const filters = validateCircleFilters(
      url.searchParams.get('q'),
      url.searchParams.get('category'),
      url.searchParams.get('maxUsdPrice'),
    );
    if (!filters) return Response.json({ ok: false, error: 'Invalid discovery filter' }, { status: 400 });
    try {
      const data = await loadCircleServices(filters);
      return Response.json(data, {
        headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=30' },
      });
    } catch (error) {
      console.error('[Vercel] Circle discovery failed:', error);
      return Response.json({
        ok: false,
        mode: 'DISCOVERY_ONLY',
        error: 'Marketplace discovery is temporarily unavailable. No payment was attempted.',
      }, { status: 503 });
    }
  },
};
