import { afterEach, describe, expect, it, vi } from 'vitest';
import statusHandler from '../../api/agent/status.js';
import chatHandler from '../../api/agent/chat.js';

const wallet = '0xD6b8A3A5eB329410D9504784812b8569afA8C2aF';

function chat(message: string, history: unknown = []) {
  return new Request('https://veyra.example/api/agent/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, history }),
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('Vercel Agent runtime is honest and non-executing', () => {
  it('reports local fallback when no server AI key is configured', async () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    const response = await statusHandler.fetch(new Request('https://veyra.example/api/agent/status'));
    const raw: unknown = await response.json();
    expect(response.status).toBe(200);
    expect(raw).toMatchObject({
      conversation: 'FALLBACK', planning: 'FALLBACK', execution: 'LOCKED', provider: 'local-fallback',
    });
  });

  it('does not produce a transfer from a bare EVM address', async () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    const response = await chatHandler.fetch(chat(wallet));
    const raw: unknown = await response.json();
    expect(response.status).toBe(200);
    expect(raw).toMatchObject({
      mode: 'CHAT', capabilities: { execution: 'LOCKED' },
    });
    expect((raw as Record<string, unknown>).intent).toBeUndefined();
  });

  it('returns a safe clarification for a zero amount', async () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    const response = await chatHandler.fetch(chat('Send 0 USDC to ' + wallet));
    const raw: unknown = await response.json();
    expect(raw).toMatchObject({ mode: 'CLARIFICATION' });
    const intent = (raw as Record<string, unknown>).intent as Record<string, unknown>;
    expect(intent?.status).toBe('NEEDS_CLARIFICATION');
  });

  it('can continue a prior explicit payment without inventing amounts', async () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    const response = await chatHandler.fetch(chat(wallet, [
      { role: 'user', text: 'Send 20 USDC' },
      { role: 'agent', text: 'Who should receive it?' },
    ]));
    const raw: unknown = await response.json();
    expect(raw).toMatchObject({ mode: 'ACTION', capabilities: { execution: 'LOCKED' } });
    const intent = (raw as Record<string, unknown>).intent as Record<string, unknown>;
    const candidates = intent.candidates as Array<Record<string, unknown>>;
    expect(candidates[0]?.amountRaw).toMatchObject({ raw: '20' });
  });

  it('rejects invalid input and methods without model calls', async () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    expect((await chatHandler.fetch(new Request('https://veyra.example/api/agent/chat'))).status).toBe(405);
    expect((await chatHandler.fetch(chat(''))).status).toBe(400);
    expect((await chatHandler.fetch(chat('X'.repeat(2001)))).status).toBe(400);
  });
});
