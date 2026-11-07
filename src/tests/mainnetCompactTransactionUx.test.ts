import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
const src=(path:string)=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

describe('Mainnet payments stay compact; no wallet safety guard is removed',()=>{
 it('Bridge routes display source and destination side by side, including small screens',()=>{
  const exchange=src('components/pages/MainnetExchangePage.tsx');
  expect(exchange).toContain('grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]');
  expect(exchange).toContain('aria-label="Bridge route"');
  expect(exchange).toContain('Reverse bridge direction');
  expect(exchange).toContain("status!=='reviewable'");
 });
 it('Swap and Bridge update one action in place without stacking a second confirmation card',()=>{
  const circle=src('components/pages/MainnetCirclePage.tsx');
  expect(circle).toContain('aria-label="Transaction action"');
  expect(circle).toContain('Getting live quote…');
  expect(circle).toContain('Confirm in wallet');
  expect(circle).toContain('Refresh quote');
  expect(circle).toContain('className="size-4 animate-spin"');
  expect(circle).toContain('Fee & route details');
  expect(circle).toContain('Transaction details');
  expect(circle).toContain('{!recovery&&!unknownStorage&&<>');
  expect(circle).toContain('reserveCircleExchangeBeforeSigning');
  expect(circle).toContain('withMainnetWalletSigningLock');
  expect(circle).toContain('readExchangeIntents(owner)');
  expect(circle).toContain('Original operation remains locked. Do not sign again.');
 });
 it('Pay replaces its edit form with the mounted contract review, not a new page',()=>{
  const hub=src('components/pages/MainnetPayHub.tsx');
  const settlement=src('components/pages/SettlementPage.tsx');
  const hide=hub.indexOf('{!settlementInFlow&&<>');
  const end=hub.indexOf('   </>}\n   {payLocked?',hide);
  const child=hub.indexOf('<SettlementPage key=',end);
  expect(hide).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(hide);
  expect(child).toBeGreaterThan(end);
  expect(hub).toContain('onFlowStepChange={setSettlementInFlow}');
  expect(hub).toContain('aria-label="Pay preview"');
  expect(settlement).toContain("onFlowStepChange?.(step!=='form')");
  expect(settlement).toContain('assertArcLivePayFunds');
  expect(settlement).toContain('publicClient.simulateContract');
 });
 it('Unified Review and Confirm reuse one button, while source allocations stay available',()=>{
  const unified=src('components/pages/MainnetUnifiedBalancePanel.tsx');
  expect(unified).toContain('onClick={()=>void(review?execute():preview())}');
  expect(unified).toContain('{!review&&<>');
  expect(unified).toContain('Source allocations');
  expect(unified).toContain('Payment safety');
  expect(unified).toContain('Withdrawal conditions');
  expect(unified).toContain('submitGatewayMainnetReview');
  expect(unified).toContain('readGatewayMainnetOperation');
 });
});
