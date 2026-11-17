/** Normalized Exchange quote contract across providers.
 * A live quote is not an authorization; the quote review never signs or sends money.
 */
export type ExchangeQuoteSummary={
 provider:string;sourceChainId:number;destinationChainId:number;
 inputAssetId:string;outputAssetId:string;inputRaw:string;expectedOutputRaw:string;
 minimumOutputRaw:string;outputDecimals:number;expiresAt:number;
 fees:string[];estimatedSeconds:number|null;
 steps:readonly string[];walletConfirmations:number|null;
 signing:'enabled'|'not-accepted';
};
export type AcrossQuoteEnvelope={
 provider:'Across';sourceChainId:8453;destinationChainId:5042;
 inputToken:string;outputToken:string;owner:string;inputAmountRaw:string;
 expectedOutputRaw:string;minimumOutputRaw:string;outputDecimals:6;
 quoteExpiresAt:number;expectedFillSeconds:number|null;
 feeSummary:string;routeSteps:string[];approvalCount:number;executionReady:false;
 reason:'WALLET_SIGNING_NOT_ACCEPTED';
};
export function normalizeAcrossExchangeQuote(quote:AcrossQuoteEnvelope):ExchangeQuoteSummary{
 if(quote.provider!=='Across'||quote.sourceChainId!==8453||quote.destinationChainId!==5042||
  !/^[0-9]+$/.test(quote.expectedOutputRaw)||!/^[0-9]+$/.test(quote.minimumOutputRaw)||
  BigInt(quote.minimumOutputRaw)<=0n||BigInt(quote.minimumOutputRaw)>BigInt(quote.expectedOutputRaw)||
  quote.executionReady!==false||!Number.isSafeInteger(quote.quoteExpiresAt))
  throw Error('Across quote could not pass Veyra review.');
 return {provider:'Across',sourceChainId:8453,destinationChainId:5042,
  inputAssetId:'8453:'+quote.inputToken.toLowerCase(),
  outputAssetId:'5042:'+quote.outputToken.toLowerCase(),
  inputRaw:quote.inputAmountRaw,expectedOutputRaw:quote.expectedOutputRaw,
  minimumOutputRaw:quote.minimumOutputRaw,outputDecimals:quote.outputDecimals,
  expiresAt:quote.quoteExpiresAt,fees:[quote.feeSummary],
  estimatedSeconds:quote.expectedFillSeconds,
  steps:quote.routeSteps,walletConfirmations:quote.approvalCount+1,
  signing:'not-accepted'};
}
export async function getAcrossExchangeQuote(args:{
 token:string;owner:string;fromContract:string;toContract:string;amountRaw:string;signal:AbortSignal;
}):Promise<ExchangeQuoteSummary>{
 const res=await fetch('/api/mainnet/exchange/across/quote',{method:'POST',
  headers:{Authorization:'Bearer '+args.token,'Content-Type':'application/json'},
  body:JSON.stringify({owner:args.owner,sourceChainId:8453,destinationChainId:5042,
   inputToken:args.fromContract,outputToken:args.toContract,amount:args.amountRaw}),
  signal:args.signal,cache:'no-store'});
 const json:unknown=await res.json().catch(()=>null);
 if(!json||typeof json!=='object'||Array.isArray(json))throw Error('Across backend returned invalid response.');
 const payload=json as Record<string,unknown>;
 if(!res.ok||payload.ok!==true){
  const code=typeof payload.error==='string'?payload.error:'ACROSS_QUOTE_UNAVAILABLE';
  if(code==='ACROSS_NOT_CONFIGURED')throw Error('Across quoting is not connected to the Veyra Mainnet backend yet.');
  if(code==='ACROSS_NO_ROUTE')throw Error('No Across liquidity for this exact amount and destination.');
  if(res.status===401)throw Error('Sign in to Veyra ID again to request the live quote.');
  throw Error('Across quote unavailable ('+code+'). Do not initiate a wallet transfer.');
 }
 return normalizeAcrossExchangeQuote(payload.quote as AcrossQuoteEnvelope);
}
