import {describe,expect,it,vi} from 'vitest';
import {findCctpDestinationMintHash} from '../mainnet/verifyCctpBridgeLink';
const source='0x'+'a'.repeat(64),mint='0x'+'b'.repeat(64);
describe('Mainnet Iris read-only recovery and strict mint linkage',()=>{
 it('uses CCTP source DOMAIN 6 rather than EVM chainId 8453',async()=>{
  const fetcher=vi.fn((_url:string)=>Promise.resolve(new Response(JSON.stringify({messages:[{
   status:'complete',sourceTxHash:source,destinationMintTxHash:mint,
  }]}),{status:200,headers:{'content-type':'application/json'}})));
  expect(await findCctpDestinationMintHash(8453,1,source,fetcher as typeof fetch)).toBe(mint);
  expect(fetcher.mock.calls[0]?.[0]).toContain('/v2/messages/6?transactionHash=');
 });
 it('never accepts an unrelated source hash, duplicate or unconfirmed mint hint',async()=>{
  const check=async(messages:unknown[])=>
   findCctpDestinationMintHash(1,8453,source,
    vi.fn(()=>Promise.resolve(new Response(JSON.stringify({messages}),{status:200}))));
  expect(await check([{status:'complete',sourceTxHash:'0x'+'c'.repeat(64),destinationMintTxHash:mint}])).toBeNull();
  expect(await check([{status:'pending',sourceTxHash:source,destinationMintTxHash:mint}])).toBeNull();
  expect(await check([
   {status:'complete',sourceTxHash:source,destinationMintTxHash:mint},
   {status:'complete',sourceTxHash:source,destinationMintTxHash:mint},
  ])).toBeNull();
 });
 it('rejects Arc Mainnet CCTP without calling Circle',async()=>{
  const fetcher=vi.fn();
  await expect(findCctpDestinationMintHash(5042,8453,source,fetcher as typeof fetch)).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
 });
});
