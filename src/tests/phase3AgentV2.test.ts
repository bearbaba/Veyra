import { describe, expect, it } from 'vitest';
import {
  createFallbackAgentResponse,
  detectAgentLocale,
  validateAgentChatResponse,
  type AgentHistoryMessage,
} from '../core/agent/agentV2.js';

describe('Phase 3D Agent V2', () => {
  it('detects Vietnamese and keeps a Vietnamese transfer actionable', () => {
    const response = createFallbackAgentResponse('Gửi 20 USDC cho @alice');
    expect(response.locale).toBe('vi');
    expect(response.mode).toBe('ACTION');
    expect(response.intent?.status).toBe('RESOLVED');
    const candidate = response.intent?.candidates[0];
    expect(candidate?.actionType).toBe('TRANSFER');
    expect(candidate?.amountRaw?.raw).toBe('20');
    expect(candidate?.tokenRaw?.raw).toBe('USDC');
    expect(candidate?.recipientRaw?.raw).toBe('@alice');
  });

  it('detects Japanese and Chinese scripts without changing financial literals', () => {
    expect(detectAgentLocale('@alice に 20 USDC 送って')).toBe('ja');
    expect(detectAgentLocale('发送 20 USDC 给 @alice')).toBe('zh');
    const response = createFallbackAgentResponse('@alice に 20 USDC 送って');
    const candidate = response.intent?.candidates[0];
    expect(candidate?.amountRaw?.raw).toBe('20');
    expect(candidate?.tokenRaw?.raw).toBe('USDC');
    expect(candidate?.recipientRaw?.raw).toBe('@alice');
  });

  it('captures both assets for conversion', () => {
    const response = createFallbackAgentResponse('Convert 25 USDC to EURC');
    const candidate = response.intent?.candidates[0];
    expect(response.mode).toBe('ACTION');
    expect(candidate?.actionType).toBe('CONVERT');
    expect(candidate?.tokenRaw?.raw).toBe('USDC');
    expect(candidate?.targetTokenRaw?.raw).toBe('EURC');
  });

  it('keeps ordinary chat as CHAT instead of fabricating a financial action', () => {
    const response = createFallbackAgentResponse('What can you do with Veyra?');
    expect(response.mode).toBe('CHAT');
    expect(response.intent).toBeUndefined();
    expect(response.reply.length).toBeGreaterThan(10);
  });

  it('continues a clarification from recent user context in fallback mode', () => {
    const history: AgentHistoryMessage[] = [
      { role: 'user', text: 'Send 20 USDC' },
      { role: 'agent', text: 'Who should receive it?' },
    ];
    const response = createFallbackAgentResponse('@alice', { history });
    expect(response.mode).toBe('ACTION');
    const candidate = response.intent?.candidates[0];
    expect(candidate?.recipientRaw?.raw).toBe('@alice');
    expect(candidate?.amountRaw?.raw).toBe('20');
    expect(candidate?.tokenRaw?.raw).toBe('USDC');
  });

  it('never lets model output unlock execution capability', () => {
    const response = validateAgentChatResponse({
      reply: 'Ready.',
      locale: 'en',
      mode: 'CHAT',
      degraded: false,
      capabilities: {
        conversation: 'ONLINE',
        planning: 'ONLINE',
        execution: 'AVAILABLE',
        provider: 'untrusted-model-output',
      },
    }, 'hello', {
      conversation: 'ONLINE',
      planning: 'ONLINE',
      execution: 'LOCKED',
      provider: 'server-authority',
    });
    expect(response.capabilities.execution).toBe('LOCKED');
  });

  it('sanitizes malformed model output by falling back safely', () => {
    const response = validateAgentChatResponse({ reply: 123, intent: 'not-an-object' }, 'hello');
    expect(response.ok).toBe(true);
    expect(response.reply).toBeTruthy();
    expect(response.capabilities.execution).toBe('LOCKED');
  });
});
