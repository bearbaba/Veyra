import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
const file=(path:string)=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

describe('Phase 15 — simple account experience, honest readiness and branded token identity',()=>{
  it('keeps essential wallet and verified ID actions prominent, hides only developer metadata',()=>{
    const settings=file('components/pages/SettingsPage.tsx');
    expect(settings).toContain('Copy Veyra ID');
    expect(settings).toContain('Disconnect wallet');
    expect(settings).toContain('await social.signOut()');
    expect(settings).toContain("disabled={xCapability!=='available'");
    expect(settings).toContain('<RuntimeStatusCard />');
    expect(settings).toContain('Transaction protection');
    expect(settings).toContain('View protection rules and environment');
    expect(settings).toContain('Networks & assets');
    expect(settings).toContain('Arc Testnet USDC is enabled.');
    expect(settings).toContain('DEFAULT_VEYRA_POLICY.rules.slice(0, 6)');
    expect(settings).toContain('PRODUCT_NETWORKS.map(');
    expect(settings).toContain('PRODUCT_ASSETS.slice(0,5).map(');
    expect(settings).not.toContain('lg:grid-cols-[1.15fr_0.85fr]');
  });
  it('never calls UI-only or HTML fallback a verified online backend',()=>{
    const runtime=file('components/system/RuntimeStatusCard.tsx');
    expect(runtime).toContain("response.headers.get('content-type')");
    expect(runtime).toContain("typeof payload.ok!=='boolean'");
    expect(runtime).toContain('15000');
    expect(runtime).toContain('Retry check');
    expect(runtime).toContain('Backend rejected this Preview origin (403)');
    expect(runtime).toContain('Your wallet remains connected.');
    expect(runtime).not.toContain('controller.abort(), 3000');
    expect(runtime).not.toContain('eth_sendTransaction');
  });
  it('uses the installed tree-shakeable branded EURC logo and does not invent cirBTC/USYC artwork',()=>{
    const brand=file('components/brand/BrandLogo.tsx');
    expect(brand).toContain('TokenEURC');
    expect(brand).toContain('eurc: TokenEURC');
    expect(brand).not.toContain("eurc: 'https://");
    expect(brand).not.toContain("@web3icons/react/dynamic");
    expect(brand).toContain('case \x27usyc\x27:');
    const registry=file('config/productRegistry.ts');
    expect(registry).toContain("executionEnabled: false, logoKey: 'eurc'");
    expect(registry).toContain("executionEnabled: false, logoKey: 'usyc'");
  });
});
