import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {
 ARC_CHAIN_ID,ARC_FEE_ANNOUNCEMENT_URL,mainnetSourceGasToken,
 arcCctpStandardFeeDisclosure,arcFastIntoArcFeeDisclosure,arcGatewayFeeDisclosure,
} from '../mainnet/arcSettlementFeeDisclosure';

const src=(path:string)=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

describe('Arc fee announcement: informative, not an executable quote',()=>{
 it('shows Standard USDC service-fee context only on reviewed Arc bridge routes',()=>{
  for(const [from,to] of [[1,ARC_CHAIN_ID],[8453,ARC_CHAIN_ID],[ARC_CHAIN_ID,1],[ARC_CHAIN_ID,8453]]){
   const notice=arcCctpStandardFeeDisclosure({sourceChainId:from,destinationChainId:to,asset:'USDC'});
   expect(notice).toContain('Standard');
   expect(notice).toContain('transfer service fee');
   expect(notice).toContain('not a zero-total-fee promise');
   expect(notice).toContain('live Circle quote');
  }
  for(const [from,to,asset] of [[1,8453,'USDC'],[ARC_CHAIN_ID,ARC_CHAIN_ID,'USDC'],
    [5042002,ARC_CHAIN_ID,'USDC'],[8453,5042002,'USDC'],[1,ARC_CHAIN_ID,'EURC'] ] as const){
   expect(arcCctpStandardFeeDisclosure({sourceChainId:from,destinationChainId:to,asset})).toBeNull();
  }
 });
 it('does not present the published 75% Fast discount as a Veyra Standard quote',()=>{
  const announced=arcFastIntoArcFeeDisclosure({sourceChainId:8453,destinationChainId:ARC_CHAIN_ID,asset:'USDC'});
  expect(announced).toContain('75%');
  expect(announced).toContain('not offered');
  expect(announced).toContain('no Fast quote');
  expect(arcFastIntoArcFeeDisclosure({sourceChainId:ARC_CHAIN_ID,destinationChainId:8453,asset:'USDC'})).toBeNull();
  expect(arcFastIntoArcFeeDisclosure({sourceChainId:8453,destinationChainId:1,asset:'USDC'})).toBeNull();
  expect(arcFastIntoArcFeeDisclosure({sourceChainId:8453,destinationChainId:ARC_CHAIN_ID,asset:'EURC'})).toBeNull();
 });
 it('never confuses Arc USDC gas with ETH on other Mainnet networks',()=>{
  expect(mainnetSourceGasToken(ARC_CHAIN_ID)).toBe('USDC');
  expect(mainnetSourceGasToken(1)).toBe('ETH');
  expect(mainnetSourceGasToken(8453)).toBe('ETH');
  expect(mainnetSourceGasToken(5042002)).toBeNull();
 });
 it('discloses Gateway Arc-side waiver without promising free transfers',()=>{
  for(const guidance of [
   arcGatewayFeeDisclosure({kind:'deposit',sourceChainId:ARC_CHAIN_ID,asset:'USDC'}),
   arcGatewayFeeDisclosure({kind:'spend',sourceChainId:8453,destinationChainId:ARC_CHAIN_ID,asset:'USDC'}),
  ]){
   expect(guidance).toContain('waived');
   expect(guidance).toContain('Gas');
   expect(guidance).toContain('current Circle estimate');
   expect(guidance).toContain('does not mean gasless');
  }
  expect(arcGatewayFeeDisclosure({kind:'deposit',sourceChainId:8453,asset:'USDC'})).toBeNull();
  expect(arcGatewayFeeDisclosure({kind:'spend',sourceChainId:8453,destinationChainId:1,asset:'USDC'})).toBeNull();
  expect(arcGatewayFeeDisclosure({kind:'spend',sourceChainId:8453,destinationChainId:ARC_CHAIN_ID,asset:'EURC'})).toBeNull();
 });
 it('leaves signing/revalidation logic and live Circle quote path in control',()=>{
  const circle=src('components/pages/MainnetCirclePage.tsx');
  const gateway=src('components/pages/MainnetUnifiedBalancePanel.tsx');
  expect(ARC_FEE_ANNOUNCEMENT_URL).toContain('arc.io/blog/');
  expect(circle).toContain('arcCctpStandardFeeDisclosure');
  expect(circle).toContain('mainnetSourceGasToken(selectedSource)');
  expect(circle).toContain('kit.estimateBridge(');
  expect(circle).toContain('assertBridgeQuoteWithinReviewedCap(');
  expect(circle).toContain("transferSpeed:'SLOW'");
  expect(circle).not.toContain("transferSpeed:'FAST'");
  expect(gateway).toContain('arcGatewayFeeDisclosure');
  expect(gateway).toContain('estimateGatewayMainnetSpend(');
  expect(gateway).toContain('submitGatewayMainnetReview(');
 });
});
