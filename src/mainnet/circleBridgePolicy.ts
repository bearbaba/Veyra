/** Reviewed Circle CCTP V2 Mainnet routes; 2026-11-06.
 * Arc domain 26 belongs to Arc TESTNET, not Arc Mainnet (chainId 5042).
 * Metadata and quote availability never authorize a financial signature.
 * https://developers.circle.com/cctp/concepts/supported-chains-and-domains
 */
import {getMainnetChain} from '@/config/mainnetCatalog';
export type ReviewedCctpChainId=1|8453;
export const CIRCLE_CCTP_MAINNET=[
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
 if(getMainnetChain(5042)?.cctpDomain!==null)issues.push('Arc Mainnet must not claim Arc Testnet domain 26.');
 return issues;
}
