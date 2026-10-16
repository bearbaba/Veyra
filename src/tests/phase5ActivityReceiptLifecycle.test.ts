import { describe, expect, it } from 'vitest';
import {
  isReceiptTransitionAllowed,
  isCctpBridgeReceiptTransitionAllowed,
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

  it('rejects CCTP shortcuts past authoritative source verification', () => {
    expect(isReceiptTransitionAllowed('BROADCAST', 'CONFIRMED')).toBe(true);
    expect(isCctpBridgeReceiptTransitionAllowed('BROADCAST', 'CONFIRMED')).toBe(false);
    expect(isCctpBridgeReceiptTransitionAllowed('BROADCAST', 'CONFIRMING')).toBe(false);
    expect(isCctpBridgeReceiptTransitionAllowed('BROADCAST', 'SOURCE_CONFIRMED')).toBe(true);
    expect(isCctpBridgeReceiptTransitionAllowed('CONFIRMED', 'FAILED')).toBe(false);
    expect(isCctpBridgeReceiptTransitionAllowed('CONFIRMED', 'COMPLETE')).toBe(true);
  });

  it('never terminalizes a CCTP bridge after wallet submission may have started', () => {
    const inFlight: ReceiptStatus[] = [
      'SIGNED',
      'BROADCAST',
      'SOURCE_CONFIRMED',
      'ATTESTATION_PENDING',
      'RECEIVE_PENDING',
      'RECEIVE_FAILED_RETRYABLE',
      'CONFIRMED',
    ];
    const unsafeTerminal: ReceiptStatus[] = [
      'FAILED',
      'CANCELLED',
      'INVALIDATED',
      'DUPLICATE_DETECTED',
    ];

    for (const from of inFlight) {
      for (const to of unsafeTerminal) {
        expect(
          isCctpBridgeReceiptTransitionAllowed(from, to),
          `${from} -> ${to} must remain recoverable`,
        ).toBe(false);
      }
    }

    // Failures *before* signing are still safe to terminalize.
    expect(
      isCctpBridgeReceiptTransitionAllowed('PREFLIGHT_PASSED', 'FAILED'),
    ).toBe(true);
    expect(
      isCctpBridgeReceiptTransitionAllowed('PREFLIGHT_PASSED', 'CANCELLED'),
    ).toBe(true);
    expect(
      isCctpBridgeReceiptTransitionAllowed('RECEIVE_PENDING', 'RECEIVE_FAILED_RETRYABLE'),
    ).toBe(true);
    expect(
      isCctpBridgeReceiptTransitionAllowed('RECEIVE_FAILED_RETRYABLE', 'RECEIVE_PENDING'),
    ).toBe(true);
  });

  it('allows recovery to catch up through SIGNED before a burn hash is stored', () => {
    const current = evidenceState();
    expect(() =>
      validateReceiptSyncEvidence(current, {
        receiptId: 'rcpt',
        revision: 4,
        status: 'SIGNED',
        resumable: false,
      }),
    ).not.toThrow();
    expect(() =>
      validateReceiptSyncEvidence(current, {
        receiptId: 'rcpt',
        revision: 4,
        status: 'SIGNED',
        resumable: true,
      }),
    ).toThrow(/resumable before a source burn hash/i);
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

  it('rejects terminal same-status syncs so completed receipts cannot be mutated', () => {
    const terminal: ReceiptStatus[] = [
      'COMPLETE',
      'FAILED',
      'INVALIDATED',
      'DUPLICATE_DETECTED',
      'CANCELLED',
    ];
    for (const status of terminal) {
      expect(isReceiptTransitionAllowed(status, status), status).toBe(false);
    }
    // Non-terminal same-status sync remains available for advancing evidence
    // without falsely claiming a new lifecycle state.
    expect(isReceiptTransitionAllowed('BROADCAST', 'BROADCAST')).toBe(true);
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

  it('rejects explicit null clearing of all immutable on-chain receipt fields', () => {
    const current = evidenceState({
      burnTxHash: SOURCE_TX,
      burnChainId: 5042002,
      burnBlockNumber: 100,
      receiveTxHash: DEST_TX,
      receiveChainId: 11155111,
      receiveBlockNumber: 200,
    });

    const attemptedClears: Array<[
      string,
      Partial<Parameters<typeof validateReceiptSyncEvidence>[1]>
    ]> = [
      ['burnTxHash', { burnTxHash: null }],
      ['burnChainId', { burnChainId: null }],
      ['burnBlockNumber', { burnBlockNumber: null }],
      ['receiveTxHash', { receiveTxHash: null }],
      ['receiveChainId', { receiveChainId: null }],
      ['receiveBlockNumber', { receiveBlockNumber: null }],
    ];

    for (const [field, update] of attemptedClears) {
      expect(() =>
        validateReceiptSyncEvidence(current, {
          receiptId: 'rcpt',
          revision: 10,
          status: 'CONFIRMED',
          ...update,
        }),
        `clearing ${field} must never succeed`,
      ).toThrow(/immutable once recorded/i);
    }
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
