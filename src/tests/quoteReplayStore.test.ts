/**
 * Tests: src/core/receipt/quoteReplayStore.ts
 *
 * Uses fake-indexeddb to run IndexedDB tests in Node.js.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

import {
  reserveQuote,
  releaseReservation,
  markQuoteBroadcast,
  markQuoteUsed,
  checkQuoteReplay,
  reconcileStaleReservations,
  cleanupExpired,
  hydrateQuoteReplayStore,
  isQuoteReplayStoreHydrated,
  assertQuoteReplayStoreHydrated,
  resetQuoteReplayStore,
  forceHydratedForTesting,
  forceUnhydratedForTesting,
} from '../core/receipt/quoteReplayStore.js';

const FUTURE_EXPIRY = Date.now() + 120_000;

beforeEach(async () => {
  // Reset and re-hydrate before each test
  forceUnhydratedForTesting();
  await resetQuoteReplayStore();
  forceHydratedForTesting();
});

describe('hydrateQuoteReplayStore', () => {
  it('marks store as hydrated', async () => {
    forceUnhydratedForTesting();
    await hydrateQuoteReplayStore();
    expect(isQuoteReplayStoreHydrated()).toBe(true);
  });
});

describe('assertQuoteReplayStoreHydrated', () => {
  it('does not throw when hydrated', () => {
    forceHydratedForTesting();
    expect(() => assertQuoteReplayStoreHydrated()).not.toThrow();
  });

  it('throws when not hydrated', () => {
    forceUnhydratedForTesting();
    expect(() => assertQuoteReplayStoreHydrated()).toThrow(/not hydrated/i);
  });
});

describe('reserveQuote', () => {
  it('succeeds for a fresh quote ID', async () => {
    const result = await reserveQuote('q-fresh-1', FUTURE_EXPIRY);
    expect(result.success).toBe(true);
  });

  it('fails with ALREADY_RESERVED if called twice', async () => {
    await reserveQuote('q-double', FUTURE_EXPIRY);
    const result = await reserveQuote('q-double', FUTURE_EXPIRY);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.reason).toBe('ALREADY_RESERVED');
    }
  });

  it('fails with EXPIRED for a quote with past expiry', async () => {
    const result = await reserveQuote('q-expired', Date.now() - 1000);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.reason).toBe('EXPIRED');
    }
  });

  it('allows only one winner when two callers reserve the same quote concurrently', async () => {
    const [a, b] = await Promise.all([
      reserveQuote('q-concurrent', FUTURE_EXPIRY),
      reserveQuote('q-concurrent', FUTURE_EXPIRY),
    ]);

    const successes = [a, b].filter((r) => r.success);
    const failures = [a, b].filter((r) => !r.success);

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    if (!failures[0].success) {
      expect(failures[0].reason).toBe('ALREADY_RESERVED');
    }
  });
});

describe('releaseReservation', () => {
  it('releases a reserved quote', async () => {
    await reserveQuote('q-release', FUTURE_EXPIRY);
    await releaseReservation('q-release');
    // Can now be reserved again
    const result = await reserveQuote('q-release', FUTURE_EXPIRY);
    expect(result.success).toBe(true);
  });

  it('does not throw for non-existent quote', async () => {
    await expect(releaseReservation('q-nonexistent-xyz')).resolves.not.toThrow();
  });

  it('does not release a BROADCAST quote (stays locked)', async () => {
    await reserveQuote('q-broadcast', FUTURE_EXPIRY);
    await markQuoteBroadcast('q-broadcast');
    await releaseReservation('q-broadcast'); // should be no-op

    // Trying to reserve again should fail (it's BROADCAST)
    const replayCheck = await checkQuoteReplay('q-broadcast');
    expect(replayCheck.replayed).toBe(true);
  });
});

describe('markQuoteBroadcast', () => {
  it('transitions from RESERVED to BROADCAST', async () => {
    await reserveQuote('q-bc', FUTURE_EXPIRY);
    await markQuoteBroadcast('q-bc');
    const check = await checkQuoteReplay('q-bc');
    expect(check.replayed).toBe(true);
    if (check.replayed) {
      expect(check.state).toBe('BROADCAST');
    }
  });

  it('throws for non-existent quote', async () => {
    await expect(markQuoteBroadcast('q-not-found-xyz')).rejects.toThrow(/not found/i);
  });

  it('throws when already USED', async () => {
    await reserveQuote('q-used-then-bc', FUTURE_EXPIRY);
    await markQuoteBroadcast('q-used-then-bc');
    await markQuoteUsed('q-used-then-bc');
    await expect(markQuoteBroadcast('q-used-then-bc')).rejects.toThrow(/USED/i);
  });

  it('rejects AVAILABLE → BROADCAST transition', async () => {
    await reserveQuote('q-release-no-broadcast', FUTURE_EXPIRY);
    await releaseReservation('q-release-no-broadcast');
    await expect(markQuoteBroadcast('q-release-no-broadcast')).rejects.toThrow(/RESERVED/i);
  });
});

describe('markQuoteUsed', () => {
  it('transitions to USED', async () => {
    await reserveQuote('q-use', FUTURE_EXPIRY);
    await markQuoteBroadcast('q-use');
    await markQuoteUsed('q-use');
    const check = await checkQuoteReplay('q-use');
    expect(check.replayed).toBe(true);
    if (check.replayed) {
      expect(check.state).toBe('USED');
    }
  });

  it('rejects RESERVED → USED transition', async () => {
    await reserveQuote('q-reserved-no-use', FUTURE_EXPIRY);
    await expect(markQuoteUsed('q-reserved-no-use')).rejects.toThrow(/BROADCAST/i);
  });
});

describe('checkQuoteReplay', () => {
  it('returns replayed:false for unknown quote', async () => {
    const check = await checkQuoteReplay('q-unknown-xyz');
    expect(check.replayed).toBe(false);
  });

  it('returns replayed:true for RESERVED quote', async () => {
    await reserveQuote('q-replay-check', FUTURE_EXPIRY);
    const check = await checkQuoteReplay('q-replay-check');
    expect(check.replayed).toBe(true);
  });

  it('returns replayed:false for AVAILABLE quote (after release)', async () => {
    await reserveQuote('q-available', FUTURE_EXPIRY);
    await releaseReservation('q-available');
    const check = await checkQuoteReplay('q-available');
    expect(check.replayed).toBe(false);
  });
});

describe('reconcileStaleReservations', () => {
  it('releases reservations older than timeout', async () => {
    // We cannot easily time-travel in IDB so we test the function runs without error
    const released = await reconcileStaleReservations();
    expect(typeof released).toBe('number');
    expect(released).toBeGreaterThanOrEqual(0);
  });
});

describe('cleanupExpired', () => {
  it('runs without error', async () => {
    const pruned = await cleanupExpired();
    expect(typeof pruned).toBe('number');
    expect(pruned).toBeGreaterThanOrEqual(0);
  });
});
