/**
 * Explicitly separate deploy-only staging safety gate, NEVER a Mainnet gate.
 * Uses the *full* App entry and testnet chain. The existing stable 'veyra'
 * Production deployment still uses the separate UI-only branch and guard.
 */
import {readFileSync} from 'node:fs';
import {isExactStagingBffAllowlist} from './stagingBffAllowlist';
const read=(p:string)=>readFileSync(p,'utf8');
const must=(condition:boolean,reason:string)=>{
  if(!condition)throw Error('[unified testnet staging] '+reason);
};
const cfg=JSON.parse(read('vercel.json')) as {
  buildCommand?:string;framework?:string;outputDirectory?:string;
  rewrites?:unknown[];headers?:unknown[];
};
const STAGE='VITE_VEYRA_ENV=testnet VITE_VEYRA_UNIFIED_STAGING=1 VITE_VEYRA_UI_ONLY=0 VITE_VEYRA_TESTNET_PAY=1 VITE_VEYRA_MAINNET_MVP=0 VITE_VEYRA_MAINNET_PAY=0 VITE_VEYRA_IDENTITY_BETA=0 bun run build';
must(cfg.buildCommand===STAGE,'Staging branch must explicitly compile full App for testnet and disable Mainnet signing');
must(cfg.framework==='vite'&&cfg.outputDirectory==='dist','Unexpected output runtime');
must(isExactStagingBffAllowlist(cfg.rewrites),
  'Staging may forward ONLY the precisely reviewed, HTTPS, identity/receipt API allowlist');
must(!Object.keys(cfg).some(k=>k==='env'||k==='routes'),'No secrets, custom routes or server keys in browser staging config');
must(read('src/App.tsx').includes('<UnifiedSocialProvider>'),'Must use real shared Social and Pay app');
must(read('src/App.tsx').includes("case 'social':"),'Social missing from unified dApp');
must(read('src/config.ts').includes('arcTestnet'),'Arc Testnet must be the wallet network');
must(read('src/lib/env.ts').includes('VITE_VEYRA_UI_ONLY'),'UI only must retain its independent guard');
must(read('src/providers/registry/mainnetProviderManifest.ts').includes('enabled: false'),'Mainnet financial provider must be disabled');
must(!/enabled:\s*true/.test(read('src/providers/registry/mainnetProviderManifest.ts')),'A Mainnet financial provider is enabled');
must(!cfg.rewrites?.some((item:unknown)=>typeof item==='object' && item!==null &&
  'source' in item && item.source==='/api/:path*'), 'Wildcard backend forwarding is forbidden');
console.log('[unified testnet staging] PASS: full App testnet build, exact audited BFF routes, no Mainnet signer, no production alias.');
