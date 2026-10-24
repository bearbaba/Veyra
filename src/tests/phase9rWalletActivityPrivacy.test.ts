import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  activeSignedIdentityToken,
  bindCurrentIdentityWallet,
  clearSignedIdentitySession,
  setSignedIdentitySession,
} from '../lib/api/liveIdentitySession';
import {
  ActivityReceiptApiError,
  loadActivityReceiptsRemote,
  loadResumableActivityReceiptsRemote,
} from '../lib/api/activityReceiptApi';
import {
  bridgeCheckpointBelongsToWallet,
  type BridgeRecoveryCheckpoint,
} from '../core/execution/bridgeCheckpointStore';

const A = '0x1111111111111111111111111111111111111111';
const B = '0x2222222222222222222222222222222222222';
const walletKey = (address: string) => address.toLowerCase() + ':5042002:injected';
const source = (name: string) => readFileSync(new URL('../' + name, import.meta.url), 'utf8');
const response = (payload: unknown): Response => ({
  ok: true, status: 200, json: () => Promise.resolve(payload),
}) as Response;
const checkpoint: BridgeRecoveryCheckpoint = {
  planId: 'plan-1', stage: 'SOURCE_BROADCAST', sourceChainId: 5042002,
  destinationChainId: 84532, burnTxHash: '0x' + 'a'.repeat(64),
  walletAddress: A, recipientAddress: B,
  amount: '1000000', tokenAddress: '0x3600000000000000000000000000000000000000',
  balanceBefore: '2000000', createdAt: 100, updatedAt: 101,
};

afterEach(() => {
  clearSignedIdentitySession();
  bindCurrentIdentityWallet('');
  vi.unstubAllGlobals();
});
function signIn(address: string, token: string) {
  bindCurrentIdentityWallet(walletKey(address));
  setSignedIdentitySession(token, walletKey(address));
}

describe('Veyra owner-scoped Activity and Bridge recovery', () => {
  it('filters local bridge checkpoints by the exact connected wallet', () => {
    expect(bridgeCheckpointBelongsToWallet(checkpoint, A)).toBe(true);
    expect(bridgeCheckpointBelongsToWallet(checkpoint, A.toUpperCase().replace('0X', '0x'))).toBe(true);
    expect(bridgeCheckpointBelongsToWallet(checkpoint, B)).toBe(false);
    expect(bridgeCheckpointBelongsToWallet(checkpoint, undefined)).toBe(false);
    expect(bridgeCheckpointBelongsToWallet(checkpoint, 'not-an-address')).toBe(false);
  });

  it('drops a delayed Wallet A Activity response after switching to Wallet B', async () => {
    signIn(A, 'session-wallet-A');
    let reply: (value: Response) => void = () => { throw new Error('Deferred fetch was never initialized'); };
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => { reply = resolve; }));
    vi.stubGlobal('fetch', fetchMock);
    const inFlight = loadActivityReceiptsRemote();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(activeSignedIdentityToken()).toBe('session-wallet-A');
    signIn(B, 'session-wallet-B');
    reply(response({ receipts: [{ receiptId: 'private-a', senderAddress: A }] }));
    await expect(inFlight).rejects.toMatchObject({
      status: 401, code: 'SESSION_CHANGED',
    });
    expect(activeSignedIdentityToken()).toBe('session-wallet-B');
  });

  it('drops a delayed Wallet A resumable bridge response after logout', async () => {
    signIn(A, 'session-wallet-A');
    let reply: (value: Response) => void = () => { throw new Error('Deferred fetch was never initialized'); };
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { reply = resolve; })));
    const inFlight = loadResumableActivityReceiptsRemote();
    clearSignedIdentitySession();
    reply(response({ receipts: [{ receiptId: 'private-bridge', senderAddress: A }] }));
    await expect(inFlight).rejects.toMatchObject({ code: 'SESSION_CHANGED' });
  });

  it('rejects HTML fallback / malformed successful responses instead of false empty history', async () => {
    signIn(A, 'session-wallet-A');
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true, status: 200, json: () => Promise.reject(new SyntaxError("Unexpected token '<'")),
    })));
    await expect(loadActivityReceiptsRemote()).rejects.toMatchObject({
      status: 502, code: 'INVALID_API_RESPONSE',
    });
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(response({ ok: true }))));
    await expect(loadActivityReceiptsRemote()).rejects.toMatchObject({
      status: 502, code: 'INVALID_RECEIPT_RESPONSE',
    });
    await expect(loadResumableActivityReceiptsRemote()).rejects.toBeInstanceOf(ActivityReceiptApiError);
  });

  it('returns no backend data if there is no signed wallet session', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await loadActivityReceiptsRemote()).toEqual([]);
    expect(await loadResumableActivityReceiptsRemote()).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('guards rendered remote history before a wallet-switch effect and gates recovery actions', () => {
    const activity = source('components/pages/ActivityPage.tsx');
    const bridge = source('hooks/useBridgeExecution.ts');
    expect(activity).toContain('remoteView.scope === activeScope');
    expect(activity).toContain('remoteView.session === social.session');
    expect(activity).toContain('session: signedSession');
    expect(activity).toContain('viewIsCurrent && social.session ? remoteView.receipts : []');
    expect(activity).toContain('bridgeCheckpointBelongsToWallet(checkpoint, address)');
    expect(activity).toContain('connected={isConnected && Boolean(social.session)}');
    expect(bridge).toContain('if (!connectedOwner) return []');
    expect(bridge).toContain('bridgeCheckpointBelongsToWallet(checkpoint, walletClient.account.address)');
    expect(bridge).toContain('No wallet signature requested.');
    expect(bridge).toContain('loadResumableBridgeCheckpoints()).filter(belongsToOwner)');
    expect(bridge).toContain('loadRemoteBridgeCheckpoints()).filter(belongsToOwner)');
    expect(bridge).not.toContain('sendTransaction(');
  });
});
