import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {EXCHANGE_ASSETS,exchangeAssetId,resolveExchangeRoute} from '../mainnet/exchangeCatalog';
import {reviewedExchangeAssets,reviewedExchangeNetworks,reviewedRouteStatus,reviewedExchangeRoutes} from '../mainnet/reviewedExchangeRoutes';
const find=(id:number,symbol:string)=>EXCHANGE_ASSETS.find(x=>x.chainId===id&&x.symbol===symbol)!;
const source=(path:string)=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
describe('Veyra reviewed routes are the ONLY source for selectors and pause status',()=>{
 it('Swap only has Arc USDC/EURC and a fixed Arc network',()=>{
  const routes=reviewedExchangeRoutes('swap');
  expect(routes).toHaveLength(2);
  expect(routes.every(x=>x.source.chainId===5042&&x.destination.chainId===5042)).toBe(true);
  expect(reviewedExchangeNetworks('swap','from').map(x=>x.chainId)).toEqual([5042,5042]);
  expect(reviewedExchangeAssets('swap','to',find(5042,'USDC')).map(x=>x.symbol)).toEqual(['EURC']);
  expect(reviewedExchangeAssets('swap','from').some(x=>x.chainId===1)).toBe(false);
 });
 it('Bridge source Arc/Base only; destination is derived from selected source',()=>{
  const sources=reviewedExchangeAssets('bridge','from');
  expect(sources.map(x=>x.chainId)).toEqual([5042,8453]);
  expect(reviewedExchangeNetworks('bridge','to',find(5042,'USDC')).map(x=>x.chainId)).toEqual([8453]);
  expect(reviewedExchangeNetworks('bridge','to',find(8453,'USDC')).map(x=>x.chainId)).toEqual([5042]);
  expect(reviewedExchangeAssets('bridge','from').some(x=>x.chainId===137)).toBe(false);
 });
 it('never promotes a reference-only token to selectable on wallet balance',()=>{
  const ethereum=find(1,'USDC');
  expect(reviewedExchangeAssets('swap','from').some(x=>exchangeAssetId(x)===exchangeAssetId(ethereum))).toBe(false);
  expect(reviewedRouteStatus('swap',ethereum,find(5042,'EURC'),false)).toBe('unsupported');
  expect(reviewedRouteStatus('bridge',find(5042,'USDC'),find(8453,'USDC'),false)).toBe('paused');
  expect(reviewedRouteStatus('swap',find(5042,'USDC'),find(5042,'EURC'),true)).toBe('reviewable');
  expect(resolveExchangeRoute(find(5042,'USDC'),find(8453,'USDC')).kind).toBe('bridge');
 });
 it('has one coherent route form with visible quote-only status, Max and provider evidence',()=>{
  const page=source('components/pages/MainnetExchangePage.tsx');
  const circle=source('components/pages/MainnetCirclePage.tsx');
  expect(page).toContain('reviewedExchangeNetworks');
  expect(page).toContain('reviewedExchangeAssets');
  expect(page).toContain("side==='to'?other:undefined");
  expect(page).toContain('Reverse swap pair');
  expect(page).toContain('receiveSelector=');
  expect(circle).toContain("{mode==='swap'&&receiveSelector}");
  expect(page).toContain('Quotes only · Transfers temporarily paused');
  expect(page).not.toContain('Show unsupported');
  expect(page).not.toContain('Owned first');
  expect(page).not.toContain('No reviewed token matched');
  expect(circle).toContain('Review swap quote');
  expect(circle).toContain('Review bridge quote');
  expect(circle).toContain('Minimum received');
  expect(circle).toContain('Get a fresh quote');
  expect(circle).toContain('Max</button>');
  expect(circle).toContain('recovery||unknownStorage');
  const settings=source('components/pages/SettingsPage.tsx');
  expect(settings).not.toContain('contract payments are not enabled for new signing');
 });
});
