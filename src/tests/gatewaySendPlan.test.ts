import {describe,it,expect} from 'vitest';
import {formatUnits,keccak256,stringToHex} from 'viem';
import {
 allocateGatewaySend,buildGatewayBurnIntent,assertGatewayEstimateMatches,GATEWAY_EIP712,
} from '../core/gateway/gatewaySendPlan';
import {GATEWAY_TESTNET_SOURCES,GATEWAY_TESTNET_WALLET,GATEWAY_TESTNET_MINTER,
 type GatewayBalanceSnapshot} from '../core/gateway/gatewayBalances';
const owner='0x4C7cb73aC8F8999af21cfc9fF4cF2333a9508Dcb';
const recipient='0x1111111111111111111111111111111111111111';
const mk=(available:bigint[]):GatewayBalanceSnapshot=>({
 owner:owner.toLowerCase(),readAt:Date.now(),
 sources:GATEWAY_TESTNET_SOURCES.map((s,i)=>({chainId:s.chainId,domain:s.domain,available:available[i]})),
 available:available.reduce((v,x)=>v+x,0n),
});
const feeQuotes=()=>GATEWAY_TESTNET_SOURCES.map(s=>({
 domain:s.domain,maxFee:100000n,maxBlockHeight:123456789n,
}));
const prepare=(snapshot=mk([4_000_000n,3_000_000n,2_000_000n]),amount='5')=>({
 owner,recipient,destinationChainId:GATEWAY_TESTNET_SOURCES[2].chainId,
 amount,snapshot,quotes:feeQuotes(),
});
const salt=keccak256(stringToHex('unique signer-reviewed request'));
describe('Gateway source of funds is exact deposited USDC',()=>{
 it('allocates deterministic largest source first and reserves provider fee on each source',()=>{
  const result=allocateGatewaySend(prepare());
  expect(result).toHaveLength(2);
  expect(result.map(r=>r.domain)).toEqual([26,0]);
  expect(result.map(r=>r.value)).toEqual([3900000n,1100000n]);
  expect(result.reduce((s,r)=>s+r.value,0n)).toBe(5000000n);
  expect(result[0].value+result[0].maxFee).toBe(4_000_000n);
 });
 it('does not treat a unified aggregate as wallet funds or invent fee room',()=>{
  const request=prepare(mk([1_000_000n,0n,0n]),'1');
  expect(()=>allocateGatewaySend(request)).toThrow('GATEWAY_INSUFFICIENT_AVAILABLE_AFTER_FEES');
 });
 it('fails on old or another-owner balances and missing provider fee data',()=>{
  const p=prepare();
  expect(()=>allocateGatewaySend({...p,snapshot:{...p.snapshot,readAt:Date.now()-60_000}}))
   .toThrow('GATEWAY_BALANCE_UNVERIFIED_OR_STALE');
  expect(()=>allocateGatewaySend({...p,snapshot:{...p.snapshot,owner:recipient}}))
   .toThrow('GATEWAY_BALANCE_UNVERIFIED_OR_STALE');
  expect(()=>allocateGatewaySend({...p,quotes:p.quotes.slice(1)}))
   .toThrow('GATEWAY_ESTIMATE_MISSING_OR_DUPLICATED');
 });
 it('rejects unsupported destinations, malformed values and prices',()=>{
  expect(()=>allocateGatewaySend({...prepare(),destinationChainId:1})).toThrow('GATEWAY_DESTINATION_UNSUPPORTED');
  expect(()=>allocateGatewaySend(prepare(undefined,'0'))).toThrow('GATEWAY_AMOUNT_NONPOSITIVE');
  expect(()=>allocateGatewaySend(prepare(undefined,'1e5'))).toThrow('GATEWAY_AMOUNT_NOT_EXACT_USDC');
  expect(()=>allocateGatewaySend({...prepare(),quotes:feeQuotes().map(q=>({...q,maxFee:-1n}))}))
   .toThrow('GATEWAY_ESTIMATE_INVALID');
 });
 it('uses exact canonical EIP-712 BurnIntent fields and destination token',()=>{
  const p=prepare();
  const allocation=allocateGatewaySend(p)[0];
  const q=feeQuotes().find(x=>x.domain===allocation.domain)!;
  const intent=buildGatewayBurnIntent(allocation,p,q,salt);
  expect(intent.spec.version).toBe(1);
  expect(intent.spec.sourceDomain).toBe(26);
  expect(intent.spec.destinationDomain).toBe(6);
  expect(intent.spec.sourceContract.toLowerCase().endsWith(GATEWAY_TESTNET_WALLET.toLowerCase().slice(2))).toBe(true);
  expect(intent.spec.destinationContract.toLowerCase().endsWith(GATEWAY_TESTNET_MINTER.toLowerCase().slice(2))).toBe(true);
  expect(intent.spec.value).toBe(3900000n);
  expect(formatUnits(intent.maxFee,6)).toBe('0.1');
  expect(intent.spec.salt).toBe(salt);
  expect(GATEWAY_EIP712.primaryType).toBe('BurnIntent');
  expect(GATEWAY_EIP712.types.TransferSpec).toHaveLength(14);
  expect(()=>assertGatewayEstimateMatches(intent,intent)).not.toThrow();
  expect(()=>assertGatewayEstimateMatches(intent,{
   ...intent,spec:{...intent.spec,destinationRecipient:intent.spec.sourceDepositor},
  })).toThrow('GATEWAY_ESTIMATE_CHANGED_REVIEW_REQUIRED');
  expect(()=>buildGatewayBurnIntent(allocation,p,q,'0x1234'))
   .toThrow('GATEWAY_SALT_INVALID');
 });
});
