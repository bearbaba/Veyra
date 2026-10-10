import { describe, expect, it } from 'vitest';
import type { VeyraReceipt } from '../core/receipt/receiptTypes';
import {
  reconcileLocalReceiptStatus,
  reconcileVeyraReceipts,
} from '../core/receipt/receiptReconciliation';
import {
  buildReceiptSyncPayload,
  remoteActivityReceiptToVeyra,
  type RemoteReceiptRecord,
} from '../lib/api/activityReceiptApi';
import {
  parseActivityReceiptSyncBody,
} from '../../server/services/activityReceiptSyncService.js';
import {
  reconcileReceiptStatus,
} from '../../server/db/repositories/receiptRepository.js';

const FROM = '0x1111111111111111111111111111111111111111';
const TO = '0x2222222222222222222222222222222222222222';
const TOKEN = '0x3600000000000000000000000000000000000000';
const HASH =
  '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const INTENT = '550e8400-e29b-41d4-a716-446655440000';

function receipt(
  overrides: Partial<VeyraReceipt> = {},
): VeyraReceipt {
  return {
    receiptId: 'veyra-0123456789abcdef',
    planId: INTENT,
    actionType: 'TRANSFER',
    status: 'PENDING',
    syncRevision: 1,
    syncPending: true,
    chainId: 5042002,
    executionTxHash: HASH,
    createdAt: 1_700_000_000_000,
    actualAmountDelta: null,
    expectedAmountDelta: 1_000_000n,
    riskScore: null,
    policyDecision: null,
    transferTrace: {
      providerId: 'arc-erc20-transfer',
      tokenAddress: TOKEN,
      tokenDecimals: 6,
      fromAddress: FROM,
      recipientAddress: TO,
      amountRaw: '1000000',
      balanceBeforeRaw: '9000000',
    },
    executionContext: {
      surface: 'PAY',
      providerId: 'arc-erc20-transfer',
      routeId: `transfer:arc-erc20-transfer:5042002:${TOKEN}`,
      environment: 'testnet',
      senderAddress: FROM,
      recipientSnapshotId: null,
      recipientAddress: TO,
      recipientChainId: 5042002,
      assetId: 'usdc',
      tokenAddress: TOKEN,
      tokenDecimals: 6,
    },
    ...overrides,
  };
}

function remoteRow(
  overrides: Partial<RemoteReceiptRecord> = {},
): RemoteReceiptRecord {
  return {
    receiptId: 'veyra-0123456789abcdef',
    clientIntentId: INTENT,
    senderAddress: FROM,
    senderChainId: 5042002,
    recipientSnapshotId: null,
    recipientAddress: TO,
    recipientChainId: 5042002,
    amountRaw: '1000000',
    amountDecimals: 6,
    assetId: 'usdc',
    tokenAddress: TOKEN,
    providerId: 'arc-erc20-transfer',
    routeId: `transfer:arc-erc20-transfer:5042002:${TOKEN}`,
    quoteId: null,
    burnTxHash: null,
    burnChainId: null,
    burnBlockNumber: null,
    receiveTxHash: null,
    receiveChainId: null,
    receiveBlockNumber: null,
    environment: 'testnet',
    actionType: 'TRANSFER',
    surface: 'PAY',
    planId: INTENT,
    executionTxHash: HASH,
    executionBlock: null,
    actualAmountRaw: null,
    balanceBeforeRaw: '9000000',
    verifiedBalanceAfter: null,
    riskScore: null,
    policyDecision: null,
    displaySummary: null,
    status: 'BROADCAST',
    revision: 1,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_100,
    completedAt: null,
    failedAt: null,
    failureReason: null,
    ...overrides,
  };
}

describe('Phase 5 receipt reconciliation', () => {
  it('never lets stale local pending state regress a remote verified receipt', () => {
    const local = receipt({ syncRevision: 5, status: 'PENDING' });
    const remote = receipt({
      syncRevision: 4,
      syncPending: false,
      status: 'VERIFIED',
      actualAmountDelta: 1_000_000n,
    });

    const merged = reconcileVeyraReceipts(local, remote);
    expect(merged.status).toBe('VERIFIED');
    expect(merged.actualAmountDelta).toBe(1_000_000n);
  });

  it('keeps newer local metadata pending for remote sync', () => {
    const local = receipt({
      syncRevision: 3,
      syncPending: true,
      displaySummary: 'new local summary',
    });
    const remote = receipt({
      syncRevision: 2,
      syncPending: false,
      displaySummary: 'old remote summary',
    });

    const merged = reconcileVeyraReceipts(local, remote);
    expect(merged.syncRevision).toBe(3);
    expect(merged.syncPending).toBe(true);
    expect(merged.displaySummary).toBe('new local summary');
  });

  it('preserves recovery metadata when only one side has it', () => {
    const local = receipt();
    const remote = receipt({
      syncRevision: 2,
      syncPending: false,
      transferTrace: undefined,
    });

    expect(reconcileVeyraReceipts(local, remote).transferTrace).toEqual(
      local.transferTrace,
    );
  });

  it('rejects reconciliation across different receipt ids', () => {
    expect(() =>
      reconcileVeyraReceipts(
        receipt(),
        receipt({ receiptId: 'veyra-fedcba9876543210' }),
      ),
    ).toThrow(/receiptId mismatch/i);
  });

  it('orders browser receipt states without regression', () => {
    expect(
      reconcileLocalReceiptStatus('BRIDGE_UNCONFIRMED', 'BRIDGE_PENDING'),
    ).toBe('BRIDGE_UNCONFIRMED');
    expect(reconcileLocalReceiptStatus('PENDING', 'VERIFIED')).toBe('VERIFIED');
  });
});

describe('Phase 5 receipt sync payloads', () => {
  it('serializes durable transfer recovery metadata', () => {
    const payload = buildReceiptSyncPayload(receipt());
    expect(payload).toMatchObject({
      receiptId: 'veyra-0123456789abcdef',
      clientIntentId: INTENT,
      status: 'BROADCAST',
      balanceBeforeRaw: '9000000',
      amountRaw: '1000000',
      senderAddress: FROM,
      recipientAddress: TO,
    });
  });

  it('hydrates a remote pending transfer into a resumable Veyra receipt', () => {
    const hydrated = remoteActivityReceiptToVeyra(remoteRow());
    expect(hydrated).not.toBeNull();
    expect(hydrated).toMatchObject({
      actionType: 'TRANSFER',
      status: 'PENDING',
      syncRevision: 1,
      syncPending: false,
    });
    expect(hydrated?.transferTrace?.balanceBeforeRaw).toBe('9000000');
    expect(hydrated?.expectedAmountDelta).toBe(1_000_000n);
  });

  it('rejects malformed remote receipt addresses', () => {
    expect(
      remoteActivityReceiptToVeyra(
        remoteRow({ recipientAddress: 'not-an-address' }),
      ),
    ).toBeNull();
  });

  it('validates the BFF sync body before repository writes', () => {
    const payload = buildReceiptSyncPayload(receipt());
    expect(payload).not.toBeNull();
    const parsed = parseActivityReceiptSyncBody(
      payload as unknown as Record<string, unknown>,
    );
    expect(parsed.receiptId).toBe('veyra-0123456789abcdef');
    expect(parsed.balanceBeforeRaw).toBe('9000000');
  });

  it('rejects client attempts to change the receipt environment vocabulary', () => {
    const payload = buildReceiptSyncPayload(receipt());
    expect(payload).not.toBeNull();
    expect(() =>
      parseActivityReceiptSyncBody({
        ...(payload as unknown as ReceiptSyncObject),
        environment: 'local',
      }),
    ).toThrow(/environment must be testnet or mainnet/i);
  });
});

type ReceiptSyncObject = Record<string, unknown>;

describe('Phase 5 server receipt status reconciliation', () => {
  it('does not regress a terminal server status', () => {
    expect(reconcileReceiptStatus('COMPLETE', 'BROADCAST')).toBe('COMPLETE');
  });

  it('advances a nonterminal server receipt', () => {
    expect(reconcileReceiptStatus('BROADCAST', 'CONFIRMING')).toBe(
      'CONFIRMING',
    );
  });
});
