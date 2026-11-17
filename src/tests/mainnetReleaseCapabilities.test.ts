import {describe,it,expect} from 'vitest';
import {MAINNET_CANARY_OWNER,MAINNET_CANARY_MAX_UNITS,
 MAINNET_SETTLEMENT_CANARY_ONLY,assertMainnetContractCanarySigningAllowed}
 from '../mainnet/releaseGates';
import {assertGatewayMainnetCanaryExecution} from '../mainnet/gatewayMainnetExecution';
describe('Gateway quote-only and Settlement contract canary remain separate',()=>{
 it('advertises the actual enforced Settlement canary, independent of generic flags',()=>{
  expect(MAINNET_SETTLEMENT_CANARY_ONLY).toBe(true);
  expect(()=>assertMainnetContractCanarySigningAllowed(
   '0x1111111111111111111111111111111111111111',10000n,'pay',false)).toThrow();
  expect(()=>assertMainnetContractCanarySigningAllowed(
   MAINNET_CANARY_OWNER,10001n,'pay',false)).toThrow();
  expect(()=>assertMainnetContractCanarySigningAllowed(
   MAINNET_CANARY_OWNER,10000n,'escrow',false)).toThrow();
 });
 it('Gateways quotes may be read-only but only the pilot wallet can sign',()=>{
  expect(()=>assertGatewayMainnetCanaryExecution(
   '0x1111111111111111111111111111111111111111',1n)).toThrow();
  expect(()=>assertGatewayMainnetCanaryExecution(
   MAINNET_CANARY_OWNER,MAINNET_CANARY_MAX_UNITS+1n)).toThrow();
  expect(()=>assertGatewayMainnetCanaryExecution(
   MAINNET_CANARY_OWNER,MAINNET_CANARY_MAX_UNITS)).not.toThrow();
 });
});
