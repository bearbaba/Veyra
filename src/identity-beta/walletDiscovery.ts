import type { BrowserProvider } from './protocol';

/**
 * Multi-extension safe provider discovery (EIP-6963).
 * Wallet-disclosed metadata is display-only and never proof of wallet brand.
 * Identity requires a separate EIP-712 account-ownership signature.
 */
export interface IdentityWallet {
  id: string;
  name: string;
  provider: BrowserProvider;
  source: 'eip6963' | 'legacy';
}

const UUID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const NO_CONTROL = /^[^\u0000-\u001f\u007f<>]{1,60}$/;

export function announcedIdentityWallet(event: unknown): IdentityWallet | null {
  if (!event || typeof event !== 'object' || !('detail' in event)) return null;
  const detail = event.detail;
  if (!detail || typeof detail !== 'object' || !('info' in detail) || !('provider' in detail)) return null;
  const {info, provider} = detail;
  if (!info || typeof info !== 'object' || !('uuid' in info) || !('name' in info) ||
      typeof info.uuid !== 'string' || !UUID_RE.test(info.uuid) ||
      typeof info.name !== 'string' || !NO_CONTROL.test(info.name) ||
      !provider || typeof provider !== 'object' || !('request' in provider) ||
      typeof provider.request !== 'function') return null;
  return { id: 'eip6963:' + info.uuid, name: info.name, provider: provider as BrowserProvider, source: 'eip6963' };
}

export function discoveredIdentityWallets(existing: IdentityWallet[], wallet: IdentityWallet): IdentityWallet[] {
  // A provider can be both legacy injected and EIP-6963 announced.
  // Upgrade it to explicit metadata, avoiding duplicate selection entries.
  if (wallet.source === 'legacy' && existing.some(current =>
    current.provider === wallet.provider && current.source === 'eip6963')) return existing;
  const others = existing.filter(current => current.provider !== wallet.provider);
  if (others.some(current => current.id === wallet.id)) return existing;
  return [...others, wallet].sort((a,b) =>
    (a.source === 'eip6963' ? 0 : 1) - (b.source === 'eip6963' ? 0 : 1) ||
    a.name.localeCompare(b.name));
}

export function walletToConnect(wallets: IdentityWallet[], selectedId: string): IdentityWallet {
  const candidate = wallets.find(wallet => wallet.id === selectedId);
  if (candidate) return candidate;
  if (wallets.length === 1 && !selectedId) return wallets[0];
  throw new Error(wallets.length > 1
    ? 'Select the exact wallet extension (MetaMask, Rabby, etc.) before connecting. Never use an ambiguous injected wallet.'
    : 'No browser wallet was detected. Enable your wallet extension, then refresh this page.');
}

/**
 * One-click UX without provider confusion.
 * Prefer a uniquely announced MetaMask (a product choice, not a trusted
 * attestation). All subsequent account, chain and signer checks still use
 * that exact provider and fail closed.
 * When ambiguous, connect presents choices only after the initial click.
 */
export function quickConnectWallet(wallets: IdentityWallet[]): IdentityWallet | null {
  if (wallets.length === 1) return wallets[0];
  const announced = wallets.filter(wallet => wallet.source === 'eip6963');
  const metaMask = announced.filter(wallet => wallet.name.trim().toLowerCase() === 'metamask');
  if (metaMask.length === 1) return metaMask[0];
  if (announced.length === 1) return announced[0];
  return null;
}
