import {describe,expect,it} from 'vitest';
import {EXCHANGE_ASSETS,exchangeAsset,exchangeAssetId,resolveExchangeRoute,
 searchExchangeAssets,validateExchangeCatalog,type ExchangeAsset} from '../mainnet/exchangeCatalog';
const selected=(chainId:number,symbol:string)=>EXCHANGE_ASSETS.find(a=>a.chainId===chainId&&a.symbol===symbol)!;
describe('Exchange selects assets first; routes are proof-gated',()=>{
 it('defaults to a verified Arc catalog with unique chain+contract identities',()=>{
  expect(validateExchangeCatalog()).toEqual([]);
  expect(selected(5042,'USDC')).toBeDefined();
  expect(selected(5042,'EURC')).toBeDefined();
  expect(exchangeAssetId(selected(5042,'USDC'))).not.toBe(exchangeAssetId(selected(8453,'USDC')));
  expect(exchangeAsset(5042,selected(8453,'USDC').contractAddress)).toBe(null);
 });
 it('filters by name, address, symbol and network; not by ticker alone',()=>{
  expect(searchExchangeAssets('EURC').map(a=>a.chainId)).toEqual([5042]);
  expect(searchExchangeAssets(selected(8453,'USDC').contractAddress,8453).map(a=>a.chainId)).toEqual([8453]);
  expect(searchExchangeAssets('USDC').length).toBeGreaterThan(2);
  expect(searchExchangeAssets('USDC',5042)).toHaveLength(1);
  expect(searchExchangeAssets('fakeToken')).toEqual([]);
 });
 it('chooses same-chain Arc Swap only for the executable reviewed route',()=>{
  const swap=resolveExchangeRoute(selected(5042,'USDC'),selected(5042,'EURC'));
  expect(swap).toMatchObject({kind:'swap',provider:'Circle App Kit'});
  expect(resolveExchangeRoute(selected(5042,'EURC'),selected(5042,'USDC')).kind).toBe('swap');
  expect(resolveExchangeRoute(selected(5042,'USDC'),selected(5042,'USDC')).kind).toBe('unavailable');
  expect(resolveExchangeRoute(selected(8453,'USDC'),selected(8453,'USDC')).kind).toBe('unavailable');
 });
 it('chooses only Circle-listed USDC CCTP V2 routes, including Arc, behind live quote and proof',()=>{
  expect(resolveExchangeRoute(selected(1,'USDC'),selected(8453,'USDC')))
   .toMatchObject({kind:'bridge',provider:'Circle CCTP'});
  expect(resolveExchangeRoute(selected(8453,'USDC'),selected(1,'USDC')).kind).toBe('bridge');
  expect(resolveExchangeRoute(selected(5042,'USDC'),selected(8453,'USDC')).kind).toBe('bridge');
  expect(resolveExchangeRoute(selected(8453,'USDC'),selected(5042,'USDC')).kind).toBe('bridge');
  const combined=resolveExchangeRoute(selected(5042,'EURC'),selected(8453,'USDC'));
  expect(combined).toMatchObject({kind:'unavailable'});
  if(combined.kind==='unavailable')expect(combined.reason).toContain('Bridge + Swap');
  expect(resolveExchangeRoute(selected(5042,'USDC'),selected(1,'USDC')).kind).toBe('bridge');
 });
 it('includes wrapped Ether by chain-specific contract without claiming a supported route',()=>{
  const baseWeth=selected(8453,'WETH'),ethWeth=selected(1,'WETH');
  expect(baseWeth.contractAddress.toLowerCase()).not.toBe(ethWeth.contractAddress.toLowerCase());
  expect(baseWeth.decimals).toBe(18);
  expect(searchExchangeAssets('WETH',8453)).toHaveLength(1);
  const route=resolveExchangeRoute(baseWeth,selected(5042,'USDC'));
  expect(route.kind).toBe('quote-only');
  if(route.kind==='quote-only') {
   expect(route.provider).toBe('Across');
   expect(route.reason).toContain('Signing requires independently accepted');
  }
 });
 it('rejects substituted contracts claiming the same symbol and network',()=>{
  const fake:ExchangeAsset={...selected(5042,'USDC'),
    contractAddress:'0x2222222222222222222222222222222222222222'};
  const plan=resolveExchangeRoute(fake,selected(5042,'EURC'));
  expect(plan.kind).toBe('unavailable');
  if(plan.kind==='unavailable')expect(plan.reason).toContain('Unknown or unverified contract');
 });
});
