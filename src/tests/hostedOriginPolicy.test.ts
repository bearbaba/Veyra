import { describe, expect, it } from 'vitest';
import { evaluateBrowserOrigin } from '../../server/middleware/browserOriginPolicy';

describe('hosted browser Origin enforcement', () => {
  it('rejects cross-origin requests before route handlers', () => {
    expect(evaluateBrowserOrigin('https://attacker.example', 'https://veyra.example', true).allowed).toBe(false);
  });
  it('accepts the exact configured origin', () => {
    expect(evaluateBrowserOrigin('https://veyra.example', 'https://veyra.example', true))
      .toEqual({ allowed: true, responseOrigin: 'https://veyra.example' });
  });
  it('rejects wildcard or missing hosted origin configuration', () => {
    expect(evaluateBrowserOrigin('https://veyra.example', '*', true).allowed).toBe(false);
    expect(evaluateBrowserOrigin('https://veyra.example', undefined, true).allowed).toBe(false);
  });
  it('permits originless authenticated API clients but never grants CORS', () => {
    expect(evaluateBrowserOrigin(undefined, 'https://veyra.example', true))
      .toEqual({ allowed: true, responseOrigin: undefined });
  });
  it('keeps local developer wildcard CORS behavior', () => {
    expect(evaluateBrowserOrigin('http://localhost:5173', undefined, false))
      .toEqual({ allowed: true, responseOrigin: '*' });
  });
  it('rejects lookalike origin, port, scheme and trailing slash', () => {
    for (const origin of ['http://veyra.example','https://veyra.example.evil.com','https://veyra.example:444','https://veyra.example/']) {
      expect(evaluateBrowserOrigin(origin, 'https://veyra.example', true).allowed).toBe(false);
    }
  });
});
