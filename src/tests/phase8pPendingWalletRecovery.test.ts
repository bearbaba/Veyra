import { afterEach, describe, expect, it, vi } from 'vitest';
import { awaitWalletResponse, WALLET_RESPONSE_TIMEOUT_MS } from '../identity-beta/protocol';
import { readFileSync } from 'node:fs';

describe('Phase 8P pending wallet request recovery', () => {
  afterEach(() => vi.useRealTimers());

  it('resolves a legitimate wallet response promptly and does not keep pending UI state', async () => {
    await expect(awaitWalletResponse(Promise.resolve('signed-result'), 50)).resolves.toBe('signed-result');
  });

  it('releases Veyra waiting state after an unresponsive injected-wallet promise', async () => {
    vi.useFakeTimers();
    let resolvePending!: (value: string) => void;
    const pending = new Promise<string>(resolve => { resolvePending = resolve; });
    const result = awaitWalletResponse(pending);
    const assertion = expect(result).rejects.toThrow('No response from your wallet');
    await vi.advanceTimersByTimeAsync(WALLET_RESPONSE_TIMEOUT_MS);
    await assertion;
    // A delayed MetaMask response is now detached; the prior operation is
    // not resurrected or automatically submitted to the identity backend.
    resolvePending('late-signature');
    await vi.runAllTimersAsync();
  });

  it('makes Stop waiting available while busy and avoids auto-replaying wallet or backend POSTs', () => {
    const app = readFileSync(new URL('../identity-beta/IdentityBetaApp.tsx', import.meta.url), 'utf8');
    const protocol = readFileSync(new URL('../identity-beta/protocol.ts', import.meta.url), 'utf8');
    expect(app).toContain('role="status" aria-live="polite"');
    expect(app).toContain('onClick={stopWaiting}>Stop waiting');
    expect(app).toContain('generation.current += 1;');
    expect(app).toContain('activeOperation.current += 1;');
    expect(app).toContain('if (operationId !== activeOperation.current) return;');
    expect(app).toContain('Waiting for MetaMask approval');
    expect(app).toContain('Submitting the signed identity claim');
    expect(protocol).toContain('await awaitWalletResponse(provider.request({');
    expect(protocol).toContain('No response from your wallet');
    expect(protocol).not.toContain("method: 'eth_sendTransaction'");
  });
});
