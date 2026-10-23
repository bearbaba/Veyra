import { describe, expect, it } from 'vitest';
import {
  announcedIdentityWallet, discoveredIdentityWallets, walletToConnect, type IdentityWallet,
} from '../identity-beta/walletDiscovery';
import type { BrowserProvider } from '../identity-beta/protocol';

const walletA: BrowserProvider = { async request() { return ['0x1111111111111111111111111111111111111111']; } };
const walletB: BrowserProvider = { async request() { return ['0x2222222222222222222222222222222222222222']; } };
function announcement(name: string, uuid: string, provider: BrowserProvider) {
  return { detail: { info: { name, uuid, rdns: 'io.metamask' }, provider } };
}
const meta = announcement('MetaMask', '4d2ce4f1-0707-4623-a7d0-2c3115111e22', walletA);
const rabby = announcement('Rabby', '8c62f85c-0726-433b-95fb-4db3821f6811', walletB);

describe('Phase 8O safe multi-wallet identity selection', () => {
  it('collects separately announced EIP-6963 wallets despite shared window.ethereum', () => {
    const a = announcedIdentityWallet(meta);
    const b = announcedIdentityWallet(rabby);
    expect(a?.name).toBe('MetaMask');
    expect(b?.name).toBe('Rabby');
    const wallets = discoveredIdentityWallets(discoveredIdentityWallets([], b!), a!);
    expect(wallets).toHaveLength(2);
    expect(walletToConnect(wallets, b!.id).provider).toBe(walletB);
    expect(walletToConnect(wallets, a!.id).provider).toBe(walletA);
    expect(() => walletToConnect(wallets, '')).toThrow('Select the exact wallet');
  });

  it('upgrades legacy injected provider without losing its EIP-6963 identity', () => {
    const legacy: IdentityWallet = { id: 'legacy-injected', name: 'Legacy injected wallet (unidentified)', source: 'legacy', provider: walletA };
    const announced = announcedIdentityWallet(meta)!;
    const upgraded = discoveredIdentityWallets([legacy], announced);
    expect(upgraded).toHaveLength(1);
    expect(upgraded[0].name).toBe('MetaMask');
    expect(discoveredIdentityWallets(upgraded, legacy)).toEqual(upgraded);
  });

  it('refuses untrustworthy/malformed announced provider metadata and missing wallets', () => {
    for (const event of [
      null, {}, { detail: {} },
      announcement('<svg onload=alert(1)>', '4d2ce4f1-0707-4623-a7d0-2c3115111e22', walletA),
      announcement('MetaMask', 'malformed', walletA),
      { detail: { info: {name:'MetaMask',uuid:'4d2ce4f1-0707-4623-a7d0-2c3115111e22'},provider:{} } },
    ]) expect(announcedIdentityWallet(event)).toBeNull();
    expect(() => walletToConnect([], '')).toThrow('No browser wallet');
  });
});
