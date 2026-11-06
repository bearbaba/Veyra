import {describe,it,expect,vi} from 'vitest';
import {fetchGatewayForwardingProof} from '../mainnet/gatewayMainnetProviderRead';
const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const hash='0x'+'f'.repeat(64);
const response=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status});
describe('Official Circle Gateway forwarding REST GET reads',()=>{
 it('loads transfer by UUID, then its exact transferSpecHash (read-only)',async()=>{
  const fetcher=vi.fn((url:string)=>Promise.resolve(url.includes('/transferSpec/')?
   response({value:'10000',sourceDomain:6}):
   response({status:'finalized',burnIntents:[{transferSpecHash:hash}]})));
  const result=await fetchGatewayForwardingProof(id,fetcher);
  expect(result).toMatchObject({transfer:{status:'finalized'},spec:{value:'10000'}});
  expect(fetcher.mock.calls.map(c=>c[0])).toEqual([
   'https://gateway-api.circle.com/v1/transfer/'+id,
   'https://gateway-api.circle.com/v1/transferSpec/'+hash]);
 });
 it('does not fetch spec or promote pending transfer to finalized',async()=>{
  const fetcher=vi.fn(()=>Promise.resolve(response({status:'pending',burnIntents:[]})));
  const result=await fetchGatewayForwardingProof(id,fetcher);
  expect(result).toMatchObject({transfer:{status:'pending'},spec:null});
  expect(fetcher).toHaveBeenCalledTimes(1);
 });
 it('rejects malformed IDs before any network request',async()=>{
  const fetcher=vi.fn();
  await expect(fetchGatewayForwardingProof('../../balance',fetcher as typeof fetch)).rejects.toThrow('UUID');
  expect(fetcher).not.toHaveBeenCalled();
 });
 it('preserves a pending lock on ambiguous/multiple burn intents',async()=>{
  const fetcher=vi.fn(()=>Promise.resolve(response({status:'finalized',
   burnIntents:[{transferSpecHash:hash},{transferSpecHash:hash}]})));
  await expect(fetchGatewayForwardingProof(id,fetcher as typeof fetch)).rejects.toThrow('burn-intent');
  expect(fetcher).toHaveBeenCalledTimes(1);
 });
 it('treats HTTP 404 as unavailable evidence, not a failed transfer or success',async()=>{
  const fetcher=vi.fn(()=>Promise.resolve(response({code:404},404)));
  await expect(fetchGatewayForwardingProof(id,fetcher as typeof fetch)).rejects.toThrow('(404)');
 });
});
