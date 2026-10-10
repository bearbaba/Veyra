export interface TokenDeltaVerification {
  verified: boolean;
  actualDelta: bigint;
  expectedDelta: bigint;
  detail: string;
}

/**
 * Verify an exact recipient token balance delta from authoritative before/after
 * reads. This is intentionally pure so receipt correctness is unit-testable
 * independently of wallet/provider hooks.
 */
export function verifyExactTokenDelta(
  balanceBefore: bigint,
  balanceAfter: bigint,
  expectedDelta: bigint,
): TokenDeltaVerification {
  if (expectedDelta <= 0n) {
    return {
      verified: false,
      actualDelta: balanceAfter - balanceBefore,
      expectedDelta,
      detail: 'Expected token delta must be greater than zero.',
    };
  }

  const actualDelta = balanceAfter - balanceBefore;
  if (actualDelta !== expectedDelta) {
    return {
      verified: false,
      actualDelta,
      expectedDelta,
      detail: `Recipient token delta mismatch: expected ${expectedDelta}, observed ${actualDelta}.`,
    };
  }

  return {
    verified: true,
    actualDelta,
    expectedDelta,
    detail: 'Recipient token delta matches the expected amount exactly.',
  };
}

export interface MinimumOutputVerification {
  verified: boolean;
  actualAmount: bigint;
  minimumAmount: bigint;
  detail: string;
}

/** Verify provider-reported final output against the reviewed minimum output. */
export function verifyMinimumOutput(
  actualAmount: bigint,
  minimumAmount: bigint,
): MinimumOutputVerification {
  if (minimumAmount <= 0n) {
    return {
      verified: false,
      actualAmount,
      minimumAmount,
      detail: 'Minimum output must be greater than zero.',
    };
  }

  if (actualAmount < minimumAmount) {
    return {
      verified: false,
      actualAmount,
      minimumAmount,
      detail: `Final output ${actualAmount} is below reviewed minimum ${minimumAmount}.`,
    };
  }

  return {
    verified: true,
    actualAmount,
    minimumAmount,
    detail: 'Final output satisfies the reviewed minimum.',
  };
}
