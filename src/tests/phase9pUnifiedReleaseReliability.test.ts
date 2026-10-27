import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import type { VeyraReceipt } from '../core/receipt/receiptTypes';
import { getReceipt, saveReceipt } from '../core/receipt/receiptStore';
import { beginXLink } from '../lib/api/identityApi';
import { BFF_ORIGIN } from '../identity-beta/protocol';

const FROM = '0x1111111111111111111111111111111111111111';
const TO = '0x2222222222222222222222222222222222222222';
const OTHER = '0x3333333333333333333333333333333333333333';
const TOKEN = '0x3600000000000000000000000000000000000000';
const HASH = '0x' + 'a'.repeat(64);
const pending = (): VeyraReceipt => ({
  receiptId: 'veyra-regression-p9p', actionType: 'TRANSFER', status: 'PENDING',
  chainId: 5042002, ownerAddress: FROM, recipientAddress: TO, tokenAddress: TOKEN,
  tokenDecimals: 6, tokenSymbol: 'USDC', executionTxHash: HASH,
  expectedAmountDelta: 1000000n, actualAmountDelta: null,
  createdAt: 100, riskScore: null, policyDecision: null,
});
afterEach(() => vi.unstubAllGlobals());

function xAuthUrl() {
  const u = new URL('https://x.com/i/oauth2/authorize');
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', 'public-fixture');
  u.searchParams.set('redirect_uri', BFF_ORIGIN + '/api/auth/x/callback');
  u.searchParams.set('scope', 'tweet.read users.read');
  u.searchParams.set('state', 's'.repeat(43));
  u.searchParams.set('code_challenge', 'a'.repeat(43));
  u.searchParams.set('code_challenge_method', 'S256');
  return u.toString();
}

describe('Unified Veyra release regression', () => {
  it('uses Social for Home ID and never advertises unsupported X-handle payments', () => {
    const home = readFileSync(new URL('../components/pages/HomePage.tsx', import.meta.url), 'utf8');
    expect(home).not.toContain('CreateVeyraIdModal');
    expect(home).not.toContain('beginXLink');
    expect(home).not.toContain('X handle, wallet');
    expect(home).toContain("onNavigate('social')");
    expect(home).toContain('One verified identity for the connected wallet');
  });
  it('commits terminal Pay receipts and blocks stale Pending rollback in real IndexedDB', async () => {
    const initial = pending();
    await saveReceipt(initial);
    const verified: VeyraReceipt = {
      ...initial, status: 'VERIFIED', completedAt: 120,
      actualAmountDelta: 1000000n, executionBlock: 10,
    };
    await saveReceipt(verified);
    await expect(saveReceipt(initial)).rejects.toThrow(/aborted/);
    await expect(saveReceipt({ ...verified, ownerAddress: OTHER })).rejects.toThrow(/aborted/);
    await expect(saveReceipt({ ...verified, recipientAddress: OTHER })).rejects.toThrow(/aborted/);
    const recovered = await getReceipt(initial.receiptId);
    expect(recovered).toMatchObject({ status: 'VERIFIED', ownerAddress: FROM, actualAmountDelta: 1000000n });
  });
  it('explains unavailable X API instead of displaying a JSON parsing failure', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true, status: 200, json: () => Promise.reject(new SyntaxError("Unexpected token '<'")),
    })));
    await expect(beginXLink()).rejects.toThrow('X linking service is not available on this website');
  });
  it('allows only the expected official OAuth destination', async () => {
    const fetchMock = vi.fn(() => Promise.resolve({
      ok: true, status: 200, json: () => Promise.resolve({ ok: true, authorizeUrl: xAuthUrl() }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(beginXLink()).resolves.toBe(xAuthUrl());
    fetchMock.mockImplementation(() => Promise.resolve({
      ok: true, status: 200,
      json: () => Promise.resolve({ ok: true, authorizeUrl: 'https://evil.example/collect' }),
    }));
    await expect(beginXLink()).rejects.toThrow('Unexpected X OAuth destination');
  });
});
