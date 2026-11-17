import {describe,it,expect} from 'vitest';
import {arcSharedUsdcFunding,quoteSettlementProtocolNet,assertArcLivePayFunds}
 from '../mainnet/arcSharedUsdcFunding';
describe('Arc has ONE USDC balance exposed via 18dp native and 6dp ERC-20',()=>{
 const quote=(native:bigint,erc:bigint,gas:bigint|null=100000000n,gross='0.01')=>
  arcSharedUsdcFunding({gross,nativeBalanceWei:native,
   erc20BalanceMicro:erc,gasPriceWei:gas});
 it('never adds native and ERC20, and reserves the same asset for gas',()=>{
  const x=quote(10000000000000000n,10000n);
  expect(x?.available).toBe('0.01');
  expect(x?.shortfall).not.toBe('0');
  expect(x?.gasReserve).toBe('0.000039');
  expect(x?.minimumTotal).toBe('0.010039');
 });
 it('preserves submicro precision and refuses conflicting native vs ERC20 reads',()=>{
  const near=quote(10000000000999999n,10000n);
  expect(near?.available).toBe('0.01');
  expect(quote(10000000000000000n,10003n)).toBeNull();
  expect(quote(10000000000000000n,10000n,null)).toBeNull();
 });
 it('shortfall respects existing Arc funds and the fee reserve',()=>{
  expect(quote(20000000000000000n,20000n)?.shortfall).toBe('0');
  expect(quote(0n,0n)?.shortfall).toBe('0.010039');
 });
 it('blocks Settlement if live Arc USDC, gas or review drift insufficient',()=>{
  const proof={grossMicro:10000n,nativeBalanceWei:12000000000000000n,
   erc20BalanceMicro:12000n,gasEstimateUnits:100000n,
   gasPriceWei:100000000n,reviewedGasWei:12000000000000n};
  expect(()=>assertArcLivePayFunds(proof)).not.toThrow();
  expect(()=>assertArcLivePayFunds({...proof,nativeBalanceWei:10000000000000000n,
   erc20BalanceMicro:10000n})).toThrow('network gas');
  expect(()=>assertArcLivePayFunds({...proof,erc20BalanceMicro:11996n})).toThrow('views disagree');
  expect(()=>assertArcLivePayFunds({...proof,gasPriceWei:300000000n})).toThrow('gas changed');
  expect(()=>assertArcLivePayFunds({...proof,reviewedGasWei:0n})).toThrow();
 });
 it('protocol fee is taken from gross, never an extra Arc debit',()=>{
  expect(quoteSettlementProtocolNet('100',100n)).toEqual({
   gross:'100',protocolFee:'1',recipientNet:'99'});
  expect(quoteSettlementProtocolNet('0.01',0n)?.recipientNet).toBe('0.01');
  expect(quoteSettlementProtocolNet('0.01',null)).toBeNull();
 });
});
