import { describe, expect, it } from 'vitest';
import {
  isReceiptTransitionAllowed,
  validateReceiptSyncEvidence,
  type ReceiptExecutionEvidenceState,
  type ReceiptStatus,
} from '../../server/db/repositories/receiptRepository.js';

const SOURCE_TX =
  '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const DEST_TX =
  '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

function evidenceState(
  overrides: Partial<ReceiptExecutionEvidenceState> = {},
): ReceiptExecutionEvidenceState {
  return {
    providerId: 'cctp-v2-bridge',
    action: 'BRIDGE',
    routeId: 'route-phase5',
    senderChainId: 5042002,
    recipientChainId: 11155111,
    burnTxHash: null,
    burnChainId: null,
    burnBlockNumber: null,
    receiveTxHash: null,
    receiveChainId: null,
    receiveBlockNumber: null,
    ...overrides,
  };
}

describe('Phase 5 ActivityReceipt lifecycle', () => {
  it('allows the canonical direct CCTP production lifecycle', () => {
    const path: ReceiptStatus[] = [
      'INTENT_CAPTURED',
      'PREFLIGHT_PASSED',
      'SIGNED',
      'BROADCAST',
      'SOURCE_CONFIRMED',
      'ATTESTATION_PENDING',
      'RECEIVE_PENDING',
      'CONFIRMED',
      'COMPLETE',
    ];

    for (let i = 0; i < path.length - 1; i++) {
      expect(
        isReceiptTransitionAllowed(path[i], path[i + 1]),
        `${path[i]} -> ${path[i + 1]}`,
      ).toBe(true);
    }
  });

  it('allows destination retry without replaying the source lifecycle', () => {
    expect(
      isReceiptTransitionAllowed(
        'RECEIVE_PENDING',
        'RECEIVE_FAILED_RETRYABLE',
      ),
    ).toBe(true);
    expect(
      isReceiptTransitionAllowed(
        'RECEIVE_FAILED_RETRYABLE',
        'RECEIVE_PENDING',
      ),
    ).toBe(true);
  });

  it('rejects lifecycle skips that could fabricate execution evidence', () => {
    expect(
      isReceiptTransitionAllowed('PREFLIGHT_PASSED', 'BROADCAST'),
    ).toBe(false);
    expect(
      isReceiptTransitionAllowed('BROADCAST', 'RECEIVE_PENDING'),
    ).toBe(false);
    expect(
      isReceiptTransitionAllowed('SOURCE_CONFIRMED', 'COMPLETE'),
    ).toBe(false);
  });

  it('does not reopen terminal receipts', () => {
    const terminal: ReceiptStatus[] = [
      'COMPLETE',
      'FAILED',
      'INVALIDATED',
      'DUPLICATE_DETECTED',
      'CANCELLED',
    ];

    for (const status of terminal) {
      expect(isReceiptTransitionAllowed(status, 'BROADCAST')).toBe(false);
    }
  });

  it('requires immutable CCTP burn evidence once broadcast is recorded', () => {
    const current = evidenceState({
      burnTxHash: SOURCE_TX,
      burnChainId: 5042002,
    });

    expect(() =>
      validateReceiptSyncEvidence(current, {
        receiptId: 'rcpt',
        revision: 5,
        status: 'BROADCAST',
        burnTxHash:
          '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
        burnChainId: 5042002,
      }),
    ).toThrow(/burnTxHash is immutable/i);
  });

  it('requires source confirmation evidence before advancing CCTP lifecycle', () => {
    const current = evidenceState({
      burnTxHash: SOURCE_TX,
      burnChainId: 5042002,
    });

    expect(() =>
      validateReceiptSyncEvidence(current, {
        receiptId: 'rcpt',
        revision: 6,
        status: 'SOURCE_CONFIRMED',
      }),
    ).toThrow(/burnBlockNumber/i);
  });

  it('requires destination tx and block evidence before CCTP confirmation', () => {
    const current = evidenceState({
      burnTxHash: SOURCE_TX,
      burnChainId: 5042002,
      burnBlockNumber: 100,
      receiveTxHash: DEST_TX,
      receiveChainId: 11155111,
    });

    expect(() =>
      validateReceiptSyncEvidence(current, {
        receiptId: 'rcpt',
        revision: 9,
        status: 'CONFIRMED',
      }),
    ).toThrow(/receiveBlockNumber/i);
  });

  it('accepts a route-bound CCTP resume payload only after source broadcast', () => {
    const current = evidenceState({
      burnTxHash: SOURCE_TX,
      burnChainId: 5042002,
    });

    expect(() =>
      validateReceiptSyncEvidence(current, {
        receiptId: 'rcpt',
        revision: 5,
        status: 'BROADCAST',
        resumable: true,
        resumePayload: {
          provider: 'cctp-v2-bridge',
          version: 1,
          payload: { planId: 'route-phase5' },
        },
      }),
    ).not.toThrow();

    expect(() =>
      validateReceiptSyncEvidence(current, {
        receiptId: 'rcpt',
        revision: 5,
        status: 'BROADCAST',
        resumable: true,
        resumePayload: {
          provider: 'cctp-v2-bridge',
          version: 1,
          payload: { planId: 'wrong-route' },
        },
      }),
    ).toThrow(/not bound/i);
  });

  it('permits same-status revision reconciliation without lifecycle regression', () => {
    expect(
      isReceiptTransitionAllowed('ATTESTATION_PENDING', 'ATTESTATION_PENDING'),
    ).toBe(true);
    expect(
      isReceiptTransitionAllowed('RECEIVE_PENDING', 'RECEIVE_PENDING'),
    ).toBe(true);
  });
});
