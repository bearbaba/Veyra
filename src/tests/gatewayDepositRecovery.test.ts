import {describe,expect,it} from 'vitest';
import {encodeFunctionData} from 'viem';
import {GATEWAY_TESTNET_SOURCES,GATEWAY_TESTNET_WALLET} from '../core/gateway/gatewayBalances';
import {GATEWAY_DEPOSIT_ABI,isMatchingGatewayDepositTransaction} from '../core/gateway/gatewayDepositRecovery';

const owner='0x4C7cb73aC8F8999af21cfc9fF4cF2333a9508Dcb';
const alternate='0x1111111111111111111111111111111111111111';
const source=GATEWAY_TESTNET_SOURCES[0];
const checkpoint={owner,chainId:source.chainId,amount:'1.000001'};
const tx=()=>({
 from:owner,to:GATEWAY_TESTNET_WALLET,
 input:encodeFunctionData({abi:GATEWAY_DEPOSIT_ABI,functionName:'deposit',
   args:[source.token,1000001n]}),
});
describe('Gateway pending deposit recovery',()=>{
 it('accepts only a matching signer, gateway, pinned USDC and exact amount',()=>{
  expect(isMatchingGatewayDepositTransaction(tx(),checkpoint)).toBe(true);
 });
 it('rejects an unrelated successful receipt, including different sender/receiver',()=>{
  expect(isMatchingGatewayDepositTransaction({...tx(),from:alternate},checkpoint)).toBe(false);
  expect(isMatchingGatewayDepositTransaction({...tx(),to:alternate},checkpoint)).toBe(false);
 });
 it('rejects mismatched method payload, token, amount and chain',()=>{
  expect(isMatchingGatewayDepositTransaction({...tx(),input:'0x'},checkpoint)).toBe(false);
  expect(isMatchingGatewayDepositTransaction({...tx(),input:encodeFunctionData({
    abi:GATEWAY_DEPOSIT_ABI,functionName:'deposit',args:[alternate,1000001n],
  })},checkpoint)).toBe(false);
  expect(isMatchingGatewayDepositTransaction({...tx(),input:encodeFunctionData({
    abi:GATEWAY_DEPOSIT_ABI,functionName:'deposit',args:[source.token,1000002n],
  })},checkpoint)).toBe(false);
  expect(isMatchingGatewayDepositTransaction(tx(),{...checkpoint,chainId:12345})).toBe(false);
 });
 it('rejects a malformed stored checkpoint',()=>{
  expect(isMatchingGatewayDepositTransaction(tx(),{...checkpoint,amount:'0'})).toBe(false);
 });
});
