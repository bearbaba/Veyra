import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PRODUCT_ASSETS } from '../config/productRegistry';
import { safeWalletIcon, sortWallets, type DiscoveredWallet } from '../preview/PreviewWallet';
import { UNIFIED_ASSETS, unifiedChains, filterUnifiedCatalog } from '../preview/unifiedAssetCatalog';

const read = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');

describe('Phase 7A — honest wallet and Unified discovery', () => {
  it('uses the existing product registry and never upgrades catalog metadata to financial permission', () => {
    expect(UNIFIED_ASSETS.map(x => x.symbol)).toEqual(PRODUCT_ASSETS.map(x => x.symbol));
    expect(UNIFIED_ASSETS.filter(x => x.status === 'USDC_BALANCE_READ').map(x => x.symbol)).toEqual(['USDC']);
    expect(UNIFIED_ASSETS.filter(x => x.status === 'CATALOG_ONLY').length).toBe(PRODUCT_ASSETS.length - 1);
    for (const asset of UNIFIED_ASSETS) {
      expect(asset.logoKey).toBeTruthy();
      expect(asset.name).toBeTruthy();
      expect(asset.symbol).toBeTruthy();
    }
    const publicUI = read('src/preview/PreviewUnified.tsx');
    expect(publicUI).toContain('Catalog only');
    expect(publicUI).toContain('balanceOf');
    expect(publicUI).not.toMatch(/eth_sendTransaction|eth_signTypedData|wallet_addEthereumChain|depositForBurn|receiveMessage/);
  });
  it('never shows Mainnet chains as Testnet and preserves Arc read-only chain identity', () => {
    const testnet = unifiedChains('testnet'), mainnet = unifiedChains('mainnet');
    expect(testnet.find(x => x.id === 'arc-testnet')?.chainId).toBe(5042002);
    expect(mainnet.find(x => x.id === 'arc-mainnet')?.chainId).toBe(5042);
    expect(testnet.find(x => x.id === 'ethereum-sepolia')?.chainId).toBe(11155111);
    expect(mainnet.find(x => x.id === 'base')?.chainId).toBe(8453);
    expect(testnet.every(x => x.network === 'testnet')).toBe(true);
    expect(mainnet.every(x => x.network === 'mainnet')).toBe(true);
    expect(testnet.filter(x => x.status === 'USDC_BALANCE_READ').length).toBe(2);
    expect(mainnet.filter(x => x.status === 'USDC_BALANCE_READ').length).toBe(2);
  });
  it('filters using ticker, name or chain ID; does not add arbitrary tokens', () => {
    expect(filterUnifiedCatalog(UNIFIED_ASSETS, '  UsDc ', x => x.symbol).map(x => x.symbol)).toEqual(['USDC']);
    expect(filterUnifiedCatalog(UNIFIED_ASSETS, 'fake-wallet-token').length).toBe(0);
    expect(filterUnifiedCatalog(unifiedChains('testnet'), '84532', x => String(x.chainId)).map(x => x.id)).toEqual(['base-sepolia']);
    expect(filterUnifiedCatalog(UNIFIED_ASSETS, '').length).toBe(PRODUCT_ASSETS.length);
  });
  it('only accepts short inline wallet icons; rejects external trackers, data scripts and oversized blobs', () => {
    expect(safeWalletIcon('https://evil.example/tracker.png')).toBeNull();
    expect(safeWalletIcon('javascript:alert(1)')).toBeNull();
    expect(safeWalletIcon('data:text/html;base64,PHNjcmlwdD4=')).toBeNull();
    expect(safeWalletIcon('data:image/png;base64,abcd')).toBe('data:image/png;base64,abcd');
    expect(safeWalletIcon('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=')).toBeTruthy();
    expect(safeWalletIcon('data:image/png;base64,' + 'A'.repeat(100_001))).toBeNull();
    expect(safeWalletIcon('')).toBeNull();
  });
  it('sorts wallet choices deterministically without removing installed providers', () => {
    const provider: DiscoveredWallet['provider'] = { request: () => Promise.resolve([]) };
    const names = ['Phantom', 'MetaMask', 'Keplr', 'Coinbase Wallet', 'Rabby'];
    const choices: DiscoveredWallet[] = names.map((name, i) => ({ id: String(i), name, icon: null, provider }));
    expect(sortWallets(choices).map(x => x.name)).toEqual(['MetaMask', 'Rabby', 'Coinbase Wallet', 'Phantom', 'Keplr']);
    expect(choices.map(x => x.name)).toEqual(names);
  });
  it('routes Unified in both environments and preserves existing financial gates', () => {
    const app = read('src/preview/PreviewApp.tsx');
    expect(app).toContain("{ id: 'unified', title: 'Unified'");
    expect(app).toContain('<PreviewUnified key="mainnet-unified" environment="mainnet"/>');
    expect(app).toContain('<PreviewUnified key="testnet-unified" environment="testnet"/>');
    expect(app).toContain("useState<PreviewNetwork>('testnet')");
    expect(app).toContain('<PreviewMainnetPay/>');
    expect(app).toContain('<PreviewTestnetPayPage />');
    const hosting = read('vercel.json');
    if (hosting.includes('VITE_VEYRA_IDENTITY_BETA=1')) {
      expect(hosting).toContain('VITE_VEYRA_ENV=testnet VITE_VEYRA_IDENTITY_BETA=1');
      expect(hosting).not.toContain('VITE_VEYRA_MAINNET_PAY=1');
    } else {
      expect(hosting).toContain('VITE_VEYRA_UI_ONLY=1');
    }
  });
});
