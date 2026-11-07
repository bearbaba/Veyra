import {describe,it,expect,vi} from 'vitest';
import {keccak256} from 'viem';
import {v2RequestTypedData,v2RequestAuthorizationDigest,
 simulateV2RequestCandidate,LEGACY_VEYRA_SETTLEMENT}
 from '../mainnet/settlementV2Candidate';
const addr='0x1111111111111111111111111111111111111111';
const other='0x2222222222222222222222222222222222222222';
const token='0x3333333333333333333333333333333333333333';
const code='0x6001600055' as const;
const registry={address:addr,runtimeCodeHash:keccak256(code),usdc:token,
 chainId:5042 as const,reviewedByOwner:true as const};
const fields={payer:other,recipient:token,amount:10000n,
 ref:'0x'+'4'.repeat(64) as `0x${string}`,deadline:9999999999n};
const sig='0x'+'5'.repeat(130) as `0x${string}`;
const client={
 getChainId:vi.fn(async()=>5042),
 getCode:vi.fn(async()=>code),
 readContract:vi.fn(async()=>token),
 simulateContract:vi.fn(async()=>({request:{functionName:'payRequest'}})),
};
describe('V2 contract approval is never silently bypassed by a frontend flag',()=>{
 it('builds deterministic EIP712 digest bound to new contract, chain and payer',()=>{
  expect(v2RequestAuthorizationDigest(registry,fields)).toMatch(/^0x[0-9a-f]{64}$/);
  expect(v2RequestAuthorizationDigest(registry,fields)).not.toBe(
   v2RequestAuthorizationDigest({...registry,address:other},fields));
  expect(v2RequestAuthorizationDigest(registry,fields)).not.toBe(
   v2RequestAuthorizationDigest(registry,{...fields,amount:10001n}));
  expect(v2RequestTypedData(registry,fields).domain.version).toBe('2');
 });
 it('rejects legacy address, nonexistent code, and a wrong USDC contract',async()=>{
  expect(()=>v2RequestTypedData({...registry,address:LEGACY_VEYRA_SETTLEMENT},fields)).toThrow();
  expect(()=>v2RequestTypedData({...registry,reviewedByOwner:false as never},fields)).toThrow();
  await expect(simulateV2RequestCandidate(client as never,registry,fields,sig,1n)).resolves.toMatchObject({
   request:{functionName:'payRequest'}});
  await expect(simulateV2RequestCandidate({...client,getCode:async()=>'0x1234'} as never,
   registry,fields,sig,1n)).rejects.toThrow('runtime code hash');
  await expect(simulateV2RequestCandidate({...client,readContract:async()=>other} as never,
   registry,fields,sig,1n)).rejects.toThrow('canonical USDC');
 });
 it('does not invoke wallet simulation if deadline or chain invalid',async()=>{
  await expect(simulateV2RequestCandidate(client as never,registry,fields,sig,fields.deadline)).rejects.toThrow('expired');
  await expect(simulateV2RequestCandidate({...client,getChainId:async()=>8453} as never,
   registry,fields,sig,1n)).rejects.toThrow('chain mismatch');
 });
});
