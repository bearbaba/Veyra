/**
 * Phase 1 — reconciliation authority model tests.
 *
 * Covers:
 *   A. Receipt reconciliation — authority classification
 *   B. Receipt reconciliation — field-level merge rules
 *   C. Status ordering correctness
 *   D. Authority model security tests (6 required cases)
 *   E. Identity record reconciliation (wallet/block/X binding)
 */
import { describe, it, expect } from 'vitest';
import {
  mergeReceipt,
  mergeIdentityRecord,
  type ServerReceiptSummary,
  type CachedIdentityRecord,
  type ServerIdentityRecord,
} from '../lib/db/reconciliation.js';
import type { CachedReceipt } from '../lib/db/indexedDbCache.js';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const ACK_CLIENT: CachedReceipt = {
  receiptId:       'rec_test1',
  clientIntentId:  '550e8400-e29b-41d4-a716-446655440000',
  status:          'BROADCAST',
  revision:        2,
  environment:     'testnet',
  senderAddress:   '0xabc',
  bffAcknowledged: true,
  updatedAt:       1_000_000,
  cachedAt:        1_000_000,
};

const UNACK_CLIENT: CachedReceipt = {
  ...ACK_CLIENT,
  bffAcknowledged: false,
  status:          'INTENT_CAPTURED',
  revision:        1,
};

const SERVER_AHEAD: ServerReceiptSummary = {
  receiptId:       'rec_test1',
  status:          'CONFIRMING',
  revision:        3,
  bffAcknowledged: true,
  burnTxHash:      '0xburn',
  updatedAt:       2_000_000,
};

const SERVER_EQUAL: ServerReceiptSummary = {
  receiptId:       'rec_test1',
  status:          'CONFIRMING',
  revision:        2,
  bffAcknowledged: true,
  burnTxHash:      '0xburn_server',
  updatedAt:       2_000_000,
};

// ── A. Receipt authority classification ──────────────────────────────────────

describe('A — authority classification', () => {
  it('CACHE_REFRESH when server revision > client revision', () => {
    const r = mergeReceipt(ACK_CLIENT, SERVER_AHEAD);
    expect(r.authority).toBe('CACHE_REFRESH');
  });

  it('SERVER_AUTHORITATIVE at equal revision with no conflict', () => {
    const r = mergeReceipt(ACK_CLIENT, SERVER_EQUAL);
    expect(r.authority).toBe('SERVER_AUTHORITATIVE');
  });

  it('PENDING_LOCAL_MUTATION when client not yet BFF-acknowledged', () => {
    const server: ServerReceiptSummary = { ...SERVER_AHEAD, bffAcknowledged: false };
    const r = mergeReceipt(UNACK_CLIENT, server);
    expect(r.authority).toBe('PENDING_LOCAL_MUTATION');
  });

  it('CACHE_REFRESH when unack client meets newly-acked server', () => {
    // BFF acknowledged between local write and this sync.
    const server: ServerReceiptSummary = { ...SERVER_AHEAD, bffAcknowledged: true };
    const r = mergeReceipt(UNACK_CLIENT, server);
    expect(r.authority).toBe('CACHE_REFRESH');
    expect(r.merged.bffAcknowledged).toBe(true);
  });

  it('CONFLICT_REQUIRES_REVALIDATION when client revision > server revision (acked)', () => {
    const serverBehind: ServerReceiptSummary = {
      ...SERVER_EQUAL,
      revision:        1,   // server behind
      bffAcknowledged: true,
    };
    const r = mergeReceipt(ACK_CLIENT, serverBehind);  // client rev=2, server rev=1
    expect(r.authority).toBe('CONFLICT_REQUIRES_REVALIDATION');
    expect(r.requiresRevalidation).toBe(true);
  });

  it('server COMPLETE wins and triggers revalidation when client was non-terminal', () => {
    // Server is at COMPLETE (terminal, revision 3); client was at BROADCAST (revision 2).
    // Server revision > client revision → CACHE_REFRESH path first, then
    // detectIdentityConflict fires because server is terminal and client was not.
    const serverTerminal: ServerReceiptSummary = {
      ...SERVER_AHEAD,
      status:   'COMPLETE',
      revision: 3,
    };
    const r = mergeReceipt(ACK_CLIENT, serverTerminal);  // client=BROADCAST
    // Terminal state reached while client didn't know → CONFLICT_REQUIRES_REVALIDATION.
    expect(r.authority).toBe('CONFLICT_REQUIRES_REVALIDATION');
    expect(r.requiresRevalidation).toBe(true);
    // The merged record must still reflect the server's COMPLETE status.
    expect(r.merged.status).toBe('COMPLETE');
  });
});

// ── B. Field-level merge ──────────────────────────────────────────────────────

describe('B — field-level merge (equal revision, acked)', () => {
  it('server bridge fields win over undefined client fields', () => {
    const r = mergeReceipt(ACK_CLIENT, SERVER_EQUAL);
    expect(r.merged.burnTxHash).toBe('0xburn_server');
  });

  it('client bridge fields preserved when server field is null', () => {
    const clientWithBurn: CachedReceipt = { ...ACK_CLIENT, burnTxHash: '0xclient_burn' };
    const serverNoBurn: ServerReceiptSummary = { ...SERVER_EQUAL, burnTxHash: null };
    const r = mergeReceipt(clientWithBurn, serverNoBurn);
    expect(r.merged.burnTxHash).toBe('0xclient_burn');
  });

  it('server resumePayload wins when present', () => {
    const serverResume: ServerReceiptSummary = { ...SERVER_EQUAL, resumePayload: { step: 'RELAY' } };
    const r = mergeReceipt(ACK_CLIENT, serverResume);
    expect(r.merged.resumePayload).toEqual({ step: 'RELAY' });
  });

  it('client resumePayload preserved when server has none', () => {
    const clientResume: CachedReceipt = { ...ACK_CLIENT, resumePayload: { step: 'RECEIVE' } };
    const serverNoResume: ServerReceiptSummary = { ...SERVER_EQUAL, resumePayload: null };
    const r = mergeReceipt(clientResume, serverNoResume);
    expect(r.merged.resumePayload).toEqual({ step: 'RECEIVE' });
  });

  it('updatedAt is max of client and server', () => {
    const r = mergeReceipt(ACK_CLIENT, SERVER_EQUAL);
    expect(r.merged.updatedAt).toBe(Math.max(1_000_000, 2_000_000));
  });
});

// ── C. Status ordering ────────────────────────────────────────────────────────

describe('C — status ordering (status never rolls back)', () => {
  const cases: Array<[string, string, string]> = [
    ['INTENT_CAPTURED', 'COMPLETE',     'COMPLETE'],
    ['COMPLETE',        'FAILED',       'COMPLETE'],  // COMPLETE outranks FAILED
    ['BROADCAST',       'CONFIRMING',   'CONFIRMING'],
    ['RECEIVE_PENDING', 'COMPLETE',     'COMPLETE'],
    ['BROADCAST',       'BROADCAST',    'BROADCAST'],
  ];

  for (const [clientStatus, serverStatus, expected] of cases) {
    it(`${clientStatus} vs ${serverStatus} → ${expected}`, () => {
      const client: CachedReceipt = { ...ACK_CLIENT, status: clientStatus, revision: 5 };
      const server: ServerReceiptSummary = { ...SERVER_EQUAL, status: serverStatus, revision: 5, bffAcknowledged: true };
      expect(mergeReceipt(client, server).merged.status).toBe(expected);
    });
  }
});

// ── D. Authority model security tests (6 required) ───────────────────────────

describe('D — security: forged client revision cannot overwrite server-authoritative state', () => {
  /**
   * D1. Forged higher client revision cannot restore a revoked wallet.
   *
   * Scenario: the server has REVOKED a wallet (terminal identity state).
   * A malicious or stale client cache has a higher revision and ACTIVE status.
   * The server's REVOKED state must always win.
   */
  it('D1: forged higher client revision cannot restore a revoked wallet', () => {
    const clientActiveHighRev: CachedIdentityRecord = {
      recordId:   'wlt_abc',
      recordType: 'WALLET_BINDING',
      revision:   99,    // attacker forged a high revision
      status:     'ACTIVE',
      data:       { walletAddress: '0xfake' },
      cachedAt:   Date.now(),
    };
    const serverRevoked: ServerIdentityRecord = {
      recordId:   'wlt_abc',
      recordType: 'WALLET_BINDING',
      revision:   3,
      status:     'REVOKED',
      data:       { walletAddress: '0xfake', revokedAt: '2026-01-01T00:00:00Z' },
      updatedAt:  Date.now(),
    };

    const r = mergeIdentityRecord(clientActiveHighRev, serverRevoked);
    expect(r.merged.status).toBe('REVOKED');
    expect(r.requiresRevalidation).toBe(true);
    expect(r.authority).toBe('CONFLICT_REQUIRES_REVALIDATION');
  });

  /**
   * D2. Stale client cannot undo a block.
   *
   * Scenario: user A blocked user B on the server. A stale client cache
   * still has the block as UNBLOCKED. The server's BLOCKED state wins.
   */
  it('D2: stale client cannot undo a server-side block', () => {
    const clientUnblocked: CachedIdentityRecord = {
      recordId:   'blk_xyz',
      recordType: 'SOCIAL_BLOCK',
      revision:   1,
      status:     'UNBLOCKED',
      data:       {},
      cachedAt:   Date.now() - 60_000,
    };
    const serverBlocked: ServerIdentityRecord = {
      recordId:   'blk_xyz',
      recordType: 'SOCIAL_BLOCK',
      revision:   2,
      status:     'BLOCKED',
      data:       { blockedAt: '2026-10-08T00:00:00Z' },
      updatedAt:  Date.now(),
    };

    const r = mergeIdentityRecord(clientUnblocked, serverBlocked);
    expect(r.merged.status).toBe('BLOCKED');
    expect(r.requiresRevalidation).toBe(true);
  });

  /**
   * D3. Stale client cannot replace an X binding.
   *
   * Scenario: the user's X account was revoked/unlinked on the server.
   * A stale client cache still holds an ACTIVE linked identity record.
   * The server's REVOKED state wins; the client must not restore the binding.
   */
  it('D3: stale client cannot restore a revoked X binding', () => {
    const clientXActive: CachedIdentityRecord = {
      recordId:   'lid_x123',
      recordType: 'LINKED_IDENTITY',
      revision:   2,
      status:     'ACTIVE',
      data:       { provider: 'X', externalId: 'x_12345' },
      cachedAt:   Date.now() - 120_000,
    };
    const serverXRevoked: ServerIdentityRecord = {
      recordId:   'lid_x123',
      recordType: 'LINKED_IDENTITY',
      revision:   3,
      status:     'REVOKED',
      data:       { provider: 'X', externalId: 'x_12345', revokedAt: '2026-10-08T00:00:00Z' },
      updatedAt:  Date.now(),
    };

    const r = mergeIdentityRecord(clientXActive, serverXRevoked);
    expect(r.merged.status).toBe('REVOKED');
    expect(r.merged.data['revokedAt']).toBe('2026-10-08T00:00:00Z');
    expect(r.requiresRevalidation).toBe(true);
  });

  /**
   * D4. Pending receipt recovery payload survives reload.
   *
   * Scenario: a bridge burn fired but BFF was not running (as in the real
   * CCTP incident). The receipt is cached locally as PENDING_LOCAL_MUTATION
   * (bffAcknowledged=false). On reload the server has no record. The local
   * recovery payload must be preserved intact.
   */
  it('D4: pending receipt recovery payload survives reload (PENDING_LOCAL_MUTATION)', () => {
    const localPending: CachedReceipt = {
      receiptId:       'rec_cctp1',
      clientIntentId:  '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
      status:          'BROADCAST',
      revision:        1,
      environment:     'testnet',
      senderAddress:   '0x4C7cb73aC8F8999af21cFC9fF4cF2333a9508Dcb',
      bffAcknowledged: false,
      burnTxHash:      '0xec4930ae7c9ac9e85c13c088d187a8a0403b2a4f17369cfdcfec1dd4702c3b92',
      resumePayload:   { step: 'AWAIT_ATTESTATION', burnTxHash: '0xec4930ae...' },
      updatedAt:       Date.now() - 5_000,
      cachedAt:        Date.now() - 5_000,
    };

    // Server has no record (returns a stub with bffAcknowledged=false).
    const serverNoRecord: ServerReceiptSummary = {
      receiptId:       'rec_cctp1',
      status:          'INTENT_CAPTURED',
      revision:        0,
      bffAcknowledged: false,
      updatedAt:       0,
    };

    const r = mergeReceipt(localPending, serverNoRecord);
    expect(r.authority).toBe('PENDING_LOCAL_MUTATION');
    // clientIntentId must be stable
    expect(r.merged.clientIntentId).toBe('6ba7b810-9dad-11d1-80b4-00c04fd430c8');
    // burnTxHash must be preserved
    expect(r.merged.burnTxHash).toBe('0xec4930ae7c9ac9e85c13c088d187a8a0403b2a4f17369cfdcfec1dd4702c3b92');
    // resumePayload must be intact
    expect(r.merged.resumePayload).toEqual({ step: 'AWAIT_ATTESTATION', burnTxHash: '0xec4930ae...' });
    expect(r.requiresRevalidation).toBe(false);
  });

  /**
   * D5. Confirmed server receipt wins over conflicting local cache.
   *
   * Scenario: the server has a COMPLETE receipt. The local cache has a
   * stale RECEIVE_PENDING record with a higher revision number. The server's
   * COMPLETE state must win; the local version must not be used.
   */
  it('D5: confirmed server receipt wins over stale local cache at higher revision', () => {
    const localStale: CachedReceipt = {
      receiptId:       'rec_comp1',
      clientIntentId:  '7c9e6679-7425-40de-944b-e07fc1f90ae7',
      status:          'RECEIVE_PENDING',
      revision:        10,   // stale local copy has higher revision
      environment:     'testnet',
      senderAddress:   '0xabc',
      bffAcknowledged: true,
      updatedAt:       Date.now() - 10_000,
      cachedAt:        Date.now() - 10_000,
    };
    const serverComplete: ServerReceiptSummary = {
      receiptId:       'rec_comp1',
      status:          'COMPLETE',
      revision:        8,    // server revision is lower but COMPLETE is terminal
      bffAcknowledged: true,
      receiveTxHash:   '0x586024ec593593a98c998ec00ea1c4ccf2ed685b81cd55f34107ff89e74542de',
      updatedAt:       Date.now(),
    };

    const r = mergeReceipt(localStale, serverComplete);
    // Server's COMPLETE wins regardless of revision difference.
    expect(r.merged.status).toBe('COMPLETE');
    expect(r.merged.receiveTxHash).toBe('0x586024ec593593a98c998ec00ea1c4ccf2ed685b81cd55f34107ff89e74542de');
    expect(r.authority).toBe('CONFLICT_REQUIRES_REVALIDATION');
    expect(r.requiresRevalidation).toBe(true);
  });

  /**
   * D6. clientIntentId remains stable through recovery.
   *
   * Scenario: a receipt starts as PENDING_LOCAL_MUTATION with a
   * clientIntentId. The BFF later acknowledges it. Through merges at
   * various stages the clientIntentId must never change.
   */
  it('D6: clientIntentId is stable through PENDING → CACHE_REFRESH → SERVER_AUTHORITATIVE', () => {
    const INTENT_ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';

    const draft: CachedReceipt = {
      receiptId:       'rec_d6',
      clientIntentId:  INTENT_ID,
      status:          'INTENT_CAPTURED',
      revision:        1,
      environment:     'testnet',
      senderAddress:   '0xdef',
      bffAcknowledged: false,
      updatedAt:       1_000,
      cachedAt:        1_000,
    };

    // Step 1: BFF acknowledges — transitions from PENDING to CACHE_REFRESH.
    const ackServer: ServerReceiptSummary = {
      receiptId:       'rec_d6',
      status:          'BROADCAST',
      revision:        2,
      bffAcknowledged: true,
      updatedAt:       2_000,
    };
    const step1 = mergeReceipt(draft, ackServer);
    expect(step1.authority).toBe('CACHE_REFRESH');
    expect(step1.merged.clientIntentId).toBe(INTENT_ID);

    // Step 2: server updates to CONFIRMING.
    const confirmServer: ServerReceiptSummary = {
      receiptId:       'rec_d6',
      status:          'CONFIRMING',
      revision:        3,
      bffAcknowledged: true,
      updatedAt:       3_000,
    };
    const step2 = mergeReceipt(step1.merged, confirmServer);
    expect(step2.merged.clientIntentId).toBe(INTENT_ID);

    // Step 3: server reaches COMPLETE.
    const completeServer: ServerReceiptSummary = {
      receiptId:       'rec_d6',
      status:          'COMPLETE',
      revision:        4,
      bffAcknowledged: true,
      receiveTxHash:   '0xabc123',
      updatedAt:       4_000,
    };
    const step3 = mergeReceipt(step2.merged, completeServer);
    expect(step3.merged.clientIntentId).toBe(INTENT_ID);
    expect(step3.merged.status).toBe('COMPLETE');
  });
});

// ── E. Identity record reconciliation ────────────────────────────────────────

describe('E — identity record reconciliation (server always authoritative)', () => {
  it('server wins when server revision > client revision', () => {
    const client: CachedIdentityRecord = {
      recordId: 'wlt_1', recordType: 'WALLET_BINDING',
      revision: 1, status: 'ACTIVE', data: {}, cachedAt: 0,
    };
    const server: ServerIdentityRecord = {
      recordId: 'wlt_1', recordType: 'WALLET_BINDING',
      revision: 2, status: 'ACTIVE', data: { chain: '5042002' }, updatedAt: 0,
    };
    const r = mergeIdentityRecord(client, server);
    expect(r.authority).toBe('SERVER_AUTHORITATIVE');
    expect(r.merged.revision).toBe(2);
    expect(r.merged.data['chain']).toBe('5042002');
  });

  it('server wins when client revision > server revision (no client-wins path)', () => {
    const client: CachedIdentityRecord = {
      recordId: 'wlt_2', recordType: 'WALLET_BINDING',
      revision: 5, status: 'ACTIVE', data: {}, cachedAt: 0,
    };
    const server: ServerIdentityRecord = {
      recordId: 'wlt_2', recordType: 'WALLET_BINDING',
      revision: 2, status: 'ACTIVE', data: { chain: '1' }, updatedAt: 0,
    };
    const r = mergeIdentityRecord(client, server);
    expect(r.authority).toBe('CONFLICT_REQUIRES_REVALIDATION');
    // Server data still wins.
    expect(r.merged.revision).toBe(server.revision);
    expect(r.requiresRevalidation).toBe(true);
  });

  it('REVOKED terminal state always wins, revalidation required', () => {
    const client: CachedIdentityRecord = {
      recordId: 'wlt_3', recordType: 'WALLET_BINDING',
      revision: 1, status: 'ACTIVE', data: {}, cachedAt: 0,
    };
    const server: ServerIdentityRecord = {
      recordId: 'wlt_3', recordType: 'WALLET_BINDING',
      revision: 1, status: 'REVOKED', data: {}, updatedAt: 0,
    };
    const r = mergeIdentityRecord(client, server);
    expect(r.merged.status).toBe('REVOKED');
    expect(r.requiresRevalidation).toBe(true);
  });

  it('no revalidation when client was already at same terminal state', () => {
    const client: CachedIdentityRecord = {
      recordId: 'blk_4', recordType: 'SOCIAL_BLOCK',
      revision: 2, status: 'BLOCKED', data: {}, cachedAt: 0,
    };
    const server: ServerIdentityRecord = {
      recordId: 'blk_4', recordType: 'SOCIAL_BLOCK',
      revision: 2, status: 'BLOCKED', data: {}, updatedAt: 0,
    };
    const r = mergeIdentityRecord(client, server);
    expect(r.requiresRevalidation).toBe(false);
  });
});
