import {describe,it,expect} from 'vitest';
import {CIRCLE_USDC_BRIDGE_NETWORKS} from '../mainnet/circleBridgeNetworkDirectory';
import {bridgeBatchStatus,validateBridgeBatchReferences,CIRCLE_CHAIN_EVIDENCE}
 from '../mainnet/circleBridgeBatchVerification';
import {circleCctpBridgePair} from '../mainnet/circleBridgePolicy';
import {reviewedExchangeNetworks,reviewedExchangeRoutes} from '../mainnet/reviewedExchangeRoutes';

describe('19-network Circle mainnet evidence and single release safety gates',()=>{
 it('cross-checks 19 native USDC references with unique Circle-domain directory',()=>{
  expect(CIRCLE_USDC_BRIDGE_NETWORKS).toHaveLength(19);
  expect(CIRCLE_CHAIN_EVIDENCE).toHaveLength(19);
  expect(validateBridgeBatchReferences()).toEqual([]);
  expect(bridgeBatchStatus().every(x=>x.referenceChecked)).toBe(true);
  expect(CIRCLE_CHAIN_EVIDENCE.find(x=>x.id==='polygon')?.usdcNative.toLowerCase())
   .toBe('0x3c499c542cef5e3811e1192ce70d8cc03d5c3359');
 });
 it('records Circle CCTP Arc Mainnet docs discrepancy explicitly',()=>{
  expect(bridgeBatchStatus().filter(x=>x.providerDocs==='documentation-discrepancy')
   .map(x=>x.id)).toEqual(['arc']);
  expect(bridgeBatchStatus().filter(x=>x.providerDocs==='published-cctp-v2-mainnet'))
   .toHaveLength(18);
 });
 it('does not create live routes merely because a native USDC address was verified',()=>{
  const statuses=bridgeBatchStatus();
  expect(statuses.filter(x=>x.veyraQuoteIntegrated).map(x=>x.id))
   .toEqual(['arc','base','ethereum']);
  expect(statuses.every(x=>x.requiresWalletQuoteAndLiveSettlementAcceptance)).toBe(true);
  const routes=reviewedExchangeRoutes('bridge');
  const selectableIds=new Set(reviewedExchangeNetworks('bridge','from').map(x=>x.chainId));
  expect(selectableIds.has(42161)).toBe(false);
  expect(selectableIds.has(137)).toBe(false);
  expect(routes.every(x=>selectableIds.has(x.source.chainId))).toBe(true);
  expect(circleCctpBridgePair(42161,5042,'USDC','USDC')).toBe(false);
  expect(circleCctpBridgePair(137,5042,'USDC','USDC')).toBe(false);
 });
 it('keeps Solana separate from EVM wallet signing and Codex chain ID unresolved',()=>{
  const solana=CIRCLE_USDC_BRIDGE_NETWORKS.find(x=>x.id==='solana');
  const codex=CIRCLE_USDC_BRIDGE_NETWORKS.find(x=>x.id==='codex');
  expect(solana?.vm).toBe('svm');
  expect(solana?.chainId).toBeNull();
  expect(codex?.chainId).toBeNull();
  expect(selectableSourceIds()).not.toContain(null);
 });
});
function selectableSourceIds(){
 return reviewedExchangeNetworks('bridge','from').map(x=>x.chainId);
}
