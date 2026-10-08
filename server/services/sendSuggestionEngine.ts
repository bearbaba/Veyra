export interface SuggestionWallet { walletId: string; walletAddress: string; chainId: number }
export interface SuggestionPreference { preferredChainId?: number; preferredTokenId?: string; primaryWalletId?: string }
export interface RouteOption { sourceChainId: number; destinationChainId: number; providerId: string; feeUsd?: number; etaSeconds?: number; healthy: boolean }
export interface SendSuggestion { label: 'RECOMMENDED' | 'SAME_CHAIN' | 'FASTEST'; destinationChainId: number; walletId: string; walletAddress: string; providerId: string; feeUsd: number | null; etaSeconds: number | null; score: number }

export function buildSendSuggestions(input: { senderChainId: number; wallets: SuggestionWallet[]; preference?: SuggestionPreference | null; routes: RouteOption[] }): SendSuggestion[] {
  const candidates: SendSuggestion[] = [];
  for (const wallet of input.wallets) {
    const sameChain = wallet.chainId === input.senderChainId;
    const route = sameChain
      ? { sourceChainId: input.senderChainId, destinationChainId: wallet.chainId, providerId: 'direct-transfer', feeUsd: 0, etaSeconds: 15, healthy: true }
      : input.routes.filter(r => r.sourceChainId === input.senderChainId && r.destinationChainId === wallet.chainId && r.healthy)
          .sort((a,b) => (a.feeUsd ?? Number.MAX_SAFE_INTEGER) - (b.feeUsd ?? Number.MAX_SAFE_INTEGER))[0];
    if (!route || !route.healthy) continue;
    const preferred = input.preference?.preferredChainId === wallet.chainId || input.preference?.primaryWalletId === wallet.walletId;
    const score = (preferred ? 100 : 0) + (sameChain ? 60 : 0) - (route.feeUsd ?? 5) * 3 - (route.etaSeconds ?? 600) / 60;
    candidates.push({ label: 'RECOMMENDED', destinationChainId: wallet.chainId, walletId: wallet.walletId, walletAddress: wallet.walletAddress, providerId: route.providerId, feeUsd: route.feeUsd ?? null, etaSeconds: route.etaSeconds ?? null, score });
  }
  candidates.sort((a,b) => b.score - a.score);
  if (!candidates.length) return [];
  const out: SendSuggestion[] = [{ ...candidates[0], label: 'RECOMMENDED' }];
  const same = candidates.find(c => c.destinationChainId === input.senderChainId && c.walletId !== out[0].walletId);
  if (same) out.push({ ...same, label: 'SAME_CHAIN' });
  const fastest = [...candidates].sort((a,b) => (a.etaSeconds ?? Number.MAX_SAFE_INTEGER) - (b.etaSeconds ?? Number.MAX_SAFE_INTEGER))[0];
  if (fastest && !out.some(x => x.walletId === fastest.walletId)) out.push({ ...fastest, label: 'FASTEST' });
  return out;
}
