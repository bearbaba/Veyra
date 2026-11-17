/**
 * Wallet network requirement for Swap/Bridge quotes when signing is unavailable (Preview, pause).
 *
 * Quoting from a source network needs the wallet on that network. Where signing is available
 * (Production) the app asks the wallet to switch, as it always has. Where it is not, the app must
 * not open wallet prompts for something that cannot proceed to signing, so it says which network
 * is needed and lets the user switch inside their own wallet. Nothing here switches networks,
 * validates anything, or relaxes a check: the wallet-address and network re-check still runs.
 */
const NAMES: Record<number, string> = { 1: 'Ethereum Mainnet', 5042: 'Arc Mainnet', 8453: 'Base Mainnet' };

export const networkName = (chainId: number): string => NAMES[chainId] ?? `network ${chainId}`;

/** Null when the wallet is already on the required network (or its network is not known yet). */
export function networkRequirement(currentChainId: number | undefined, requiredChainId: number): string | null {
  if (currentChainId === undefined || currentChainId === requiredChainId) return null;
  return `Your wallet is on ${networkName(currentChainId)}. Switch it to ${networkName(requiredChainId)} in your wallet to request this quote. Veyra does not change your network in Preview.`;
}
