import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {MAINNET_RECEIPT_ROUTES,verifyProductionMainnetRouting,type VercelRoutingConfig} from '../../server/services/mainnetReleaseRouting';
const read=(p:string)=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
const bff='https://veyra-mainnet-internal.example.org';
describe('Veyra one official domain — isolated Mainnet API release gate',()=>{
 it('rejects current Mainnet app rewrites pointing at the legacy Testnet acceptance backend',()=>{
  const deployed=JSON.parse(read('vercel.json')) as VercelRoutingConfig;
  const result=verifyProductionMainnetRouting(deployed,bff);
  expect(result.ok).toBe(false);
  expect(result.issues.join(' ')).toContain('Unsafe API rewrite');
  expect(result.issues.join(' ')).toContain('/api/mainnet/pay/receipts');
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
