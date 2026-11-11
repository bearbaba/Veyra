import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {CIRCLE_USDC_BRIDGE_NETWORKS,listedBridgeNetwork,validateCircleBridgeDirectory}
 from '../mainnet/circleBridgeNetworkDirectory';
import {reviewedExchangeNetworks,reviewedExchangeRoutes} from '../mainnet/reviewedExchangeRoutes';
import {circleCctpBridgePair} from '../mainnet/circleBridgePolicy';

const exchangeUI=readFileSync(
 new URL('../components/pages/MainnetExchangePage.tsx',import.meta.url),'utf8');

describe('Circle Bridge 19-network directory without falsely enabling Mainnet signing',()=>{
 it('contains exactly the 19 officially listed Circle networks with unique domains',()=>{
  expect(validateCircleBridgeDirectory()).toEqual([]);
  expect(CIRCLE_USDC_BRIDGE_NETWORKS).toHaveLength(19);
  expect(new Set(CIRCLE_USDC_BRIDGE_NETWORKS.map(x=>x.id)).size).toBe(19);
  expect(new Set(CIRCLE_USDC_BRIDGE_NETWORKS.map(x=>x.circleDomain)).size).toBe(19);
  expect(listedBridgeNetwork(5042)?.circleDomain).toBe(26);
  expect(listedBridgeNetwork(8453)?.circleDomain).toBe(6);
  expect(listedBridgeNetwork(42161)?.circleDomain).toBe(3);
  expect(CIRCLE_USDC_BRIDGE_NETWORKS.find(x=>x.id==='solana')).toMatchObject({
   vm:'svm',chainId:null,circleDomain:5,
  });
  expect(CIRCLE_USDC_BRIDGE_NETWORKS.find(x=>x.id==='codex')?.chainId).toBeNull();
 });
 it('keeps the execution graph distinct from Circle listing',()=>{
  const ready=reviewedExchangeNetworks('bridge','from');
  const readyIds=new Set(ready.map(x=>x.chainId));
  expect(readyIds.has(5042)).toBe(true);
  expect(readyIds.has(8453)).toBe(true);
  expect(readyIds.has(42161)).toBe(false);
  expect(readyIds.has(137)).toBe(false);
  expect(circleCctpBridgePair(42161,5042,'USDC','USDC')).toBe(false);
  expect(reviewedExchangeRoutes('bridge').every(route=>
   readyIds.has(route.source.chainId))).toBe(true);
 });
 it('lets users explore all 19 networks while restricting financial execution to reviewed routes',()=>{
  expect(exchangeUI).toContain('CIRCLE_USDC_BRIDGE_NETWORKS.filter(network=>');
  expect(exchangeUI).not.toContain('disabled={!ready}');
  expect(exchangeUI).toContain('onClick={()=>onChoose(network)}');
  expect(exchangeUI).toContain('setFromNetworkId(network.id)');
  expect(exchangeUI).toContain('setToNetworkId(network.id)');
  expect(exchangeUI).toContain('chosenFrom.chainId===from.chainId');
  expect(exchangeUI).toContain('chosenTo.chainId===to.chainId');
  expect(exchangeUI).toContain('const canQuote=displayMatchesExecution&&route.kind===mode');
  expect(exchangeUI).toContain('Only independently accepted routes can quote or sign');
  expect(exchangeUI).toContain('Selected route is not live yet');
  expect(exchangeUI).not.toContain('Circle supported · Veyra integration pending');
 });
 it('does not reset network selection repeatedly while tracking an earlier transaction',()=>{
  expect(exchangeUI).toContain("restoredRouteOwner.current!==owner+':'+mode");
  expect(exchangeUI).toContain('disabled={engineBusy}');
 });
 it('has no new signing or USDC contract addresses derived from the directory',()=>{
  const directory=readFileSync(new URL('../mainnet/circleBridgeNetworkDirectory.ts',import.meta.url),'utf8');
  expect(directory).not.toContain('writeContract(');
  expect(directory).not.toContain('sendTransaction(');
  expect(directory).not.toContain('estimateBridge(');
 });
});
