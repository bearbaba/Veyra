/** The SAME reviewed exchange route graph feeds selectors, quote forms and execution.
 * Reference catalog listings NEVER become selectable because they have a balance.
 * Quoteable/integrated is NOT the same as signing authorized.
 */
import {EXCHANGE_ASSETS,exchangeAssetId,resolveExchangeRoute,type ExchangeAsset} from './exchangeCatalog';
export type ReviewedExchangeMode='swap'|'bridge';
export type ReviewedSide='from'|'to';
export type ReviewedRouteStatus='unsupported'|'paused'|'reviewable';

export function reviewedExchangeRoutes(mode:ReviewedExchangeMode){
 return EXCHANGE_ASSETS.flatMap(from=>EXCHANGE_ASSETS.flatMap(to=>{
  const route=resolveExchangeRoute(from,to);
  return route.kind===mode?[route]:[];
 }));
}
export function reviewedExchangeAssets(mode:ReviewedExchangeMode,side:ReviewedSide,fixed?:ExchangeAsset):ExchangeAsset[]{
 const seen=new Set<string>();
 return reviewedExchangeRoutes(mode).filter(route=>!fixed||
   exchangeAssetId(side==='from'?route.destination:route.source)===exchangeAssetId(fixed))
  .map(route=>side==='from'?route.source:route.destination)
  .filter(asset=>{
   const key=exchangeAssetId(asset);
   if(seen.has(key))return false;
   seen.add(key);return true;
  });
}
export function reviewedExchangeNetworks(mode:ReviewedExchangeMode,side:ReviewedSide,fixed?:ExchangeAsset){
 return reviewedExchangeAssets(mode,side,fixed).map(asset=>({chainId:asset.chainId,
  name:asset.network,logo:asset.chainId===5042?'arc' as const:'base' as const,
  asset}));
}
export function reviewedRouteStatus(
 mode:ReviewedExchangeMode,from:ExchangeAsset,to:ExchangeAsset,canSign:boolean,
):ReviewedRouteStatus{
 const route=resolveExchangeRoute(from,to);
 if(route.kind!==mode)return 'unsupported';
 return canSign?'reviewable':'paused';
}
