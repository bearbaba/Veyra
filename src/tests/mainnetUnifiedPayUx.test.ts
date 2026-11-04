import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {MAINNET_ROUTES} from '../mainnet/mainnetProduct';
const source=(path:string)=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

describe('Mainnet single Settlement surface, wallet review and identity safety',()=>{
 it('routes both Mainnet payment methods through one entry point',()=>{
  const app=source('App.tsx');
  expect(app).not.toContain('<MainnetPayHub initialMethod="wallet"');
  expect(app).toContain("next==='pay'?'settlement'");
  expect(app).toContain('<MainnetPayHub initialMethod="contract"');
  expect(app).toContain('VEYRA_ENV === \'mainnet\'');
 });
 it('never hides the selected signing mechanism from the sender',()=>{
  const hub=source('components/pages/MainnetPayHub.tsx');
  expect(hub).toContain('Direct transfer');
  expect(hub).toContain('VeyraSettlement contract');
  expect(hub).toContain('aria-pressed');
  expect(hub).toContain('MainnetPayPage key={owner} embedded');
  expect(hub).toContain('<SettlementPage key={owner} embedded');
 });
 it('only exposes one top-level Mainnet Send entry, with People nearby',()=>{
  const home=source('components/pages/MainnetHomePage.tsx');
  expect(home).not.toContain("label:'Contract Pay'");
  expect(home).toContain("label:'People'");
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
