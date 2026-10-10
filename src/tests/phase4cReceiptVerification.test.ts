import { describe, expect, it } from 'vitest';
import {
  verifyExactTokenDelta,
  verifyMinimumOutput,
} from '../core/execution/receiptVerification';

describe('Phase 4C deterministic receipt verification', () => {
  it('verifies an exact recipient token balance delta', () => {
    const result = verifyExactTokenDelta(10_000_000n, 11_000_000n, 1_000_000n);
    expect(result.verified).toBe(true);
    expect(result.actualDelta).toBe(1_000_000n);
  });

  it('fails closed when the observed delta does not match the reviewed amount', () => {
    const result = verifyExactTokenDelta(10_000_000n, 10_900_000n, 1_000_000n);
    expect(result.verified).toBe(false);
    expect(result.actualDelta).toBe(900_000n);
  });

  it('accepts final convert output at or above the reviewed minimum', () => {
    expect(verifyMinimumOutput(1_005_000n, 1_000_000n).verified).toBe(true);
    expect(verifyMinimumOutput(1_000_000n, 1_000_000n).verified).toBe(true);
  });

  it('rejects final convert output below the reviewed minimum', () => {
    expect(verifyMinimumOutput(999_999n, 1_000_000n).verified).toBe(false);
  });
});
