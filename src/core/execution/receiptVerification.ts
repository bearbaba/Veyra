import { decodeFunctionData, type Hex } from 'viem';

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


const ERC20_TRANSFER_TOPIC =
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const UINT256_DATA_RE = /^0x[0-9a-fA-F]{64}$/;

export interface Erc20ReceiptLog {
  address: string;
  topics: readonly string[];
  data: string;
}

export interface Erc20TransferReceiptEvidence {
  status: 'success' | 'reverted';
  logs: readonly Erc20ReceiptLog[];
}

export interface Erc20TransferVerification {
  verified: boolean;
  detail: string;
  transferAmount: bigint | null;
}

function addressTopic(address: string): string {
  return `0x${'0'.repeat(24)}${address.slice(2).toLowerCase()}`;
}

/**
 * Require the authoritative transaction receipt to contain the exact reviewed
 * ERC-20 Transfer(token, from, to, amount). Balance deltas remain useful final
 * state evidence, but this binds the delta to the transaction being verified.
 */
export function verifyErc20TransferReceiptEvidence(input: {
  receipt: Erc20TransferReceiptEvidence;
  tokenAddress: string;
  from: string;
  to: string;
  amount: bigint;
}): Erc20TransferVerification {
  if (input.receipt.status !== 'success') {
    return {
      verified: false,
      detail: 'Transaction receipt did not succeed.',
      transferAmount: null,
    };
  }

  if (
    !EVM_ADDRESS_RE.test(input.tokenAddress) ||
    !EVM_ADDRESS_RE.test(input.from) ||
    !EVM_ADDRESS_RE.test(input.to) ||
    input.amount <= 0n
  ) {
    return {
      verified: false,
      detail: 'Reviewed ERC-20 transfer evidence input is invalid.',
      transferAmount: null,
    };
  }

  const token = input.tokenAddress.toLowerCase();
  const fromTopic = addressTopic(input.from);
  const toTopic = addressTopic(input.to);

  for (const log of input.receipt.logs) {
    if (
      log.address.toLowerCase() !== token ||
      log.topics[0]?.toLowerCase() !== ERC20_TRANSFER_TOPIC ||
      log.topics[1]?.toLowerCase() !== fromTopic ||
      log.topics[2]?.toLowerCase() !== toTopic ||
      !UINT256_DATA_RE.test(log.data)
    ) {
      continue;
    }

    const transferAmount = BigInt(log.data);
    if (transferAmount === input.amount) {
      return {
        verified: true,
        detail:
          'Authoritative receipt contains the exact reviewed ERC-20 transfer.',
        transferAmount,
      };
    }
  }

  return {
    verified: false,
    detail:
      'Authoritative receipt does not contain the exact reviewed ERC-20 transfer.',
    transferAmount: null,
  };
}


const ERC20_TRANSFER_ABI = [
  {
    name: 'transfer',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

export interface Erc20TransferTransactionLike {
  from: string;
  to: string | null;
  input: Hex;
}

export function verifyErc20TransferTransactionBinding(input: {
  transaction: Erc20TransferTransactionLike;
  tokenAddress: string;
  from: string;
  to: string;
  amount: bigint;
}): { verified: boolean; detail: string } {
  if (
    !EVM_ADDRESS_RE.test(input.tokenAddress) ||
    !EVM_ADDRESS_RE.test(input.from) ||
    !EVM_ADDRESS_RE.test(input.to) ||
    input.amount <= 0n
  ) {
    return {
      verified: false,
      detail: 'Reviewed ERC-20 transaction binding input is invalid.',
    };
  }

  if (input.transaction.from.toLowerCase() !== input.from.toLowerCase()) {
    return {
      verified: false,
      detail: 'ERC-20 transaction sender does not match the reviewed sender.',
    };
  }

  if (
    !input.transaction.to ||
    input.transaction.to.toLowerCase() !== input.tokenAddress.toLowerCase()
  ) {
    return {
      verified: false,
      detail: 'ERC-20 transaction target does not match the reviewed token.',
    };
  }

  try {
    const decoded = decodeFunctionData({
      abi: ERC20_TRANSFER_ABI,
      data: input.transaction.input,
    });
    if (decoded.functionName !== 'transfer') {
      return {
        verified: false,
        detail: 'ERC-20 transaction is not a transfer call.',
      };
    }

    const [recipient, amount] = decoded.args;
    if (
      recipient.toLowerCase() !== input.to.toLowerCase() ||
      amount !== input.amount
    ) {
      return {
        verified: false,
        detail:
          'ERC-20 transaction calldata does not match the reviewed recipient and amount.',
      };
    }
  } catch {
    return {
      verified: false,
      detail: 'ERC-20 transaction calldata could not be decoded safely.',
    };
  }

  return {
    verified: true,
    detail:
      'ERC-20 transaction exactly matches the reviewed sender, token, recipient, and amount.',
  };
}
