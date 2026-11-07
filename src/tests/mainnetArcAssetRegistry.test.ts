import {describe,it,expect} from 'vitest';
import {ARC_VERIFIED_ASSETS,ARC_VERIFIED_ASSET_LIST,getVerifiedArcAsset,
 assertArcSwapCandidate,verifyArcAssetRegistry} from '../config/arcVerifiedAssets';
describe('Arc M1 asset registry is chain + contract, never symbol',()=>{
 it('matches vetted Arc issuer contracts and refuses wrong chain and look-alikes',()=>{
  expect(verifyArcAssetRegistry()).toEqual([]);
  expect(ARC_VERIFIED_ASSET_LIST).toHaveLength(2);
  for(const asset of ARC_VERIFIED_ASSET_LIST){
   const found=getVerifiedArcAsset(5042,asset.contractAddress.toUpperCase().replace('0X','0x'));
   expect(found?.symbol).toBe(asset.symbol);
   expect(getVerifiedArcAsset(8453,asset.contractAddress)).toBe(null);
  }
  expect(getVerifiedArcAsset(5042,'0x2222222222222222222222222222222222222222')).toBe(null);
  expect(getVerifiedArcAsset(5042,'USDC')).toBe(null);
 });
 it('does not silently enable a token by symbol; live quote still required',()=>{
  expect(assertArcSwapCandidate(5042,ARC_VERIFIED_ASSETS.USDC.contractAddress).symbol).toBe('USDC');
  expect(()=>assertArcSwapCandidate(5042,'0x2222222222222222222222222222222222222222')).toThrow('not in Veyra');
  expect(ARC_VERIFIED_ASSETS.EURC.decimals).toBe(6);
 });
});
