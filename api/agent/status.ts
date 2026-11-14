/**
 * Status for the Vercel Vite preview. Reports real runtime capability:
 * conversational AI needs a server-side key; financial execution is always locked.
 */
export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'GET') {
      return Response.json({ ok: false, error: 'Method not allowed' }, { status: 405, headers: { Allow: 'GET' } });
    }
    const hasServerAI = Boolean(process.env.OPENAI_API_KEY?.trim());
    return Response.json({
      ok: true,
      conversation: hasServerAI ? 'ONLINE' : 'FALLBACK',
      planning: 'FALLBACK',
      execution: 'LOCKED',
      provider: hasServerAI ? 'openai-server' : 'local-fallback',
      ts: Date.now(),
    }, { headers: { 'Cache-Control': 'no-store' } });
  },
};
