import {describe,it,expect} from 'vitest';
import {getMainnetChain,validateMainnetCatalog} from '../config/mainnetCatalog';
import {CIRCLE_CCTP_MAINNET,circleCctpBridgePair,validateCircleCctpMainnet} from '../mainnet/circleBridgePolicy';
describe('Circle CCTP V2 Mainnet route provenance',()=>{
 it('separates public EVM chain ID from Circle domain, and never applies Arc Testnet to Mainnet',()=>{
  expect(CIRCLE_CCTP_MAINNET.map(x=>[x.chainId,x.domain])).toEqual([[1,0],[8453,6]]);
  expect(getMainnetChain(5042)?.cctpDomain).toBeNull();
  expect(validateMainnetCatalog()).toEqual([]);
  expect(validateCircleCctpMainnet()).toEqual([]);
 });
 it('never unlocks CCTP because a token exists or an SDK lists a network',()=>{
  expect(circleCctpBridgePair(1,8453,'USDC','USDC')).toBe(true);
  expect(circleCctpBridgePair(8453,1,'USDC','USDC')).toBe(true);
  expect(circleCctpBridgePair(5042,8453,'USDC','USDC')).toBe(false);
  expect(circleCctpBridgePair(1,8453,'WETH','USDC')).toBe(false);
 });
});
