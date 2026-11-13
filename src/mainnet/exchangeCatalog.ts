/** Exchange search catalog. Identity is chainId + exact contract, never a ticker.
 * Catalog presence does not imply Swap/Bridge liquidity, safety or execution readiness.
 */
import {isAddress} from 'viem';
import {ARC_VERIFIED_ASSETS} from '@/config/arcVerifiedAssets';
import {MAINNET_CHAIN_CATALOG} from '@/config/mainnetCatalog';
import {circleCctpBridgePair} from './circleBridgePolicy';

export type ExchangeAsset={
 chainId:number;contractAddress:`0x${string}`;
 name:string;symbol:string;decimals:number;network:string;
 sourceUrl:string;verification:'reference-address-reviewed';logo:'usdc'|'eurc'|'weth';
};
const arc=[ARC_VERIFIED_ASSETS.USDC,ARC_VERIFIED_ASSETS.EURC].map(asset=>({
 chainId:asset.chainId,contractAddress:asset.contractAddress,name:asset.name,
 symbol:asset.symbol,decimals:asset.decimals,network:'Arc',
 sourceUrl:asset.sourceUrl,verification:'reference-address-reviewed' as const,
 logo:asset.symbol==='EURC'?'eurc' as const:'usdc' as const,
}));
const others=MAINNET_CHAIN_CATALOG.filter(c=>c.chainId!==5042).map(chain=>({
 chainId:chain.chainId,contractAddress:chain.usdc,name:'USD Coin',symbol:'USDC',
 decimals:6,network:chain.name,
 sourceUrl:'https://developers.circle.com/stablecoins/usdc-contract-addresses',
 verification:'reference-address-reviewed' as const,logo:'usdc' as const,
}));
const wethSources:readonly Pick<ExchangeAsset,'chainId'|'contractAddress'|'network'>[]=[
 {chainId:1,contractAddress:'0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',network:'Ethereum'},
 {chainId:8453,contractAddress:'0x4200000000000000000000000000000000000006',network:'Base'},
 {chainId:42161,contractAddress:'0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',network:'Arbitrum'},
 {chainId:10,contractAddress:'0x4200000000000000000000000000000000000006',network:'OP Mainnet'},
 {chainId:137,contractAddress:'0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619',network:'Polygon PoS'},
];
const weth:readonly ExchangeAsset[]=wethSources.map(a=>({...a,name:'Wrapped Ether',symbol:'WETH',decimals:18,
 sourceUrl:'https://www.weth.io/weth-contract-address/',
 verification:'reference-address-reviewed' as const,logo:'weth' as const}));
export const EXCHANGE_ASSETS:readonly ExchangeAsset[]=[...arc,...others,...weth];
export const exchangeAssetId=(asset:Pick<ExchangeAsset,'chainId'|'contractAddress'>)=>
 asset.chainId+':'+asset.contractAddress.toLowerCase();
export function exchangeAsset(chainId:number,address:string):ExchangeAsset|null{
 if(!isAddress(address))return null;
 return EXCHANGE_ASSETS.find(a=>a.chainId===chainId&&a.contractAddress.toLowerCase()===address.toLowerCase())??null;
}
export function searchExchangeAssets(query:string,network:'all'|number='all'):ExchangeAsset[]{
 const term=query.trim().toLowerCase();
 return EXCHANGE_ASSETS.filter(asset=>(network==='all'||asset.chainId===network)&&(
  !term||[asset.name,asset.symbol,asset.network,asset.contractAddress,String(asset.chainId)]
   .some(v=>v.toLowerCase().includes(term))));
}
export type ExchangeRoute=
 | {kind:'swap';source:ExchangeAsset;destination:ExchangeAsset;provider:'Circle App Kit'}
 | {kind:'bridge';source:ExchangeAsset;destination:ExchangeAsset;provider:'Circle CCTP'}
 | {kind:'quote-only';source:ExchangeAsset;destination:ExchangeAsset;provider:'Across';reason:'Signing requires independently accepted wallet execution'}
 | {kind:'unavailable';source:ExchangeAsset;destination:ExchangeAsset;reason:string};
export function resolveExchangeRoute(from:ExchangeAsset,to:ExchangeAsset):ExchangeRoute{
 const source=exchangeAsset(from.chainId,from.contractAddress);
 const destination=exchangeAsset(to.chainId,to.contractAddress);
 const no=(reason:string):ExchangeRoute=>({kind:'unavailable',source:from,destination:to,reason});
 if(!source||!destination)return no('Unknown or unverified contract. No route or signature is available.');
 if(exchangeAssetId(source)===exchangeAssetId(destination))
  return no('You selected the same asset on the same network; no exchange is needed.');
 // Across supports origin WETH -> Arc USDC on its Swap API. New route remains
 // QUOTE-ONLY until exact spender, calldata, wallet approvals and destination proof pass acceptance.
 if(source.chainId===8453&&source.symbol==='WETH'&&
   source.contractAddress.toLowerCase()==='0x4200000000000000000000000000000000000006'&&
   destination.chainId===5042&&destination.symbol==='USDC'&&
   destination.contractAddress.toLowerCase()==='0x3600000000000000000000000000000000000000')
  return {kind:'quote-only',source,destination,provider:'Across',
   reason:'Signing requires independently accepted wallet execution'};
 if(source.chainId===destination.chainId){
  if(source.chainId===5042&&source.symbol!==destination.symbol&&
    new Set([source.symbol,destination.symbol]).size===2&&
    ['USDC','EURC'].includes(source.symbol)&&['USDC','EURC'].includes(destination.symbol))
   return {kind:'swap',source,destination,provider:'Circle App Kit'};
  return no('No independently validated same-chain Swap executor is connected for this pair yet.');
 }
 if(circleCctpBridgePair(source.chainId,destination.chainId,source.symbol,destination.symbol))
  return {kind:'bridge',source,destination,provider:'Circle CCTP'};
 return no(source.symbol!==destination.symbol?
  'A cross-network Bridge + Swap needs a complete provider quote and recoverable multi-step route. Not enabled yet.':
  'Circle has not listed this pair as a supported Mainnet CCTP V2 route. Arc Mainnet is not yet supported.');
}
export function validateExchangeCatalog():string[]{
 const seen=new Set<string>(),problems:string[]=[];
 for(const asset of EXCHANGE_ASSETS){
  const key=exchangeAssetId(asset);
  if(seen.has(key)||!isAddress(asset.contractAddress)||!Number.isSafeInteger(asset.chainId)||
   !Number.isSafeInteger(asset.decimals)||asset.decimals<0||asset.decimals>36||
   !asset.sourceUrl.startsWith('https://'))problems.push('Invalid exchange asset: '+key);
  seen.add(key);
 }
 return problems;
}
/** Theoretical route capability is NOT a live quote or execution guarantee. */
export type ExchangeAssetSupport='tradable-route'|'quote-only'|'unsupported';
export function exchangeAssetSupport(from:ExchangeAsset,to:ExchangeAsset):ExchangeAssetSupport{
 const route=resolveExchangeRoute(from,to);
 return route.kind==='unavailable'?'unsupported':route.kind==='quote-only'?'quote-only':'tradable-route';
}
export function hasAvailableExchangeDestination(from:ExchangeAsset):boolean{
 return EXCHANGE_ASSETS.some(to=>exchangeAssetSupport(from,to)!=='unsupported');
}
