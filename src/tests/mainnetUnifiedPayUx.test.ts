import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {MAINNET_ROUTES} from '../mainnet/mainnetProduct';
const source=(path:string)=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

describe('Mainnet single Settlement surface, wallet review and identity safety',()=>{
 it('uses Settlement for both Mainnet Wallet and Friends',()=>{
   const app=source('App.tsx');
   const hub=source('components/pages/MainnetPayHub.tsx');
   const picker=source('components/pages/MainnetPayRecipientPicker.tsx');
   expect(app).toContain("next==='pay'?'settlement'");
   expect(app).toContain('<MainnetPayHub recipientWallet=');
   expect(hub).toContain('Veyra Settlement');
   expect(hub).toContain('<SettlementPage key={owner+":"+(paymentRequest?.requestId??"")} embedded');
   expect(hub).toContain('paymentRequest={paymentRequest}');
   expect(hub).toContain('payLocked?');
   expect(hub).not.toContain('<MainnetPayPage');
   expect(hub).not.toContain('Change payment method');
   expect(picker).toContain("useState<'wallet'|'people'>");
   const circle=source('components/pages/MainnetCirclePage.tsx');
   expect(circle).toContain('MAINNET_PUBLIC_BETA');
   expect(circle).toContain('assertMainnetConsumerSigningAllowed');
   expect(circle).toContain('readBridgeQuoteAmounts');
   expect(circle).toContain('aria-label="Transaction action"');
   expect(circle).toContain('!!quote&&!quoteExpired&&!signingReady');
   expect(circle).toContain('onClick={()=>void(quote&&!quoteExpired?signNow():quoteNow())}');
   expect(circle).toContain('Evidence &amp; history');
   expect(circle).toContain('assertBridgeQuoteWithinReviewedCap');
  });
  it('only exposes one top-level Mainnet Send entry, with People nearby',()=>{
  const home=source('components/pages/MainnetHomePage.tsx');
  expect(home).not.toContain("label:'Contract Pay'");
  expect(home).toContain("label:'Friends'");
  expect(MAINNET_ROUTES.identity.destination).toBe('social');
 });
 it('blocks Mainnet contract signing when frozen pay() simulation fails',()=>{
  const settlement=source('components/pages/SettlementPage.tsx');
  expect(settlement).toContain('publicClient.simulateContract(');
  expect(settlement).toContain('Contract payment could not be simulated');
  expect(settlement).toContain('refetchAllowance()');
 });
 it('does not silently route Mainnet identity through unauthenticated local contacts',()=>{
  const contacts=source('components/pages/MainnetContactsPage.tsx');
  expect(contacts).toContain('NOT verified Veyra IDs');
  expect(contacts).not.toContain('preparePaymentRecipient(');
 });
});
