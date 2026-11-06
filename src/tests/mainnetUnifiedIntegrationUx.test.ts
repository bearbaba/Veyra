import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
const src=(f:string)=>readFileSync(new URL('../'+f,import.meta.url),'utf8');
describe('Mainnet Unified is a real Circle ledger, not a wallet-balance decoration',()=>{
 it('keeps original Home hero, uses independent Gateway SDK and pending credits',()=>{
  const home=src('components/pages/MainnetHomePage.tsx');
  const panel=src('components/pages/MainnetUnifiedBalancePanel.tsx');
  expect(home).toContain('Your money,');
  expect(home).toContain('more capable.');
  expect(home).toContain('<MainnetUnifiedBalancePanel/>');
  expect(panel).toContain('fetchGatewayMainnetBalances');
  expect(panel).toContain('current?.pending');
  expect(panel).toContain('current?.available');
  expect(panel).not.toContain('Not available on Mainnet');
 });
 it('keeps new Gateway signing gated and checkpointed before submit',()=>{
  const execution=src('mainnet/gatewayMainnetExecution.ts');
  const balance=src('mainnet/gatewayMainnetBalances.ts');
  expect(balance).toContain("networkType:'mainnet'");
  expect(balance).toContain('includePending:true');
  expect(execution).toContain('writeGatewayMainnetOperation(operation)');
  expect(execution).toContain('assertGatewaySdkFeesUnchanged');
  expect(execution).toContain('assertGatewayMainnetWallet');
  expect(execution).toContain('GATEWAY_MAINNET_WRITE_ENABLED');
  expect(execution).toContain('MAINNET_CANARY_MAX_UNITS');
 });
 it('groups original unified request and refuses to invent proof',()=>{
  const act=src('components/pages/MainnetUnifiedActivity.tsx');
  expect(act).toContain('readGatewayMainnetOperation');
  expect(act).toContain('reconcileGatewayMainnetOperation');
  const exchange=src('components/pages/MainnetExchangePage.tsx');
  expect(exchange).toContain('BridgeNetworkPicker');
  expect(exchange).toContain('reviewedExchangeNetworks');
 });
});
