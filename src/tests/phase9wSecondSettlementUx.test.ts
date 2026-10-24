import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  bindCurrentIdentityWallet, clearSignedIdentitySession, setSignedIdentitySession,
} from '../lib/api/liveIdentitySession';
import { finalizeVerifiedSecondSettlementRemote } from '../lib/api/bridgeRecoveryApi';

const PLAN = 'cctp-plan-1';
const HASH = '0x' + 'a'.repeat(64);
function authenticate() {
  bindCurrentIdentityWallet('0x1111111111111111111111111111111111111111:5042002:metamask');
  setSignedIdentitySession(
    'signed-wallet-owner-bearer',
    '0x1111111111111111111111111111111111111111:5042002:metamask',
  );
}
const reply = (status: number, body: object): Response => ({
  ok: status < 400, status, json: async () => body,
}) as Response;
afterEach(() => {
  clearSignedIdentitySession();
  bindCurrentIdentityWallet('');
  vi.unstubAllGlobals();
});
describe('signed owner CCTP second mint finalization', () => {
  it('requires authentication before any HTTP request', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    await expect(finalizeVerifiedSecondSettlementRemote(PLAN))
      .rejects.toThrow('Authenticated owned bridge plan');
    expect(f).not.toHaveBeenCalled();
  });
  it('accepts only canonical BFF COMPLETE second-mint receipt evidence', async () => {
    authenticate();
    const f = vi.fn(async () => reply(200, {
      ok: true, planId: PLAN, receiptId: 'receipt-2', status: 'COMPLETE',
      settlementReceiveTxHash: HASH, settlementAttemptNumber: 2, retryAuthorized: false,
    }));
    vi.stubGlobal('fetch', f);
    await expect(finalizeVerifiedSecondSettlementRemote(PLAN)).resolves.toEqual({
      receiptId: 'receipt-2', settlementReceiveTxHash: HASH, status: 'COMPLETE',
    });
    expect(f).toHaveBeenCalledExactlyOnceWith('/api/bridge/finalize-second-settlement', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json',
        Authorization: 'Bearer signed-wallet-owner-bearer' },
      body: JSON.stringify({ planId: PLAN }),
    });
  });
  it('never claims success on unconfirmed, forged or wrong-plan results', async () => {
    authenticate();
    for (const value of [
      { ok: true, planId: PLAN, receiptId: 'x', status: 'SOURCE_CONFIRMED',
        settlementReceiveTxHash: HASH, settlementAttemptNumber: 2, retryAuthorized: false },
      { ok: true, planId: 'another', receiptId: 'x', status: 'COMPLETE',
        settlementReceiveTxHash: HASH, settlementAttemptNumber: 2, retryAuthorized: false },
      { ok: true, planId: PLAN, receiptId: 'x', status: 'COMPLETE',
        settlementReceiveTxHash: HASH, settlementAttemptNumber: 1, retryAuthorized: false },
      { ok: true, planId: PLAN, receiptId: 'x', status: 'COMPLETE',
        settlementReceiveTxHash: '0xabc', settlementAttemptNumber: 2, retryAuthorized: false },
      { ok: true, planId: PLAN, receiptId: 'x', status: 'COMPLETE',
        settlementReceiveTxHash: HASH, settlementAttemptNumber: 2, retryAuthorized: true },
    ]) {
      vi.stubGlobal('fetch', vi.fn(async () => reply(200, value)));
      await expect(finalizeVerifiedSecondSettlementRemote(PLAN)).rejects.toThrow('not yet verified');
    }
    vi.stubGlobal('fetch', vi.fn(async () => reply(503, { error: 'RPC_UNAVAILABLE' })));
    await expect(finalizeVerifiedSecondSettlementRemote(PLAN)).rejects.toThrow('not yet verified');
  });
  it('exposes only no-signing finalization after a previously recorded receive', () => {
    const page = readFileSync(new URL('../components/pages/ActivityPage.tsx', import.meta.url), 'utf8');
    expect(page).toContain("attemptHistory.second.state !== 'RECORDED'");
    expect(page).toContain('!attemptHistory?.first.reverted');
    expect(page).toContain('Verify second mint and complete receipt (no signing)');
    expect(page).not.toContain('retrySecondReceive(');
  });
});
