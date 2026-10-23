import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {STAGING_APPROVED_REWRITES} from '../../scripts/stagingBffAllowlist';
const read=(p:string)=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
describe('dedicated Veyra Testnet staging web cannot silently promote mainnet or backend',()=>{
 it('builds full app only for isolated candidate, not the financial Production config',()=>{
  const c=JSON.parse(read('vercel.json')) as {
    buildCommand?:string;rewrites?:unknown[];env?:Record<string,string>;
  };
  expect(c.buildCommand).toBe('VITE_VEYRA_ENV=testnet VITE_VEYRA_UNIFIED_STAGING=1 VITE_VEYRA_UI_ONLY=0 VITE_VEYRA_MAINNET_MVP=0 VITE_VEYRA_MAINNET_PAY=0 VITE_VEYRA_IDENTITY_BETA=0 bun run build');
  expect(c.rewrites).toEqual(STAGING_APPROVED_REWRITES);
  expect(JSON.stringify(c.rewrites)).not.toContain('/api/:path*');
  expect(JSON.stringify(c.rewrites)).not.toContain('openai.com');
  expect(c.env).toBeUndefined();
 });
 it('dedicated release gate must be in CI and preserve original production gate elsewhere',()=>{
  const ci=read('.github/workflows/ci.yml');
  expect(ci).toContain('bun run scripts/check-unified-testnet-staging.ts');
  expect(ci).toContain('bun run scripts/check-unified-production-release.ts');
  expect(read('scripts/check-unified-testnet-staging.ts')).toContain("isExactStagingBffAllowlist(cfg.rewrites)");
  expect(read('scripts/check-unified-production-release.ts')).toContain("must(!config.rewrites?.length");
 });
});
