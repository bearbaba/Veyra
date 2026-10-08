import { describe, expect, it } from 'vitest';
import { buildSendSuggestions } from '../../server/services/sendSuggestionEngine';

describe('Phase 2D send suggestion engine', () => {
  const wallets = [
    { walletId: 'w_arc', walletAddress: '0x0000000000000000000000000000000000000001', chainId: 5042002 },
    { walletId: 'w_eth', walletAddress: '0x0000000000000000000000000000000000000002', chainId: 11155111 },
  ];

  it('prefers explicit recipient preference over same-chain when weighted strongly', () => {
    const result = buildSendSuggestions({
      senderChainId: 5042002, wallets,
      preference: { preferredChainId: 11155111, primaryWalletId: 'w_eth' },
      routes: [{ sourceChainId: 5042002, destinationChainId: 11155111, providerId: 'cctp-v2-bridge', feeUsd: 0.1, etaSeconds: 90, healthy: true }],
    });
    expect(result[0]?.label).toBe('RECOMMENDED');
    expect(result[0]?.walletId).toBe('w_eth');
  });

  it('falls back to same-chain when no preference exists', () => {
    const result = buildSendSuggestions({ senderChainId: 5042002, wallets, routes: [] });
    expect(result[0]?.walletId).toBe('w_arc');
    expect(result[0]?.providerId).toBe('direct-transfer');
  });

  it('drops unhealthy cross-chain routes', () => {
    const result = buildSendSuggestions({ senderChainId: 84532, wallets: [wallets[1]], routes: [{ sourceChainId: 84532, destinationChainId: 11155111, providerId: 'bridge', healthy: false }] });
    expect(result).toEqual([]);
  });
});
