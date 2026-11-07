import {describe,it,expect} from 'vitest';
import {getMainnetChain,validateMainnetCatalog} from '../config/mainnetCatalog';
import {CIRCLE_CCTP_MAINNET,circleCctpBridgePair,validateCircleCctpMainnet} from '../mainnet/circleBridgePolicy';
import {assertArcMainnetCatalog} from '../mainnet/arcMainnetPay';
describe('Circle CCTP Mainnet domain / rollout isolation',()=>{
 it('maps Arc chain ID 5042 to domain 26, independent of Pay',()=>{
  expect(CIRCLE_CCTP_MAINNET.map(x=>[x.chainId,x.domain])).toEqual([[5042,26],[1,0],[8453,6]]);
  expect(getMainnetChain(5042)?.cctpDomain).toBe(26);
  expect(()=>assertArcMainnetCatalog()).not.toThrow();
  expect(validateMainnetCatalog()).toEqual([]);
  expect(validateCircleCctpMainnet()).toEqual([]);
 });
 it('catalog candidate support does not unlock any signature',()=>{
  expect(circleCctpBridgePair(1,8453,'USDC','USDC')).toBe(true);
  expect(circleCctpBridgePair(8453,5042,'USDC','USDC')).toBe(true);
  expect(circleCctpBridgePair(5042,1,'USDC','USDC')).toBe(true);
  expect(circleCctpBridgePair(1,8453,'WETH','USDC')).toBe(false);
 });
});
