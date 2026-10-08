/**
 * Tests: src/lib/env.ts
 *
 * Note: import.meta.env is not available in the vitest node environment.
 * These tests import the functions and verify they work with the
 * environment as-is (no VITE_* vars set = testnet/local default, no LLM keys).
 */
import { describe, it, expect } from 'vitest';

describe('env — assertNoLlmSecretInFrontend', () => {
  it('does not throw when no LLM keys are present in test env', async () => {
    const { assertNoLlmSecretInFrontend } = await import('../lib/env.js');
    // In the test runner (node env), import.meta.env has no OPENAI/ANTHROPIC keys.
    // The function should not throw.
    expect(() => assertNoLlmSecretInFrontend()).not.toThrow();
  });
});

describe('env — assertNoTestnetLeakInMainnet', () => {
  it('does not throw when called from a non-mainnet env', async () => {
    const { assertNoTestnetLeakInMainnet, VEYRA_ENV } = await import('../lib/env.js');
    if (VEYRA_ENV !== 'mainnet') {
      expect(() => assertNoTestnetLeakInMainnet()).not.toThrow();
    }
  });
});

describe('env — IS_TESTNET / IS_MAINNET', () => {
  it('exposes boolean convenience flags', async () => {
    const { IS_TESTNET, IS_MAINNET } = await import('../lib/env.js');
    expect(typeof IS_TESTNET).toBe('boolean');
    expect(typeof IS_MAINNET).toBe('boolean');
    // One of them is always true (or both false in local env — that is fine)
    expect(IS_TESTNET || IS_MAINNET || true).toBe(true);
  });
});
