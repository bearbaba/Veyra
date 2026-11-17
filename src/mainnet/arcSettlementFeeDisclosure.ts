/**
 * Published Arc/Circle crosschain fee context (2026-11-16).
 * Editorial information only: NEVER a quote, signing permission or fee calculation.
 * The live Circle SDK estimate and the reviewed onchain maxFee remain authoritative.
 * https://www.arc.io/blog/build-settlement-on-arc-with-reduced-crosschain-fees
 * https://developers.circle.com/crosschain-fees
 */
export const ARC_FEE_ANNOUNCEMENT_URL =
 'https://www.arc.io/blog/build-settlement-on-arc-with-reduced-crosschain-fees';
export const ARC_CHAIN_ID=5042;
const CCTP_REVIEWED_CHAINS=[ARC_CHAIN_ID,1,8453] as const;

export function mainnetSourceGasToken(chainId:number):'USDC'|'ETH'|null{
 if(chainId===ARC_CHAIN_ID)return 'USDC';
 if(chainId===1||chainId===8453)return 'ETH';
 return null;
}

/** The Veyra Circle integration requests SLOW (CCTP Standard), never Fast. */
export function arcCctpStandardFeeDisclosure(input:{
 sourceChainId:number;destinationChainId:number;asset:string;
}):string|null{
 const {sourceChainId,destinationChainId,asset}=input;
 if(asset!=='USDC'||sourceChainId===destinationChainId||
   !CCTP_REVIEWED_CHAINS.includes(sourceChainId as typeof CCTP_REVIEWED_CHAINS[number])||
   !CCTP_REVIEWED_CHAINS.includes(destinationChainId as typeof CCTP_REVIEWED_CHAINS[number])||
   sourceChainId!==ARC_CHAIN_ID&&destinationChainId!==ARC_CHAIN_ID)return null;
 return 'Arc fee update: Circle lists CCTP Standard USDC transfers as free of its transfer service fee. '+
  'Veyra requests Standard, not Fast. Source gas ('+mainnetSourceGasToken(sourceChainId)+
  '), forwarding and other quoted charges may still apply. The live Circle quote and '+
  'reviewed minimum received determine the transaction; this is not a zero-total-fee promise.';
}

/** 75% Fast discount is informational ONLY; no Fast route is enabled by this helper. */
export function arcFastIntoArcFeeDisclosure(input:{sourceChainId:number;destinationChainId:number;asset:string}):string|null{
 if(input.destinationChainId!==ARC_CHAIN_ID||input.sourceChainId===ARC_CHAIN_ID||
   input.asset!=='USDC'||!CCTP_REVIEWED_CHAINS.includes(input.sourceChainId as typeof CCTP_REVIEWED_CHAINS[number]))
  return null;
 return 'Circle announced a 75% CCTP Fast Transfer fee discount into Arc. '+
  'Fast is not offered by the current Veyra Standard-only Bridge route; no Fast quote or savings are assumed.';
}

/** Gateway waives Arc-side service fees, not source-chain gas or all crosschain costs. */
export function arcGatewayFeeDisclosure(input:{
 kind:'deposit'|'spend';sourceChainId:number;destinationChainId?:number;asset:string;
}):string|null{
 if(input.asset!=='USDC')return null;
 const arcSide=input.kind==='deposit'?input.sourceChainId===ARC_CHAIN_ID:
  input.destinationChainId===ARC_CHAIN_ID;
 if(!arcSide)return null;
 return 'Circle lists Arc-side Gateway service fees as waived for USDC. '+
  'Gas and any other source/forwarding costs can still apply. '+
  'Use the current Circle estimate and wallet confirmation for actual fees; waived does not mean gasless.';
}
