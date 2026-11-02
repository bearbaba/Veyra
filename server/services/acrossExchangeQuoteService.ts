/** Read-only Across candidate adapter. No arbitrary calldata reaches the browser.
 * The first accepted quote lane is Base WETH -> Arc native USDC.
 * Signing is intentionally a separate release gate (wallet, spender, simulation, receipts).
 */
import {isAddress} from 'viem';
export const ACROSS_BASE_WETH='0x4200000000000000000000000000000000000006';
export const ACROSS_ARC_USDC='0x3600000000000000000000000000000000000000';
const INTEGER=/^(?:0|[1-9][0-9]{0,55})$/;
const API='https://app.across.to/api';
const BASE_ACROSS_EXECUTORS=new Set([
 '0x09aea4b2242abc8bb4bb78d537a67a245a7bec64', // Base SpokePool
 '0x97ccdbea4632140639ad5ea9b944aa034eb15fd4', // Base SpokePoolPeriphery
]);
export class AcrossQuoteError extends Error{
 constructor(public code:string,public httpStatus:number,message:string){super(message);}
}
export type AcrossReadOnlyQuote={
 provider:'Across';sourceChainId:8453;destinationChainId:5042;
 inputToken:string;outputToken:string;owner:string;inputAmountRaw:string;
 expectedOutputRaw:string;minimumOutputRaw:string;outputDecimals:6;
 quoteExpiresAt:number;expectedFillSeconds:number|null;
 feeSummary:string;routeSteps:string[];approvalCount:number;
 executionReady:false;reason:'WALLET_SIGNING_NOT_ACCEPTED';
};
function numberAmount(value:unknown):bigint|null{
 if(typeof value!=='string'||!INTEGER.test(value))return null;
 try{return BigInt(value);}catch{return null;}
}
export function isAcrossConfigured(env:NodeJS.ProcessEnv=process.env){
 return !!env.ACROSS_API_KEY&&/^0x[0-9a-fA-F]{4}$/.test(env.ACROSS_INTEGRATOR_ID??'');
}
export function validateAcrossQuoteRequest(v:unknown):{
 owner:string;amount:string;sourceChainId:8453;destinationChainId:5042;
 inputToken:string;outputToken:string;
}{
 if(!v||typeof v!=='object'||Array.isArray(v))
  throw new AcrossQuoteError('INVALID_EXCHANGE_SELECTION',400,'Invalid Exchange request.');
 const a=v as Record<string,unknown>;
 if(a.sourceChainId!==8453||a.destinationChainId!==5042||
   typeof a.inputToken!=='string'||a.inputToken.toLowerCase()!==ACROSS_BASE_WETH.toLowerCase()||
   typeof a.outputToken!=='string'||a.outputToken.toLowerCase()!==ACROSS_ARC_USDC.toLowerCase()||
   typeof a.owner!=='string'||!isAddress(a.owner)||typeof a.amount!=='string')
  throw new AcrossQuoteError('UNREVIEWED_EXCHANGE_PAIR',422,'This pair has no accepted Across adapter.');
 const raw=numberAmount(a.amount);
 // Read-only quote uses smallest WETH units. Limits prevent abuse and oversized quotes.
 if(raw===null||raw<1_000_000_000_000n||raw>10_000_000_000_000_000_000n)
  throw new AcrossQuoteError('INVALID_EXCHANGE_AMOUNT',400,'WETH quote amount must be between 0.000001 and 10.');
 return {owner:a.owner,amount:a.amount,sourceChainId:8453,destinationChainId:5042,
  inputToken:ACROSS_BASE_WETH,outputToken:ACROSS_ARC_USDC};
}
export function normalizeAcrossQuote(raw:unknown,requested:ReturnType<typeof validateAcrossQuoteRequest>,
 now=Date.now()):AcrossReadOnlyQuote{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))
  throw new AcrossQuoteError('UNVERIFIED_PROVIDER_QUOTE',502,'Across returned invalid quote data.');
 const o=raw as Record<string,unknown>;
 const input=numberAmount(o.inputAmount),expected=numberAmount(o.expectedOutputAmount),
  minimum=numberAmount(o.minOutputAmount);
 const expiry=o.quoteExpiryTimestamp;
 const tx=o.swapTx;
 const inputToken=o.inputToken,outputToken=o.outputToken;
 const tokenMatches=(x:unknown,address:string,chain:number,decimals:number)=>
  !!x&&typeof x==='object'&&!Array.isArray(x)&&
  typeof (x as Record<string,unknown>).address==='string'&&
  (x as Record<string,unknown>).address?.toString().toLowerCase()===address.toLowerCase()&&
  (x as Record<string,unknown>).chainId===chain&&
  (x as Record<string,unknown>).decimals===decimals;
 if(input===null||expected===null||minimum===null||input!==BigInt(requested.amount)||
   !tokenMatches(inputToken,ACROSS_BASE_WETH,8453,18)||
   !tokenMatches(outputToken,ACROSS_ARC_USDC,5042,6)||
   expected<=0n||minimum<=0n||minimum>expected||
   typeof expiry!=='number'||!Number.isSafeInteger(expiry)||
   expiry*1000<=now+10_000||expiry*1000>now+2*60*60_000||
   !tx||typeof tx!=='object'||Array.isArray(tx)||
   (tx as Record<string,unknown>).chainId!==8453||
   (tx as Record<string,unknown>).simulationSuccess!==true||
   typeof (tx as Record<string,unknown>).to!=='string'||
   !isAddress((tx as Record<string,unknown>).to as string)||
   !BASE_ACROSS_EXECUTORS.has(((tx as Record<string,unknown>).to as string).toLowerCase()))
  throw new AcrossQuoteError('UNVERIFIED_PROVIDER_QUOTE',502,'Provider quote fails chain, simulation, minimum or expiry validation.');
 const approvals=o.approvalTxns;
 if(approvals!==undefined&&(!Array.isArray(approvals)||approvals.length>3||
    approvals.some((t:unknown)=>!t||typeof t!=='object'||(t as Record<string,unknown>).chainId!==8453)))
  throw new AcrossQuoteError('UNVERIFIED_APPROVALS',502,'Provider approval step is not accepted.');
 const steps=o.steps&&typeof o.steps==='object'&&!Array.isArray(o.steps)?
  Object.keys(o.steps as object).filter(k=>['originSwap','bridge','destinationSwap'].includes(k)):[];
 if(!steps.includes('bridge'))
  throw new AcrossQuoteError('UNVERIFIED_PROVIDER_ROUTE',502,'Across did not return a bridge stage.');
 const fees=o.fees&&typeof o.fees==='object'&&!Array.isArray(o.fees)?
   o.fees as Record<string,unknown>:{};
 const feeTotal=fees.total&&typeof fees.total==='object'?fees.total as Record<string,unknown>:{};
 const feeGas=fees.originGas&&typeof fees.originGas==='object'?
  fees.originGas as Record<string,unknown>:{};
 const usd=(x:unknown)=>typeof x==='string'&&/^[0-9]+(?:[.][0-9]{1,12})?$/.test(x)?x:null;
 const totalUsd=usd(feeTotal.amountUsd),gasUsd=usd(feeGas.amountUsd);
 const feeSummary=totalUsd!==null?'Provider quoted fees ≈ $'+totalUsd+
   (gasUsd!==null?' · origin gas ≈ $'+gasUsd:' (origin gas not itemized)'):
   'Provider total fee not itemized; no fee guarantee';
 const eta=typeof o.expectedFillTime==='number'&&Number.isFinite(o.expectedFillTime)&&
  o.expectedFillTime>=0&&o.expectedFillTime<=86400?o.expectedFillTime:null;
 return {provider:'Across',sourceChainId:8453,destinationChainId:5042,
  inputToken:requested.inputToken,outputToken:requested.outputToken,owner:requested.owner,
  inputAmountRaw:requested.amount,expectedOutputRaw:expected.toString(),
  minimumOutputRaw:minimum.toString(),outputDecimals:6,
  quoteExpiresAt:Math.min(expiry*1000,now+60_000),expectedFillSeconds:eta,
  feeSummary,
  routeSteps:steps,approvalCount:Array.isArray(approvals)?approvals.length:0,
  executionReady:false,reason:'WALLET_SIGNING_NOT_ACCEPTED'};
}
export async function quoteAcrossBaseWethToArcUsdc(
 selection:unknown,env:NodeJS.ProcessEnv=process.env,client:typeof fetch=fetch,
 now=Date.now(),
):Promise<AcrossReadOnlyQuote>{
 const input=validateAcrossQuoteRequest(selection);
 if(!isAcrossConfigured(env))
  throw new AcrossQuoteError('ACROSS_NOT_CONFIGURED',503,
   'Across cannot quote yet. Server API key and registered integrator ID are required.');
 const params=new URLSearchParams({tradeType:'exactInput',amount:input.amount,
  inputToken:input.inputToken,outputToken:input.outputToken,
  originChainId:'8453',destinationChainId:'5042',
  depositor:input.owner,recipient:input.owner,refundAddress:input.owner,
  integratorId:env.ACROSS_INTEGRATOR_ID!,strictTradeType:'true',slippage:'0.005'});
 let response:Response;
 try{
  response=await client(API+'/swap/approval?'+params.toString(),{
   method:'GET',headers:{Authorization:'Bearer '+env.ACROSS_API_KEY!,Accept:'application/json'},
   signal:AbortSignal.timeout(10_000),cache:'no-store',
  });
 }catch{throw new AcrossQuoteError('ACROSS_OFFLINE',503,'Across quote service unavailable.');}
 if(!response.ok)throw new AcrossQuoteError(response.status===429?'ACROSS_RATE_LIMITED':'ACROSS_NO_ROUTE',
  response.status===429?429:503,'No live Across quote for this amount and pair.');
 let payload:unknown;
 try{payload=await response.json();}catch{
  throw new AcrossQuoteError('ACROSS_INVALID_RESPONSE',502,'Across returned non-JSON quote.');}
 return normalizeAcrossQuote(payload,input,now);
}
export function validateAcrossTrackingResponse(data:unknown):{
 status:'pending'|'received'|'filled'|'expired'|'refunded'|'unknown';terminal:boolean;
}{
 if(!data||typeof data!=='object'||Array.isArray(data))return {status:'unknown',terminal:false};
 const raw=(data as Record<string,unknown>).status;
 if(raw!=='pending'&&raw!=='received'&&raw!=='filled'&&raw!=='expired'&&raw!=='refunded')
  return {status:'unknown',terminal:false};
 return {status:raw,terminal:raw==='filled'||raw==='expired'||raw==='refunded'};
}
