import {describe,it,expect} from 'vitest';
import {settlementFundingShortfall,gatewayFundingGrossForNet,
 assertGatewayFundingNet} from '../mainnet/unifiedSettlementFunding';
import type {GatewaySdkFee} from '../core/gateway/gatewaySdkSpend';
const fees:GatewaySdkFee[]=[{type:'provider',amount:'0.0002',token:'USDC'}];
describe('Unified → Settlement quote protects the actual net amount',()=>{
 it('uses existing wallet USDC before requesting Gateway funds',()=>{
  expect(settlementFundingShortfall('0.01',9000n)).toBe('0.001');
  expect(settlementFundingShortfall('0.01',10000n)).toBe('0');
  expect(settlementFundingShortfall('0.01',11000n)).toBe('0');
  expect(settlementFundingShortfall('0.01',null)).toBeNull();
  expect(settlementFundingShortfall('not-an-amount',9000n)).toBeNull();
 });
 it('re-quotes enough gross to cover shortfall after fees',()=>{
  expect(gatewayFundingGrossForNet('0.001',fees,5000n)).toBe('0.0012');
  expect(()=>assertGatewayFundingNet('0.001',fees,'0.001')).toThrow();
  expect(()=>assertGatewayFundingNet('0.0012',fees,'0.001')).not.toThrow();
 });
 it('blocks insufficient Available and fee drift without wallet signing',()=>{
  expect(()=>gatewayFundingGrossForNet('0.001',fees,1100n)).toThrow();
  expect(()=>assertGatewayFundingNet('0.0012',
   [{type:'provider',amount:'0.0003',token:'USDC'}],'0.001')).toThrow();
  expect(()=>assertGatewayFundingNet('0.0012',[],'0.001')).toThrow();
 });
});
