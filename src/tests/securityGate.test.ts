/**
 * Tests: src/lib/securityGate.ts
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  getSecurityGateStatus,
  isSecurityGateReady,
  markSecurityGateFailed,
  markSecurityGateReady,
  onSecurityGateChange,
  resetSecurityGate,
  assertSecurityGateReady,
} from '../lib/securityGate.js';

beforeEach(() => {
  vi.useFakeTimers();
  // Reset to a clean PENDING state before each test
  // We need to call reset to start fresh
  resetSecurityGate();
  // Immediately cancel the timeout so it doesn't interfere
  vi.clearAllTimers();
  // Force back to PENDING without the timeout
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllTimers();
});

describe('securityGate — initial state', () => {
  it('starts as PENDING after reset', () => {
    resetSecurityGate();
    vi.clearAllTimers();
    expect(getSecurityGateStatus().state).toBe('PENDING');
  });

  it('isSecurityGateReady returns false in PENDING', () => {
    resetSecurityGate();
    vi.clearAllTimers();
    expect(isSecurityGateReady()).toBe(false);
  });
});

describe('securityGate — READY transition', () => {
  it('becomes READY after markSecurityGateReady', () => {
    resetSecurityGate();
    vi.clearAllTimers();
    markSecurityGateReady();
    expect(getSecurityGateStatus().state).toBe('READY');
  });

  it('isSecurityGateReady returns true when READY', () => {
    resetSecurityGate();
    vi.clearAllTimers();
    markSecurityGateReady();
    expect(isSecurityGateReady()).toBe(true);
  });

  it('readyAt is set when transitioning to READY', () => {
    resetSecurityGate();
    vi.clearAllTimers();
    markSecurityGateReady();
    expect(getSecurityGateStatus().readyAt).toBeDefined();
  });
});

describe('securityGate — FAILED transition', () => {
  it('becomes FAILED after markSecurityGateFailed', () => {
    resetSecurityGate();
    vi.clearAllTimers();
    markSecurityGateFailed('test failure');
    expect(getSecurityGateStatus().state).toBe('FAILED');
  });

  it('stores the failure reason', () => {
    resetSecurityGate();
    vi.clearAllTimers();
    markSecurityGateFailed('disk I/O error');
    expect(getSecurityGateStatus().failureReason).toBe('disk I/O error');
  });

  it('FAILED is terminal — cannot recover to READY', () => {
    resetSecurityGate();
    vi.clearAllTimers();
    markSecurityGateFailed('terminal');
    markSecurityGateReady(); // should be ignored
    expect(getSecurityGateStatus().state).toBe('FAILED');
  });
});

describe('securityGate — assertSecurityGateReady', () => {
  it('does not throw when READY', () => {
    resetSecurityGate();
    vi.clearAllTimers();
    markSecurityGateReady();
    expect(() => assertSecurityGateReady()).not.toThrow();
  });

  it('throws when PENDING', () => {
    resetSecurityGate();
    vi.clearAllTimers();
    expect(() => assertSecurityGateReady()).toThrow(/PENDING|not.*initializ/i);
  });

  it('throws when FAILED', () => {
    resetSecurityGate();
    vi.clearAllTimers();
    markSecurityGateFailed('boom');
    expect(() => assertSecurityGateReady()).toThrow(/failed|boom/i);
  });
});

describe('securityGate — listeners', () => {
  it('notifies listener immediately on subscribe', () => {
    resetSecurityGate();
    vi.clearAllTimers();
    markSecurityGateReady();

    const states: string[] = [];
    const unsub = onSecurityGateChange((s) => states.push(s.state));
    expect(states).toContain('READY');
    unsub();
  });

  it('notifies listener on state change', () => {
    resetSecurityGate();
    vi.clearAllTimers();

    const states: string[] = [];
    const unsub = onSecurityGateChange((s) => states.push(s.state));
    markSecurityGateReady();
    expect(states).toContain('READY');
    unsub();
  });

  it('unsubscribed listener is not called', () => {
    resetSecurityGate();
    vi.clearAllTimers();

    const states: string[] = [];
    const unsub = onSecurityGateChange((s) => states.push(s.state));
    unsub();
    markSecurityGateReady();
    // Should have received the initial PENDING notification only
    expect(states.filter((s) => s === 'READY')).toHaveLength(0);
  });
});
