import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET, POST } from '../../api/agent/chat';

const KEY = 'test-openai-key-not-real';
const TOKEN = 'veyra-preview-token-at-least-24-chars';

function configured() {
  vi.stubEnv('VEYRA_AGENT_ENABLED', '1');
  vi.stubEnv('OPENAI_API_KEY', KEY);
  vi.stubEnv('VEYRA_AGENT_BETA_TOKEN', TOKEN);
}

function request(
  text: unknown,
  bearer: string | null = TOKEN,
  history: unknown = undefined,
): Request {
  return new Request('https://veyra.example/api/agent/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(bearer === null ? {} : { Authorization: `Bearer ${bearer}` }),
    },
    body: JSON.stringify({ message: text, history }),
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('Phase 5 live Vercel agent: NO mock or canned answers', () => {
  it('is fail-closed when unconfigured and never calls the AI provider', async () => {
    vi.stubEnv('VEYRA_AGENT_ENABLED', '0');
    vi.stubEnv('OPENAI_API_KEY', '');
    vi.stubEnv('VEYRA_AGENT_BETA_TOKEN', '');
    const upstream = vi.fn();
    vi.stubGlobal('fetch', upstream);
    const status = await GET().json() as { live: boolean };
    expect(status.live).toBe(false);
    const response = await POST(request('Xin chào'));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      live: false,
      error: 'AGENT_NOT_CONFIGURED',
    });
    expect(upstream).not.toHaveBeenCalled();
  });

  it('requires an unguessable beta token and rejects Unicode length tricks', async () => {
    configured();
    for (const token of [null, '', 'wrong-token-too-short', 'é'.repeat(32)]) {
      const response = await POST(request('Hello', token));
      expect(response.status).toBe(401);
    }
  });

  it('rejects invalid data and oversized inputs without calling a provider', async () => {
    configured();
    const upstream = vi.fn();
    vi.stubGlobal('fetch', upstream);
    for (const msg of ['', 'a'.repeat(1201), 123, null]) {
      const response = await POST(request(msg));
      expect(response.status).toBe(400);
    }
    const oversized = await POST(request('x'.repeat(6000)));
    expect(oversized.status).toBe(413);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('sends a real backend-only OpenAI request with bounded history and no persistence', async () => {
    configured();
    let upstreamPayload: unknown;
    let authorization: string | null = null;
    vi.stubGlobal('fetch', vi.fn((_url: unknown, init: unknown) => {
      const opts = init as { headers: Record<string, string>; body: string };
      authorization = opts.headers.Authorization;
      upstreamPayload = JSON.parse(opts.body) as unknown;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          choices: [{ message: { content: 'Đây là trả lời thực từ OpenAI.' } }],
        }),
      });
    }));

    const history = Array.from({ length: 12 }, (_, i) => ({
      role: i % 2 ? 'assistant' as const : 'user' as const,
      text: 'Chat turn',
    }));
    const response = await POST(request('Tôi muốn gửi USDC trên Arc', TOKEN, history));
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect(await response.json()).toMatchObject({
      ok: true, live: true, provider: 'openai',
      reply: 'Đây là trả lời thực từ OpenAI.',
      executionAvailable: false,
    });
    expect(authorization).toBe(`Bearer ${KEY}`);
    const payload = upstreamPayload as {
      store: boolean; max_tokens: number;
      messages: Array<{ role: string; content: string }>;
    };
    expect(payload.store).toBe(false);
    expect(payload.max_tokens).toBe(450);
    expect(payload.messages[0]?.role).toBe('system');
    expect(payload.messages[0]?.content).toMatch(/language\s+of the user's LATEST message/);
    expect(payload.messages[0]?.content).toContain('default to English');
    expect(payload.messages[0]?.content).toContain('Do not force Vietnamese');
    expect(payload.messages.filter((m) => m.role !== 'system')).toHaveLength(7);
    expect(payload.messages[payload.messages.length - 1]?.content).toBe('Tôi muốn gửi USDC trên Arc');
  });

  it('upstream failure cannot masquerade as a successful Veyra AI response', async () => {
    configured();
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, status: 429 })));
    const response = await POST(request('Real AI?'));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      ok: false, live: false, error: 'UPSTREAM_AI_UNAVAILABLE',
    });
  });

  it('invalid provider output is rejected, never replaced by a scripted reply', async () => {
    configured();
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ choices: [] }),
    })));
    const response = await POST(request('What is CCTP?'));
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      ok: false, live: false, error: 'INVALID_AI_RESPONSE',
    });
  });
});
