import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {MAINNET_RECEIPT_ROUTES,verifyProductionMainnetRouting,type VercelRoutingConfig} from '../../server/services/mainnetReleaseRouting';
const read=(p:string)=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
const bff='https://veyra-mainnet-v1-bff.onrender.com';
describe('Veyra one official domain — isolated Mainnet API release gate',()=>{
 it('stages one official app behind the verified Mainnet BFF',()=>{
  const staged=JSON.parse(read('vercel.json')) as VercelRoutingConfig & {buildCommand:string};
  expect(verifyProductionMainnetRouting(staged,bff)).toEqual({ok:true,issues:[]});
  expect(staged.buildCommand).toContain('VITE_VEYRA_EMERGENCY_READ_ONLY=1');
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
