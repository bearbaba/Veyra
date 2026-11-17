import {afterEach,describe,it,expect,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {fetchPublicMainnetCapabilities,parsePublicMainnetCapabilities}
 from '../mainnet/publicMainnetCapabilities';
const sample={
 ok:true,environment:'mainnet',databaseReachable:true,
 identity:{available:true},chat:{available:true},paymentRequests:{available:true},
 payJourneySync:{available:true},settlementReceipts:{available:true},
 x:{available:false},publicSettlementV2:{available:false,reason:'OWNER_REVIEW_AND_DEPLOY_REQUIRED'},
};
afterEach(()=>vi.unstubAllGlobals());
const byId=(rows:ReturnType<typeof parsePublicMainnetCapabilities>,key:string)=>
 rows.find(row=>row.id===key)?.status;

describe('Public Mainnet feature status: conservative release truth',()=>{
 it('shows public backend readiness without unlocking Settlement V2',()=>{
  const rows=parsePublicMainnetCapabilities(sample);
  expect(rows).toHaveLength(7);
  for(const key of ['identity','chat','paymentRequests','payJourneySync','settlementReceipts']){
   expect(byId(rows,key)).toBe('available');
  }
  expect(byId(rows,'x')).toBe('unavailable');
  expect(byId(rows,'publicSettlementV2')).toBe('unavailable');
 });
 it('never treats an untrusted, stale or partial status as a feature authorization',()=>{
  for(const data of [
   null,{...sample,ok:false},{...sample,environment:'testnet'},
   {...sample,databaseReachable:false},{ok:true,environment:'mainnet'},
   {ok:true,environment:'mainnet',databaseReachable:true,
    publicSettlementV2:{available:'true'}},
  ]){
   const rows=parsePublicMainnetCapabilities(data);
   expect(byId(rows,'publicSettlementV2')).toBe('unknown');
  }
  expect(byId(parsePublicMainnetCapabilities({...sample,x:{}}),'x')).toBe('unknown');
  expect(byId(parsePublicMainnetCapabilities({...sample,x:{available:false}}),'x')).toBe('unavailable');
 });
 it('uses only an unauthenticated GET, with cache bypass and same-origin policy',async()=>{
  const mock=vi.fn(()=>Promise.resolve(new Response(JSON.stringify(sample),{
   status:200,headers:{'content-type':'application/json'},
  })));
  vi.stubGlobal('fetch',mock);
  const rows=await fetchPublicMainnetCapabilities();
  expect(byId(rows,'identity')).toBe('available');
  expect(mock).toHaveBeenCalledWith('/api/health/capabilities',
   expect.objectContaining({method:'GET',credentials:'same-origin',cache:'no-store'}));
 });
 it('fails closed on HTML fallback, 503 or network errors',async()=>{
  for(const reply of [
   new Response('<html>Not a capability API</html>',{status:200,headers:{'content-type':'text/html'}}),
   new Response(JSON.stringify({ok:false}),{status:503,headers:{'content-type':'application/json'}}),
  ]){
   vi.stubGlobal('fetch',vi.fn(()=>Promise.resolve(reply)));
   expect((await fetchPublicMainnetCapabilities()).every(r=>r.status==='unknown')).toBe(true);
  }
  vi.stubGlobal('fetch',vi.fn(()=>Promise.reject(new Error('offline'))));
  expect((await fetchPublicMainnetCapabilities()).every(r=>r.status==='unknown')).toBe(true);
 });
 it('keeps status read-only, behind Settings details, and leaves signer gates unchanged',()=>{
  const view=readFileSync(new URL('../components/system/RuntimeStatusCard.tsx',import.meta.url),'utf8');
  expect(view).toContain('Live backend capabilities');
  expect(view).toContain('Backend availability does not authorize wallet signing');
  expect(view).toContain('fetchPublicMainnetCapabilities(controller.signal)');
  expect(view).toContain("item.status==='unavailable'?'Not enabled':'Unverified'");
  expect(view).not.toContain('eth_sendTransaction');
  const server=readFileSync(new URL('../../server/services/mainnetIdentityOnlyRoutes.ts',import.meta.url),'utf8');
  expect(server).toContain("'GET /api/health/capabilities'");
  expect(server).not.toContain("'GET /api/health/readiness'");
 });
});
