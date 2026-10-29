import {describe,it,expect} from 'vitest';
import {GATEWAY_TESTNET_SOURCES,parseGatewayBalances,isGatewayDepositAmount} from '../core/gateway/gatewayBalances';
const owner='0x4C7cb73aC8F8999af21cfc9fF4cF2333a9508Dcb';
const payload=()=>({ok:true,token:'USDC',readAt:Date.now(),
 balances:GATEWAY_TESTNET_SOURCES.map(s=>({domain:s.domain,depositor:owner,balance:'1.000001'}))});
describe('Circle Gateway funds must never be confused with wallet balances',()=>{
 it('sums verified deposited funds exactly in bigint base units',()=>{
  const v=parseGatewayBalances(payload(),owner);
  expect(v.available).toBe(3000003n);
  expect(v.sources.map(x=>x.domain)).toEqual([26,0,6]);
 });
 it('rejects missing domain and malformed amount rather than inventing zero',()=>{
  const missing=payload();missing.balances.pop();
  expect(()=>parseGatewayBalances(missing,owner)).toThrow(/missing/);
  const bad=payload();bad.balances[0].balance='1.0000001';
  expect(()=>parseGatewayBalances(bad,owner)).toThrow(/six-decimal/);
  const other=payload();other.balances[0].depositor='0x0000000000000000000000000000000000000001';
  expect(()=>parseGatewayBalances(other,owner)).toThrow(/missing/);
 });
 it('rejects duplicated rows, incorrect token and stale reads',()=>{
  const duplicate=payload();duplicate.balances.push(duplicate.balances[0]);
  expect(()=>parseGatewayBalances(duplicate,owner)).toThrow(/duplicated/);
  const invalid=payload();invalid.token='EURC';
  expect(()=>parseGatewayBalances(invalid,owner)).toThrow(/USDC/);
  const stale=payload();stale.readAt=Date.now()-120000;
  expect(()=>parseGatewayBalances(stale,owner)).toThrow(/stale/);
 });
 it('never accepts imprecise or nonpositive deposits',()=>{
  expect(isGatewayDepositAmount('0')).toBe(false);
  expect(isGatewayDepositAmount('1.1234567')).toBe(false);
  expect(isGatewayDepositAmount('-10')).toBe(false);
  expect(isGatewayDepositAmount('0.000001')).toBe(true);
 });
});