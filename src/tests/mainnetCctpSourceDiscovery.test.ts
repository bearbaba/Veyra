import {describe,expect,it,vi} from 'vitest';
import {CCTP_V2_BURN_EVENT,discoverOriginalCctpSource,type OriginalCctpSourceReader}
 from '../mainnet/discoverOriginalCctpBurn';

const owner='0x1111111111111111111111111111111111111111';
const token='0x2222222222222222222222222222222222222222';
const hashA='0x'+'ab'.repeat(32),hashB='0x'+'cd'.repeat(32);
const original={
 owner,sourceToken:token,destinationDomain:26,amount:100_000n,intentCreatedAt:2_000_000,
};
const validLog={
 transactionHash:hashA,args:{
  burnToken:token,amount:100_000n,depositor:owner,
  mintRecipient:'0x'+'0'.repeat(24)+owner.slice(2),destinationDomain:26,
 },
};
function reader(logs:typeof validLog[]=[]):OriginalCctpSourceReader{
 return {latestBlock:vi.fn(async()=>1000n),
  timestamp:vi.fn(async block=>1000+Number(block)*2),
  burnLogs:vi.fn(async()=>logs),
 };
}
describe('safe automatic original CCTP source discovery',()=>{
 it('uses the official CCTP V2 burn event, not a USDC Gateway deposit',()=>{
  expect(CCTP_V2_BURN_EVENT.name).toBe('DepositForBurn');
  expect(CCTP_V2_BURN_EVENT.inputs.some(x=>x.name==='depositor'&&x.indexed)).toBe(true);
 });
 it('accepts only one precise source burn in the bounded original-intent window',async()=>{
  const r=reader([validLog]);
  expect(await discoverOriginalCctpSource(r,original,3_000_000)).toBe(hashA);
  expect(r.burnLogs).toHaveBeenCalledTimes(1);
  const [from,to]=(r.burnLogs as ReturnType<typeof vi.fn>).mock.calls[0];
  expect(from).toBeGreaterThan(300n);
  expect(to).toBeLessThanOrEqual(1000n);
 });
 it('does not confuse Gateway, other recipients, networks or amounts',async()=>{
  for(const change of [
   {burnToken:'0x'+'33'.repeat(20)},
   {amount:99_999n},
   {destinationDomain:6},
   {mintRecipient:'0x'+'0'.repeat(24)+'44'.repeat(20)},
  ]){
   expect(await discoverOriginalCctpSource(reader([{...validLog,args:{...validLog.args,...change}}]),original,3_000_000)).toBeNull();
  }
 });
 it('never guesses between multiple plausible burns',async()=>{
  expect(await discoverOriginalCctpSource(reader([validLog,{...validLog,transactionHash:hashB}]),original,3_000_000)).toBeNull();
  expect(await discoverOriginalCctpSource(reader([{...validLog,transactionHash:'0x1234'}]),original,3_000_000)).toBeNull();
 });
 it('does not query old, future or invalid journal entries',async()=>{
  for(const changed of [
   {...original,intentCreatedAt:2_000_000-15*86400000},
   {...original,intentCreatedAt:3_100_000},
   {...original,sourceToken:'USDC'},
   {...original,amount:0n},
  ]){
   const r=reader([validLog]);
   expect(await discoverOriginalCctpSource(r,changed,3_000_000)).toBeNull();
   expect(r.latestBlock).not.toHaveBeenCalled();
  }
 });
});
