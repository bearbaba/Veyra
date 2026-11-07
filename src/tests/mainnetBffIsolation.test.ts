import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {MAINNET_RECEIPT_ROUTES,verifyProductionMainnetRouting,type VercelRoutingConfig} from '../../server/services/mainnetReleaseRouting';
const read=(p:string)=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
const bff='https://veyra-mainnet-v1-bff.onrender.com';
describe('Veyra one official domain — isolated Mainnet API release gate',()=>{
 it('stages one official app behind the verified Mainnet BFF',()=>{
  const staged=JSON.parse(read('vercel.json')) as VercelRoutingConfig & {buildCommand:string};
  expect(verifyProductionMainnetRouting(staged,bff)).toEqual({ok:true,issues:[]});
  expect(staged.buildCommand).toBe('bun run typecheck && bun scripts/build-mainnet-pilot.ts');
  const release=read('scripts/build-mainnet-pilot.ts');
  expect(release).toContain("VITE_VEYRA_EMERGENCY_READ_ONLY:'0'");
  expect(release).toContain("VITE_VEYRA_CANARY_ONLY:'1'");
  expect(release).toContain("VITE_VEYRA_MAINNET_PAY:'1'");
  expect(release).toContain("VITE_VEYRA_TESTNET_PAY:'0'");
  const settings=read('src/components/pages/SettingsPage.tsx');
  expect(settings).toContain('MAINNET_CANARY_ONLY?');
  expect(settings).toContain('0.01 USDC per payment');
  expect((staged.rewrites??[]).every(r=>r.destination.startsWith(bff+'/api/'))).toBe(true);
 });
 it('requires all critical endpoints to point to the same reviewed Mainnet BFF',()=>{
  const routes=MAINNET_RECEIPT_ROUTES.map(source=>({source,destination:bff+source}));
  expect(verifyProductionMainnetRouting({rewrites:routes},bff)).toEqual({ok:true,issues:[]});
  expect(verifyProductionMainnetRouting({rewrites:routes.slice(1)},bff).ok).toBe(false);
  expect(verifyProductionMainnetRouting({rewrites:[...routes,{source:'/api/health',
   destination:'https://old-testnet.onrender.com/api/health'}]},bff).ok).toBe(false);
 });
 it('never permits the Testnet backend, Preview, application origin or non-HTTPS',()=>{
  for(const unsafe of ['https://veyra-seven-beta.vercel.app',
    'https://veyra-testnet-acceptance-bff.onrender.com',
    'https://preview.example.com','http://example.com','https://localhost']){
   expect(verifyProductionMainnetRouting({rewrites:[]},unsafe).ok).toBe(false);
  }
 });
 it('packages the single pinned public Settlement ABI for read-only Mainnet backend verification',()=>{
  const docker=read('Dockerfile.bff.mainnet');
  const ignore=read('.dockerignore');
  const artifact=JSON.parse(read('contracts/contract-metadata/VeyraSettlement.json')) as {
   abi:Array<{type:string;name?:string}>;
  };
  expect(docker).toContain('COPY --chown=bun:bun contracts/contract-metadata/VeyraSettlement.json ./contracts/contract-metadata/VeyraSettlement.json');
  expect(ignore).toContain('!contracts/contract-metadata/VeyraSettlement.json');
  expect(ignore).toContain('contracts/contract-metadata/*');
  expect(artifact.abi.some(x=>x.type==='function'&&x.name==='pay')).toBe(true);
  expect(artifact.abi.some(x=>x.type==='event'&&x.name==='PaymentSettled')).toBe(true);
  const chainVerifier=read('server/services/mainnetSettlementProof.ts');
  expect(chainVerifier).toContain("from '../../src/config/veyraSettlement.js'");
 });
 it('a Mainnet container must use its own entrypoint and not the existing Testnet Dockerfile',()=>{
  const prod=read('Dockerfile.bff.mainnet');
  const init=read('server/mainnetBffEntrypoint.ts');
  expect(prod).toContain('VEYRA_ENV=mainnet');
  expect(prod).toContain('server/mainnetBffEntrypoint.ts');
  expect(init).toContain('assertServerRuntimeConfig()');
  expect(init).toContain('OFFICIAL_VEYRA_ORIGIN');
  expect(prod).not.toContain('RELAY_PRIVATE_KEY');
 });
});
