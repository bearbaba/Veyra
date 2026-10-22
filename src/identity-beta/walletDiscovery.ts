import type { BrowserProvider } from './protocol';

/**
 * EIP-6963 announces wallet providers without depending on competing writes
 * to window.ethereum. All metadata is extension-controlled, not trusted as
 * proof of wallet vendor identity; the user must review wallet popups.
 */
export interface DiscoveredIdentityWallet {
  id: string;
  name: string;
  provider: BrowserProvider;
}
export function parseAnnouncedIdentityWallet(raw: unknown): DiscoveredIdentityWallet | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const detail = raw as Record<string, unknown>;
  const info = detail.info;
  const provider = detail.provider;
  if (!info || typeof info !== 'object' || Array.isArray(info) ||
      !provider || typeof provider !== 'object' ||
      !('request' in provider) || typeof provider.request !== 'function') return null;
  const metadata = info as Record<string, unknown>;
  const uuid = metadata.uuid;
  const name = metadata.name;
  if (typeof uuid !== 'string' ||
      !/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(uuid) ||
      typeof name !== 'string' || name.trim().length < 2 || name.length > 80 ||
      /[\u0000-\u001f\u007f]/.test(name)) return null;
  return {
    id: uuid.toLowerCase(),
    name: name.trim(),
    provider: provider as BrowserProvider,
  };
}
