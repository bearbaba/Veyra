/** Arc asset identity is chainId + deployed contract, NEVER its displayed symbol.
 * "Verified" means Veyra checked the issuer/official network address and decimals.
 * It is NOT a price, liquidity, counterparty, safety or execution guarantee.
 * Providers/routes are separate from this list: a quote MUST still be checked live.
 */
import {isAddress} from 'viem';
export type ArcAssetVerification='issuer-and-contract-reviewed';
export type ArcVerifiedAsset={
 chainId:5042;contractAddress:`0x${string}`;name:string;symbol:string;decimals:number;
 sourceUrl:string;verifiedAt:string;verification:ArcAssetVerification;
 swapAdapter:'circle-app-kit-candidate'|null;
};
const issuer='https://docs.arc.io/arc/references/contract-addresses';
export const ARC_VERIFIED_ASSETS={
 USDC:{chainId:5042,contractAddress:'0x3600000000000000000000000000000000000000',
  name:'USD Coin',symbol:'USDC',decimals:6,sourceUrl:issuer,verifiedAt:'2026-11-02',
  verification:'issuer-and-contract-reviewed',swapAdapter:'circle-app-kit-candidate'},
 EURC:{chainId:5042,contractAddress:'0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1',
  name:'Euro Coin',symbol:'EURC',decimals:6,sourceUrl:issuer,verifiedAt:'2026-11-02',
  verification:'issuer-and-contract-reviewed',swapAdapter:'circle-app-kit-candidate'},
} as const satisfies Record<string,ArcVerifiedAsset>;
export type ArcCatalogSymbol=keyof typeof ARC_VERIFIED_ASSETS;
export const ARC_VERIFIED_ASSET_LIST:readonly ArcVerifiedAsset[]=Object.values(ARC_VERIFIED_ASSETS);
/** Fails closed on unreviewed contracts, wrong chains and symbol look-alikes. */
export function getVerifiedArcAsset(chainId:number,address:string):ArcVerifiedAsset|null{
 // Address casing is presentation only. Compare bytes after validating the 20-byte hex shape.
 if(chainId!==5042||!isAddress(address,{strict:false}))return null;
 return ARC_VERIFIED_ASSET_LIST.find(x=>x.contractAddress.toLowerCase()===address.toLowerCase())??null;
}
export function assertArcSwapCandidate(chainId:number,address:string):ArcVerifiedAsset{
 const asset=getVerifiedArcAsset(chainId,address);
 if(!asset)throw Error('Token contract is not in Veyra verified Arc asset registry. No quote requested.');
 if(!asset.swapAdapter)throw Error('Asset is verified, but no reviewed Swap adapter is configured.');
 return asset;
}
export function verifyArcAssetRegistry():string[]{
 const errors:string[]=[];
 const seen=new Set<string>();
 for(const asset of ARC_VERIFIED_ASSET_LIST){
  const key=asset.chainId+':'+asset.contractAddress.toLowerCase();
  if(!isAddress(asset.contractAddress)||seen.has(key)||!Number.isInteger(asset.decimals)||
   asset.decimals<0||asset.decimals>36||!asset.sourceUrl.startsWith('https://'))
   errors.push('Invalid or duplicate Arc asset '+asset.symbol);
  seen.add(key);
 }
 return errors;
}
