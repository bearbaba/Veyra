/** Circle CCTP catalog: provider support, Veyra quote integration and authorized signing
 * are independent properties. Arc Mainnet and Arc Testnet both use domain 26;
 * their chain IDs, RPC endpoints, contracts and signing environments differ.
 * Catalog metadata never unlocks wallet signing or implies a successful quote.
 */
import {getMainnetChain} from '@/config/mainnetCatalog';
export type ReviewedCctpChainId=5042|1|8453;
export type CircleRouteStage='provider-supported'|'quote-integrated'|'signing-accepted';
export const CIRCLE_CCTP_MAINNET=[
 {chainId:5042,domain:26,sdkChain:'Arc',logo:'arc',name:'Arc',decimals:6,
  gasToken:'USDC',explorer:'https://explorer.arc.io',usdc:getMainnetChain(5042)!.usdc,forwarding:true},
 {chainId:1,domain:0,sdkChain:'Ethereum',logo:'ethereum',name:'Ethereum',decimals:6,
  gasToken:'ETH',explorer:'https://etherscan.io',usdc:getMainnetChain(1)!.usdc,forwarding:true},
 {chainId:8453,domain:6,sdkChain:'Base',logo:'base',name:'Base',decimals:6,
  gasToken:'ETH',explorer:'https://basescan.org',usdc:getMainnetChain(8453)!.usdc,forwarding:true},
] as const;
export function circleCctpMainnetChain(chainId:number){
 return CIRCLE_CCTP_MAINNET.find(x=>x.chainId===chainId)??null;
}
export function circleCctpBridgePair(from:number,to:number,tokenIn:string,tokenOut:string):boolean{
 return from!==to&&!!circleCctpMainnetChain(from)&&!!circleCctpMainnetChain(to)&&
  tokenIn==='USDC'&&tokenOut==='USDC';
}
export function circleCctpBridgeState(from:number,to:number,accepted=false){
 return !circleCctpBridgePair(from,to,'USDC','USDC')?'not-integrated':
  accepted?'signing-accepted':'quote-candidate';
}
export function validateCircleCctpMainnet():string[]{
 const issues:string[]=[];
 for(const chain of CIRCLE_CCTP_MAINNET){
  const entry=getMainnetChain(chain.chainId);
  if(!entry||entry.cctpDomain!==chain.domain||entry.usdc.toLowerCase()!==chain.usdc.toLowerCase()||
   entry.explorerUrl!==chain.explorer)issues.push('Mainnet Circle metadata mismatch: '+chain.chainId);
 }
 if(getMainnetChain(5042)?.cctpDomain!==26)issues.push('Arc Mainnet must use CCTP domain 26; chain ID 5042 remains separate.');
 return issues;
}
