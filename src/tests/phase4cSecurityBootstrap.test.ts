import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  initializeSecurityRuntime,
  resetSecurityRuntimeBootstrapForTesting,
} from '../lib/securityBootstrap';
import {
  getSecurityGateStatus,
  resetSecurityGate,
} from '../lib/securityGate';
import {
  forceUnhydratedForTesting,
  isQuoteReplayStoreHydrated,
  resetQuoteReplayStore,
} from '../core/receipt/quoteReplayStore';

beforeEach(async () => {
  // Keep real timers here. fake-indexeddb dispatches asynchronous IDB events;
  // Vitest fake timers can prevent those callbacks from firing and make the
  // async store reset/hydration hook hang until the hook timeout.
  resetSecurityRuntimeBootstrapForTesting();
  forceUnhydratedForTesting();
  await resetQuoteReplayStore();
  forceUnhydratedForTesting();
  resetSecurityGate();
});

describe('Phase 4C security bootstrap', () => {
  it('hydrates replay protection before marking the gate READY', async () => {
    const promise = initializeSecurityRuntime();
    await promise;

    expect(isQuoteReplayStoreHydrated()).toBe(true);
    expect(getSecurityGateStatus().state).toBe('READY');
  });

  it('is idempotent for repeated callers', async () => {
    const a = initializeSecurityRuntime();
    const b = initializeSecurityRuntime();

    expect(a).toBe(b);
    await a;
    expect(getSecurityGateStatus().state).toBe('READY');
  });
});
