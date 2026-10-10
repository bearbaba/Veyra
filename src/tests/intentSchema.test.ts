/**
 * Tests: src/core/intent/intentSchema.ts
 */
import { describe, it, expect } from 'vitest';
import {
  validateIntentResponse,
  untrusted,
  isUntrusted,
  type RawBffIntentResponse,
} from '../core/intent/intentSchema.js';

describe('untrusted / isUntrusted', () => {
  it('creates an UntrustedString', () => {
    const v = untrusted('some value');
    expect(v.kind).toBe('UNTRUSTED_STRING');
    expect(v.raw).toBe('some value');
  });

  it('isUntrusted returns true for UntrustedString', () => {
    expect(isUntrusted(untrusted('test'))).toBe(true);
  });

  it('isUntrusted returns false for plain string', () => {
    expect(isUntrusted('not-untrusted')).toBe(false);
  });

  it('isUntrusted returns false for null', () => {
    expect(isUntrusted(null)).toBe(false);
  });
});

describe('validateIntentResponse — basic structure', () => {
  it('returns a valid result for a minimal response', () => {
    const raw: RawBffIntentResponse = {
      displaySummary: 'Send 10 USDC to Alice',
      status: 'RESOLVED',
      candidates: [
        { actionType: 'TRANSFER', confidence: 0.9, amountRaw: '10', tokenRaw: 'USDC', recipientRaw: 'alice.eth' },
      ],
      missingParams: [],
      parsedAt: Date.now(),
    };
    const result = validateIntentResponse(raw);
    expect(result.status).toBe('RESOLVED');
    expect(result.candidates.length).toBe(1);
    expect(result.candidates[0].actionType).toBe('TRANSFER');
  });

  it('provides a displaySummary fallback when missing', () => {
    const result = validateIntentResponse({});
    expect(result.displaySummary).toBeTruthy();
  });

  it('provides a parsedAt timestamp', () => {
    const result = validateIntentResponse({});
    expect(result.parsedAt).toBeGreaterThan(0);
  });
});

describe('validateIntentResponse — unknown action type filtering', () => {
  it('strips candidates with unknown actionType', () => {
    const raw: RawBffIntentResponse = {
      status: 'RESOLVED',
      candidates: [
        { actionType: 'HACK_THE_PLANET', confidence: 1.0 },
        { actionType: 'TRANSFER', confidence: 0.8 },
      ],
    };
    const result = validateIntentResponse(raw);
    expect(result.candidates.length).toBe(1);
    expect(result.candidates[0].actionType).toBe('TRANSFER');
  });

  it('returns UNRECOGNISED when all candidates have invalid action types', () => {
    const raw: RawBffIntentResponse = {
      status: 'RESOLVED',
      candidates: [
        { actionType: 'UNKNOWN_ACTION', confidence: 1.0 },
      ],
    };
    const result = validateIntentResponse(raw);
    expect(result.status).toBe('UNRECOGNISED');
    expect(result.candidates).toHaveLength(0);
  });
});

describe('validateIntentResponse — display string bounding', () => {
  it('truncates long displaySummary to 200 chars', () => {
    const long = 'x'.repeat(500);
    const result = validateIntentResponse({ displaySummary: long, status: 'RESOLVED', candidates: [] });
    expect(result.displaySummary.length).toBeLessThanOrEqual(200);
  });

  it('truncates long clarificationQuestion to 300 chars', () => {
    const long = 'q'.repeat(500);
    const result = validateIntentResponse({ clarificationQuestion: long });
    expect(result.clarificationQuestion!.length).toBeLessThanOrEqual(300);
  });
});

describe('validateIntentResponse — missing params detection', () => {
  it('promotes RESOLVED to NEEDS_CLARIFICATION when required params are missing', () => {
    const raw: RawBffIntentResponse = {
      status: 'RESOLVED',
      candidates: [
        // TRANSFER without recipientRaw or amountRaw
        { actionType: 'TRANSFER', confidence: 0.9, tokenRaw: 'USDC' },
      ],
    };
    const result = validateIntentResponse(raw);
    expect(result.status).toBe('NEEDS_CLARIFICATION');
    expect(result.missingParams.length).toBeGreaterThan(0);
  });

  it('RESOLVED stays RESOLVED when all required params present', () => {
    const raw: RawBffIntentResponse = {
      status: 'RESOLVED',
      candidates: [
        {
          actionType: 'TRANSFER',
          confidence: 0.9,
          recipientRaw: '0x1234',
          amountRaw: '10',
          tokenRaw: 'USDC',
        },
      ],
    };
    const result = validateIntentResponse(raw);
    expect(result.status).toBe('RESOLVED');
    expect(result.missingParams).toHaveLength(0);
  });
});

describe('validateIntentResponse — candidate limits', () => {
  it('caps candidates at 5', () => {
    const raw: RawBffIntentResponse = {
      candidates: Array(10).fill({ actionType: 'TRANSFER', confidence: 0.5 }),
    };
    const result = validateIntentResponse(raw);
    expect(result.candidates.length).toBeLessThanOrEqual(5);
  });
});

describe('validateIntentResponse — all supported action types', () => {
  const types = ['TRANSFER', 'CONVERT', 'BRIDGE', 'APPROVE', 'SUPPLY', 'WITHDRAW', 'BORROW', 'REPAY'];
  for (const actionType of types) {
    it(`accepts action type ${actionType}`, () => {
      const result = validateIntentResponse({
        candidates: [{ actionType, confidence: 0.8 }],
      });
      expect(result.candidates.some((c) => c.actionType === actionType)).toBe(true);
    });
  }
});

describe('validateIntentResponse — raw values wrapped as UntrustedString', () => {
  it('recipientRaw is an UntrustedString', () => {
    const result = validateIntentResponse({
      candidates: [{ actionType: 'TRANSFER', confidence: 0.9, recipientRaw: 'alice.eth' }],
    });
    const candidate = result.candidates[0];
    expect(candidate.recipientRaw).toBeDefined();
    expect(isUntrusted(candidate.recipientRaw)).toBe(true);
  });

  it('amountRaw is an UntrustedString', () => {
    const result = validateIntentResponse({
      candidates: [{ actionType: 'TRANSFER', confidence: 0.9, amountRaw: '10 USDC', recipientRaw: 'alice.eth', tokenRaw: 'USDC' }],
    });
    expect(isUntrusted(result.candidates[0].amountRaw)).toBe(true);
  });


  it('keeps conversion target token as an untrusted field', () => {
    const result = validateIntentResponse({
      status: 'RESOLVED',
      candidates: [{ actionType: 'CONVERT', confidence: 0.9, amountRaw: '10', tokenRaw: 'USDC', targetTokenRaw: 'EURC' }],
    });
    expect(result.status).toBe('RESOLVED');
    expect(result.candidates[0].targetTokenRaw?.raw).toBe('EURC');
    expect(isUntrusted(result.candidates[0].targetTokenRaw)).toBe(true);
  });
});
