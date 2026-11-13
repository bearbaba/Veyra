import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {isMainnetIdentityOnlyRouteAllowed} from '../../server/services/mainnetIdentityOnlyRoutes';
const read=(p:string)=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
const routes=[
 ['GET','/api/social/payment-requests'],
 ['POST','/api/social/payment-requests/create'],
 ['POST','/api/social/payment-requests/review'],
 ['POST','/api/social/payment-requests/cancel'],
 ['POST','/api/social/payment-requests/claim'],
 ['POST','/api/social/payment-requests/attempt'],
] as const;
describe('Veyra signed request API end-to-end routing',()=>{
 it('every typed action is mapped in the BFF, identity allowlist and Vercel',()=>{
  const bff=read('server/bff.ts');
  const rewrites=(JSON.parse(read('vercel.json')) as {rewrites:{source:string}[]}).rewrites;
  for(const [method,route] of routes){
   expect(isMainnetIdentityOnlyRouteAllowed(method,route)).toBe(true);
   expect(bff).toContain("app."+method.toLowerCase()+"('"+route+"'");
   expect(rewrites.filter(x=>x.source===route)).toHaveLength(1);
  }
 });
 it('a message cannot mutate PAID, and financial relay stays excluded',()=>{
  const bff=read('server/bff.ts');
  expect(bff).toContain('getAuthenticatedVeyraUserId(req)');
  expect(isMainnetIdentityOnlyRouteAllowed('POST','/api/social/payment-requests/paid')).toBe(false);
  expect(isMainnetIdentityOnlyRouteAllowed('POST','/api/gateway/spend')).toBe(false);
 });
});
