import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {parseGatewaySdkFees} from '../core/gateway/gatewaySdkSpend';
import {gatewaySpendQuoteSummary,gatewayFundingGrossForNet} from '../mainnet/unifiedSettlementFunding';

const view=readFileSync(new URL('../components/pages/MainnetUnifiedBalancePanel.tsx',import.meta.url),'utf8');
const execution=readFileSync(new URL('../mainnet/gatewayMainnetExecution.ts',import.meta.url),'utf8');

describe('Gateway exact net-review transparency and safe preflight',()=>{
 it('shows precise net for a 0.1 USDC spend without floating point drift',()=>{
  const fees=parseGatewaySdkFees([
   {type:'forwarder',token:'USDC',amount:'0.0006'},
   {type:'provider',token:'USDC',amount:'0.0004'},
  ]);
  const quote=gatewaySpendQuoteSummary('0.100000',fees);
  expect(quote).toMatchObject({
   grossUsdc:'0.1',quotedFeeUsdc:'0.001',minimumReceiveUsdc:'0.099',
  });
  expect(quote.burden?.level).toBe('high');
  const gross=gatewayFundingGrossForNet('0.099',fees,100000n);
  expect(gross).toBe('0.1');
 });
 it('accepts an independently quoted zero fee but never assumes gasless',()=>{
  const q=gatewaySpendQuoteSummary('0.01',parseGatewaySdkFees([
   {type:'forwarder',token:'USDC',amount:'0'},
  ]));
  expect(q.quotedFeeUsdc).toBe('0');
  expect(q.minimumReceiveUsdc).toBe('0.01');
  expect(q.burden?.level).toBe('normal');
  expect(view).toContain('Source gas and wallet approvals are separate');
 });
 it('blocks a spend whose quoted fees consume the whole transfer',()=>{
  const fees=parseGatewaySdkFees([{type:'forwarder',token:'USDC',amount:'0.1'}]);
  expect(()=>gatewaySpendQuoteSummary('0.1',fees)).toThrow('full transfer amount');
  expect(()=>gatewaySpendQuoteSummary('0.01',fees)).toThrow('full transfer amount');
  expect(()=>gatewaySpendQuoteSummary('0.000001',parseGatewaySdkFees([
   {type:'forwarder',token:'USDC',amount:'0.000001'},
  ]))).toThrow('full transfer amount');
 });
 it('refuses missing, malformed or wrong-currency fees instead of treating them as zero',()=>{
  expect(()=>gatewaySpendQuoteSummary('0.1',[])).toThrow('fee quote unavailable');
  expect(()=>gatewaySpendQuoteSummary('0',parseGatewaySdkFees([
   {type:'forwarder',token:'USDC',amount:'0'},
  ]))).toThrow('positive');
  expect(()=>gatewaySpendQuoteSummary('0.1000001',parseGatewaySdkFees([
   {type:'forwarder',token:'USDC',amount:'0'},
  ]))).toThrow('positive');
  expect(()=>parseGatewaySdkFees([{type:'forwarder',amount:'0.01',token:'ETH'}])).toThrow();
  expect(()=>parseGatewaySdkFees([{type:'forwarder',amount:'oops',token:'USDC'}])).toThrow();
  expect(()=>gatewaySpendQuoteSummary('0.1',[
   {type:'forwarder',amount:'-0.01',token:'USDC'},
  ])).toThrow('Unverified');
 });
 it('makes the fee preview user-visible while preserving existing execution locks',()=>{
  expect(view).toContain('gatewaySpendQuoteSummary(planned.amount,estimated)');
  expect(view).toContain("if(frozen.kind==='spend')gatewaySpendQuoteSummary(frozen.amount,frozen.fees)");
  expect(view).toContain('aria-label="Reviewed Gateway net amount"');
  expect(view).toContain('Minimum after quoted fees');
  expect(view).toContain('Estimated net, not a verified destination receipt.');
  expect(view).toContain("mode==='spend'&&!spendReview");
  expect(view).toContain('submitGatewayMainnetReview(');
  expect(execution).toContain('return gatewaySpendQuoteSummary(review.amount,review.fees).minimumReceiveUsdc;');
  expect(view).toContain('matchingGatewayAllocation(');
  expect(view).toContain('readGatewayMainnetOperation(');
 });
});
