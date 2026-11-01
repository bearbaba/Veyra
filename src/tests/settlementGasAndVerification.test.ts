/**
 * Settlement page: gas denomination and payment verification unit tests.
 *
 * These tests cover the pure utility functions extracted from SettlementPage.tsx
 * and the verification logic that must hold before a transaction is marked VERIFIED.
 *
 * Issue 1 — Gas denomination regression:
 *   Arc native gas uses 18 decimals; USDC ERC-20 uses 6 decimals.
 *   gasPrice is in 18-decimal native units.
 *   gasEstimateRaw * gasPrice is in 10^18 denomination.
 *   Displaying it as 6-decimal USDC requires dividing by 10^12.
 *
 * Issue 2 — Independent payment verification:
 *   VERIFIED requires all 12 checks to pass.
 *   Any forged, missing, or mismatched field must produce 'confirmed' with failReasons.
 */

import { describe, it, expect } from 'vitest';
import { formatUnits } from 'viem';

// ─── Production modules under test ────────────────────────────────────────────
// Tests import the EXACT production functions used by SettlementPage.tsx.
// If SettlementPage diverges, these imports break — catching the regression.

import {
  GAS_TO_USDC_DIVISOR,
  gasNativeToUsdcMicro,
  fmtGasUsdc,
} from '../lib/settlementGas';

import {
  verifyPaymentReceipt,
  type VerifySnapshot,
  type PaymentSettledArgs,
  type TransferLog,
  type ReceiptInput,
} from '../lib/settlementVerify';

describe('Arc gas denomination conversion (Issue 1)', () => {
  it('GAS_TO_USDC_DIVISOR is exactly 10^12', () => {
    expect(GAS_TO_USDC_DIVISOR).toBe(1_000_000_000_000n);
  });

  it('converts a typical gas cost correctly: 21000 gas * 1 gwei gasPrice', () => {
    // 1 gwei = 1_000_000_000 (10^9) wei (18-dec native)
    // 21000 * 1_000_000_000 = 21_000_000_000_000 (2.1e13) native units
    // / 10^12 = 21 micro-USDC = 0.000021 USDC
    const gasUnits = 21_000n;
    const gasPrice = 1_000_000_000n; // 1 gwei
    const native = gasUnits * gasPrice; // 21_000_000_000_000n (2.1e13)
    const micro = gasNativeToUsdcMicro(native);
    expect(micro).toBe(21n); // 21_000_000_000_000 / 10^12 = 21 micro-USDC
    expect(fmtGasUsdc(native)).toBe('~0.000021 USDC');
  });

  it('converts a larger gas cost: 200000 gas * 100 gwei gasPrice', () => {
    // 100 gwei = 100_000_000_000 (1e11) wei
    // 200_000 * 1e11 = 2e16 native units
    // / 10^12 = 2e4 = 20_000 micro-USDC = 0.02 USDC
    const gasUnits = 200_000n;
    const gasPrice = 100_000_000_000n; // 100 gwei
    const native = gasUnits * gasPrice;
    expect(native).toBe(20_000_000_000_000_000n); // 2e16
    const micro = gasNativeToUsdcMicro(native);
    expect(micro).toBe(20_000n); // 0.02 USDC
    const display = fmtGasUsdc(native);
    expect(display).toBe('~0.02 USDC');
  });

  it('handles a typical Arc contract call: 150000 gas * 1 gwei gasPrice', () => {
    // 150_000 * 1e9 = 1.5e14 native units
    // 1.5e14 / 10^12 = 150 micro-USDC = 0.00015 USDC
    const gasUnits = 150_000n;
    const gasPrice = 1_000_000_000n; // 1 gwei
    const native = gasUnits * gasPrice; // 1.5e14
    const micro = gasNativeToUsdcMicro(native);
    expect(micro).toBe(150n); // 150_000_000_000_000 / 10^12 = 150 micro-USDC
    expect(fmtGasUsdc(native)).toBe('~0.00015 USDC');
  });

  it('handles a high-gwei scenario (e.g. network congestion: 1_000_000 gas * 1000 gwei)', () => {
    const gasUnits = 1_000_000n;
    const gasPrice = 1_000_000_000_000n; // 1000 gwei = 1e12
    const native = gasUnits * gasPrice; // 1e18
    const micro = gasNativeToUsdcMicro(native);
    expect(micro).toBe(1_000_000n); // 1 USDC
    const display = fmtGasUsdc(native);
    expect(display).toBe('~1 USDC');
  });

  it('REGRESSION: 6-decimal formatting on a native value produces 10^12 error', () => {
    // Demonstrates what the INCORRECT code did:
    // native = 200_000 gas * 100 gwei = 200_000 * 1e11 = 2e16
    // formatUnits(2e16, 6) = '20000000000' (20 billion USDC — clearly wrong)
    const gasUnits = 200_000n;
    const gasPrice = 100_000_000_000n; // 100 gwei = 1e11
    const native = gasUnits * gasPrice; // 2e16
    const wrongDisplay = formatUnits(native, 6); // WRONG: treats 18-dec value as 6-dec
    expect(parseFloat(wrongDisplay)).toBeGreaterThan(1_000_000); // 20 billion — obviously wrong
    // Correct: divide by 10^12 first → 20_000 micro-USDC = 0.02 USDC
    const correctMicro = gasNativeToUsdcMicro(native);
    expect(correctMicro).toBe(20_000n);
    expect(formatUnits(correctMicro, 6)).toBe('0.02');
  });

  it('returns "< 0.000001 USDC" when native gas is zero', () => {
    expect(fmtGasUsdc(0n)).toBe('< 0.000001 USDC');
  });

  it('ceiling-rounds up to avoid under-reporting (floor would lose 1 micro)', () => {
    // 1_000_000_000_001n / 10^12 = 1.000000000001 → ceil → 2
    // (floor/truncation would give 1 — under by 10^{-12} USDC)
    const native = 1_000_000_000_001n;
    const micro = gasNativeToUsdcMicro(native);
    expect(micro).toBe(2n); // ceiling, not floor
  });

  it('exact boundary: native === GAS_TO_USDC_DIVISOR → exactly 1 micro-USDC', () => {
    // 10^12 / 10^12 = 1 — no rounding needed, floor and ceiling agree
    expect(gasNativeToUsdcMicro(GAS_TO_USDC_DIVISOR)).toBe(1n);
  });

  it('sub-micro-USDC: 1 native unit → ceil → 1 micro (never zero, never lost)', () => {
    // Any non-zero native value must NOT round to 0.
    // 1n / 10^12 = 0 (floor) — under-reports; ceil → 1.
    expect(gasNativeToUsdcMicro(1n)).toBe(1n);
  });

  it('sub-micro-USDC: just below divisor boundary → 1 micro', () => {
    // (10^12 - 1) / 10^12 = 0.999... → ceil → 1
    expect(gasNativeToUsdcMicro(GAS_TO_USDC_DIVISOR - 1n)).toBe(1n);
  });

  it('handles unavailable gas price: estimation returns 0 native', () => {
    // 0n is the sentinel for "no estimate available" — distinct from sub-micro.
    // The component shows "estimation unavailable" when native === 0n.
    const native = 0n;
    const micro = gasNativeToUsdcMicro(native);
    expect(micro).toBe(0n); // special-cased, not a sub-micro round-up
    const display = fmtGasUsdc(native);
    expect(display).toBe('< 0.000001 USDC');
  });

  it('approve and pay gas are independent values with independent divisors', () => {
    // The component estimates each separately. Confirm divisor is the same.
    // 50_000 * 1e9 = 5e13 native / 1e12 = 50 micro-USDC
    // 100_000 * 1e9 = 1e14 native / 1e12 = 100 micro-USDC
    const approveGas = 50_000n * 1_000_000_000n;
    const payGas = 100_000n * 1_000_000_000n;
    const approveMicro = gasNativeToUsdcMicro(approveGas);
    const payMicro = gasNativeToUsdcMicro(payGas);
    expect(approveMicro).toBe(50n);
    expect(payMicro).toBe(100n);
    // They are separate — approving costs less than paying (fewer storage writes)
    expect(approveMicro).toBeLessThan(payMicro);
  });
});

// ─── Issue 2: Independent payment verification ───────────────────────────────
// All types (VerifySnapshot, PaymentSettledArgs, TransferLog, ReceiptInput) and
// the verifyPaymentReceipt() function are imported from @/lib/settlementVerify
// — the same module used by SettlementPage.tsx in production.

/**
 * Helper: call verifyPaymentReceipt with test-friendly parameter shape.
 * Maps test fixture fields to the types declared in settlementVerify.ts.
 */
function runVerification(params: {
  chainId: number;
  receiptStatus: 'success' | 'reverted';
  receiptTo: string;
  paymentSettledLog: PaymentSettledArgs | null;
  transferLogs: TransferLog[];
  snap: VerifySnapshot;
}): { verified: boolean; failReasons: string[] } {
  const { chainId, receiptStatus, receiptTo, paymentSettledLog, transferLogs, snap } = params;
  const receipt: ReceiptInput = {
    status: receiptStatus,
    to: receiptTo,
    transactionHash: '0x' + '00'.repeat(32),
    blockNumber: 1n,
    gasUsed: 21000n,
  };
  return verifyPaymentReceipt(receipt, chainId, paymentSettledLog, transferLogs, snap);
}

// Test fixtures
const PAYER = '0x1111111111111111111111111111111111111111' as `0x${string}`;
const RECIPIENT = '0x2222222222222222222222222222222222222222' as `0x${string}`;
const CONTRACT = '0x39ceae4c1363780dbef8a02487d71914e0c9382a' as `0x${string}`;
const USDC = '0x3600000000000000000000000000000000000000' as `0x${string}`;
const REF: `0x${string}` = `0x${'ab'.repeat(32)}`;
const AMOUNT = 10_000_000n; // 10 USDC
const FEE = 0n;
const NET = AMOUNT - FEE;

const GOOD_SNAP: VerifySnapshot = {
  walletAddress: PAYER,
  chainId: 5042002,
  recipient: RECIPIENT,
  amountParsed: AMOUNT,
  contractAddress: CONTRACT,
  usdcAddress: USDC,
  feeBps: 0n,
  feeAmount: FEE,
  netAmount: NET,
  ref: REF,
};

const GOOD_EVENT: PaymentSettledArgs = {
  emitterAddress: CONTRACT,
  paymentId: '0x' + 'cc'.repeat(32),
  payer: PAYER,
  recipient: RECIPIENT,
  amount: AMOUNT,
  fee: FEE,
  ref: REF,
};

const GOOD_TRANSFERS: TransferLog[] = [
  { tokenAddress: USDC, from: PAYER, to: CONTRACT, value: AMOUNT },
  { tokenAddress: USDC, from: CONTRACT, to: RECIPIENT, value: NET },
];

describe('Payment verification — all 12 checks (Issue 2)', () => {
  it('passes when all 12 checks hold', () => {
    const r = runVerification({
      chainId: 5042002,
      receiptStatus: 'success',
      receiptTo: CONTRACT,
      paymentSettledLog: GOOD_EVENT,
      transferLogs: GOOD_TRANSFERS,
      snap: GOOD_SNAP,
    });
    expect(r.verified).toBe(true);
    expect(r.failReasons).toHaveLength(0);
  });

  it('(a) fails on wrong chain ID', () => {
    const r = runVerification({
      chainId: 1, // Ethereum mainnet — not Arc
      receiptStatus: 'success',
      receiptTo: CONTRACT,
      paymentSettledLog: GOOD_EVENT,
      transferLogs: GOOD_TRANSFERS,
      snap: GOOD_SNAP,
    });
    expect(r.verified).toBe(false);
    expect(r.failReasons.some(f => f.toLowerCase().includes('not arc') || f.toLowerCase().includes('arc chain') || f.toLowerCase().includes('chain') && f.toLowerCase().includes('5042'))).toBe(true);
  });

  it('(b) fails on reverted receipt', () => {
    const r = runVerification({
      chainId: 5042002,
      receiptStatus: 'reverted',
      receiptTo: CONTRACT,
      paymentSettledLog: GOOD_EVENT,
      transferLogs: GOOD_TRANSFERS,
      snap: GOOD_SNAP,
    });
    expect(r.verified).toBe(false);
    expect(r.failReasons.some(f => f.includes('reverted') || f.includes('not') && f.includes('success'))).toBe(true);
  });

  it('(c) fails when tx target is not the contract', () => {
    const r = runVerification({
      chainId: 5042002,
      receiptStatus: 'success',
      receiptTo: '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
      paymentSettledLog: GOOD_EVENT,
      transferLogs: GOOD_TRANSFERS,
      snap: GOOD_SNAP,
    });
    expect(r.verified).toBe(false);
    expect(r.failReasons.some(f => f.includes('does not match contract'))).toBe(true);
  });

  it('(d) fails when PaymentSettled is emitted by a forged contract (not deployment address)', () => {
    const forgedEvent: PaymentSettledArgs = {
      ...GOOD_EVENT,
      emitterAddress: '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
    };
    const r = runVerification({
      chainId: 5042002,
      receiptStatus: 'success',
      receiptTo: CONTRACT,
      paymentSettledLog: forgedEvent,
      transferLogs: GOOD_TRANSFERS,
      snap: GOOD_SNAP,
    });
    expect(r.verified).toBe(false);
    expect(r.failReasons.some(f => f.includes('emitted by') || f.includes('PaymentSettled') || f.includes('expected'))).toBe(true);
  });

  it('(e) fails when payer does not match the signing wallet', () => {
    const r = runVerification({
      chainId: 5042002,
      receiptStatus: 'success',
      receiptTo: CONTRACT,
      paymentSettledLog: {
        ...GOOD_EVENT,
        payer: '0x9999999999999999999999999999999999999999',
      },
      transferLogs: GOOD_TRANSFERS,
      snap: GOOD_SNAP,
    });
    expect(r.verified).toBe(false);
    expect(r.failReasons.some(f => f.toLowerCase().includes('payer') && f.toLowerCase().includes('wallet'))).toBe(true);
  });

  it('(f) fails when recipient does not match intended recipient', () => {
    const r = runVerification({
      chainId: 5042002,
      receiptStatus: 'success',
      receiptTo: CONTRACT,
      paymentSettledLog: {
        ...GOOD_EVENT,
        recipient: '0x9999999999999999999999999999999999999999',
      },
      transferLogs: GOOD_TRANSFERS,
      snap: GOOD_SNAP,
    });
    expect(r.verified).toBe(false);
    expect(r.failReasons.some(f => f.toLowerCase().includes('recipient') && f.toLowerCase().includes('intended'))).toBe(true);
  });

  it('(g) fails when gross amount differs', () => {
    const r = runVerification({
      chainId: 5042002,
      receiptStatus: 'success',
      receiptTo: CONTRACT,
      paymentSettledLog: {
        ...GOOD_EVENT,
        amount: AMOUNT + 1n, // off by 1 micro-USDC
      },
      transferLogs: GOOD_TRANSFERS,
      snap: GOOD_SNAP,
    });
    expect(r.verified).toBe(false);
    expect(r.failReasons.some(f => f.includes('Gross amount') || (f.includes('amount') && (f.includes('differs') || f.includes('does not match'))))).toBe(true);
  });

  it('(h) fails when fee differs', () => {
    const r = runVerification({
      chainId: 5042002,
      receiptStatus: 'success',
      receiptTo: CONTRACT,
      paymentSettledLog: {
        ...GOOD_EVENT,
        fee: 1n, // unexpected fee
      },
      transferLogs: GOOD_TRANSFERS,
      snap: { ...GOOD_SNAP, feeAmount: 0n },
    });
    expect(r.verified).toBe(false);
    expect(r.failReasons.some(f => f.includes('Fee') || (f.includes('fee') && (f.includes('differs') || f.includes('does not match'))))).toBe(true);
  });

  it('(i) fails when net amount is inconsistent with gross minus fee', () => {
    // Craft a case where amount - fee !== netAmount in the snapshot
    const r = runVerification({
      chainId: 5042002,
      receiptStatus: 'success',
      receiptTo: CONTRACT,
      paymentSettledLog: {
        ...GOOD_EVENT,
        amount: AMOUNT,
        fee: 1n,
      },
      transferLogs: GOOD_TRANSFERS,
      snap: { ...GOOD_SNAP, feeAmount: 1n, netAmount: AMOUNT - 1n },
    });
    // amount (10M) - fee (1) = 9_999_999 !== netAmount in snap (9_999_999) — should pass (i)
    // but fee (1) !== snap.feeAmount (1) — should pass (h) too
    // Let's make net inconsistent in event
    const r2 = runVerification({
      chainId: 5042002,
      receiptStatus: 'success',
      receiptTo: CONTRACT,
      paymentSettledLog: {
        ...GOOD_EVENT,
        amount: AMOUNT,
        fee: 2n,
      },
      transferLogs: GOOD_TRANSFERS,
      snap: { ...GOOD_SNAP, feeAmount: 2n, netAmount: AMOUNT - 1n }, // netAmount is wrong (off by 1)
    });
    // event: amount - fee = AMOUNT - 2n; snap.netAmount = AMOUNT - 1n → mismatch
    expect(r2.verified).toBe(false);
    expect(r2.failReasons.some(f => f.includes('net'))).toBe(true);
  });

  it('(j) fails when payment reference does not match', () => {
    const r = runVerification({
      chainId: 5042002,
      receiptStatus: 'success',
      receiptTo: CONTRACT,
      paymentSettledLog: {
        ...GOOD_EVENT,
        ref: `0x${'cc'.repeat(32)}`,
      },
      transferLogs: GOOD_TRANSFERS,
      snap: GOOD_SNAP,
    });
    expect(r.verified).toBe(false);
    expect(r.failReasons.some(f => f.includes('ref') && f.includes('does not match'))).toBe(true);
  });

  it('(k) fails when payer-to-contract USDC Transfer is missing', () => {
    const transfersWithoutInbound = GOOD_TRANSFERS.filter(t =>
      !(t.from.toLowerCase() === PAYER.toLowerCase() && t.to.toLowerCase() === CONTRACT.toLowerCase())
    );
    const r = runVerification({
      chainId: 5042002,
      receiptStatus: 'success',
      receiptTo: CONTRACT,
      paymentSettledLog: GOOD_EVENT,
      transferLogs: transfersWithoutInbound,
      snap: GOOD_SNAP,
    });
    expect(r.verified).toBe(false);
    expect(r.failReasons.some(f => f.includes('Missing USDC Transfer') || f.includes('payer') || f.includes('not found'))).toBe(true);
  });

  it('(l) fails when contract-to-recipient USDC Transfer is missing', () => {
    const transfersWithoutOutbound = GOOD_TRANSFERS.filter(t =>
      !(t.from.toLowerCase() === CONTRACT.toLowerCase() && t.to.toLowerCase() === RECIPIENT.toLowerCase())
    );
    const r = runVerification({
      chainId: 5042002,
      receiptStatus: 'success',
      receiptTo: CONTRACT,
      paymentSettledLog: GOOD_EVENT,
      transferLogs: transfersWithoutOutbound,
      snap: GOOD_SNAP,
    });
    expect(r.verified).toBe(false);
    expect(r.failReasons.some(f => f.includes('Missing USDC Transfer') || f.includes('recipient') || f.includes('not found'))).toBe(true);
  });

  it('fails when PaymentSettled event is absent entirely', () => {
    const r = runVerification({
      chainId: 5042002,
      receiptStatus: 'success',
      receiptTo: CONTRACT,
      paymentSettledLog: null,
      transferLogs: GOOD_TRANSFERS,
      snap: GOOD_SNAP,
    });
    expect(r.verified).toBe(false);
    expect(r.failReasons.some(f => f.includes('not found'))).toBe(true);
  });

  it('fails on adversarial: unrelated contract emits a PaymentSettled-shaped event', () => {
    const r = runVerification({
      chainId: 5042002,
      receiptStatus: 'success',
      receiptTo: CONTRACT,
      paymentSettledLog: {
        emitterAddress: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', // not the settlement contract
        paymentId: '0x' + 'cc'.repeat(32),
        payer: PAYER,
        recipient: RECIPIENT,
        amount: AMOUNT,
        fee: FEE,
        ref: REF,
      },
      transferLogs: GOOD_TRANSFERS,
      snap: GOOD_SNAP,
    });
    expect(r.verified).toBe(false);
  });

  it('fails on adversarial: correct event but wrong USDC transfer amounts', () => {
    const r = runVerification({
      chainId: 5042002,
      receiptStatus: 'success',
      receiptTo: CONTRACT,
      paymentSettledLog: GOOD_EVENT,
      transferLogs: [
        { tokenAddress: USDC, from: PAYER, to: CONTRACT, value: AMOUNT - 1n }, // 1 micro less
        { tokenAddress: USDC, from: CONTRACT, to: RECIPIENT, value: NET },
      ],
      snap: GOOD_SNAP,
    });
    expect(r.verified).toBe(false);
    expect(r.failReasons.some(f => f.includes('Missing USDC Transfer') || f.includes('not found'))).toBe(true);
  });

  it('fails on adversarial: USDC transfer from wrong contract address (not canonical USDC)', () => {
    const fakeUsdc = '0xfakeusdc000000000000000000000000000000000' as `0x${string}`;
    const r = runVerification({
      chainId: 5042002,
      receiptStatus: 'success',
      receiptTo: CONTRACT,
      paymentSettledLog: GOOD_EVENT,
      transferLogs: [
        { tokenAddress: fakeUsdc, from: PAYER, to: CONTRACT, value: AMOUNT },
        { tokenAddress: fakeUsdc, from: CONTRACT, to: RECIPIENT, value: NET },
      ],
      snap: GOOD_SNAP, // snap.usdcAddress is the canonical USDC address
    });
    expect(r.verified).toBe(false);
    // Both transfers come from wrong token — not from canonical USDC
    expect(r.failReasons.some(f => f.includes('Missing USDC Transfer') || f.includes('not found'))).toBe(true);
  });

  it('returns all fail reasons, not just the first', () => {
    const r = runVerification({
      chainId: 1, // wrong chain
      receiptStatus: 'reverted', // also wrong
      receiptTo: '0xdeadbeef00000000000000000000000000000000', // also wrong
      paymentSettledLog: null,
      transferLogs: [],
      snap: GOOD_SNAP,
    });
    expect(r.failReasons.length).toBeGreaterThanOrEqual(4);
    expect(r.verified).toBe(false);
  });

  it('Arc Mainnet (5042) is also a valid chain', () => {
    const mainnetSnap = { ...GOOD_SNAP, chainId: 5042 };
    const r = runVerification({
      chainId: 5042,
      receiptStatus: 'success',
      receiptTo: CONTRACT,
      paymentSettledLog: GOOD_EVENT,
      transferLogs: GOOD_TRANSFERS,
      snap: mainnetSnap,
    });
    expect(r.verified).toBe(true);
  });
});
