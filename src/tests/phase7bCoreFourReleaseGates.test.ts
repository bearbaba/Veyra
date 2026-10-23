import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { MAINNET_PROVIDER_MANIFEST } from '../providers/registry/mainnetProviderManifest';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

describe('Core Four App Kit release discipline — Pay, Unified, Bridge, Swap', () => {
  it('never confuses read-only wallet portfolio with Gateway custody/deposit/spend', () => {
    const unified = read('src/preview/PreviewUnified.tsx');
    const chainCatalog = read('src/preview/unifiedAssetCatalog.ts');
    expect(unified).toContain('Actual public Arc USDC balanceOf');
    expect(unified).toContain('Catalog only');
    expect(chainCatalog).toContain('CATALOG_ONLY');
    expect(unified + chainCatalog).not.toMatch(/kit\.unifiedBalance\.(deposit|spend|addDelegate)|\bdepositFor\s*\(/);
    expect(unified + chainCatalog).not.toMatch(/eth_sendTransaction|eth_signTypedData|personal_sign/);
    expect(read('docs/veyra-core-four-circle-kits.md')).toContain('seven-day withdrawal delay');
  });
  it('does not expose Earn, Borrow or Onramp as accepted payment features', () => {
    const app = read('src/preview/PreviewApp.tsx');
    expect(app).toContain("id: 'pay'");
    expect(app).toContain("id: 'unified'");
    expect(app).toContain("id: 'bridge'");
    expect(app).not.toMatch(/id: '(?:earn|borrow|onramp)'/);
    expect(app).toContain("useState<PreviewNetwork>('testnet')");
    expect(app).toContain('<PreviewMainnetPay/>');
    const mainnetUI = read('src/preview/PreviewMainnetSurfaces.tsx');
    expect(mainnetUI).not.toMatch(/eth_sendTransaction|kit\.earn\.|kit\.swap\.|kit\.bridge\./);
  });
  it('keeps all Mainnet financial providers disabled pending E2E acceptance', () => {
    expect(MAINNET_PROVIDER_MANIFEST.length).toBeGreaterThan(0);
    expect(MAINNET_PROVIDER_MANIFEST.every(item => !item.enabled)).toBe(true);
    expect(read('src/preview/PreviewServiceStatus.tsx')).toContain('Awaiting live acceptance');
  });
  it('retains Testnet as the public Vercel finance build without Mainnet or Earn flags', () => {
    const vercel = JSON.parse(read('vercel.json')) as { buildCommand?: string };
    expect(vercel.buildCommand).toContain('VITE_VEYRA_ENV=testnet');
    if (vercel.buildCommand?.includes('VITE_VEYRA_UNIFIED_STAGING=1')) {
      expect(vercel.buildCommand).toContain('VITE_VEYRA_UI_ONLY=0');
      expect(vercel.buildCommand).toContain('VITE_VEYRA_MAINNET_PAY=0');
      expect(JSON.parse(read('vercel.json')) as {rewrites?: unknown[]}).not.toHaveProperty('rewrites');
    } else {
      expect(vercel.buildCommand).toContain('VITE_VEYRA_UI_ONLY=1');
    }
    expect(vercel.buildCommand).not.toMatch(/MAINNET_PAY=1|EARN=1|SWAP=1|BRIDGE=1/);
  });
});
