/**
 * Circle Gateway Testnet spend preparation: immutable, independently reviewable
 * math and EIP-712. No side effects: no wallet signing or provider submission.
 *
 * Source funds live in Gateway ledgers, not EVM wallet ERC-20 balances.
 * Fees/expiry MUST come from a fresh Circle /v1/estimate; never hardcode them.
 */
import {getAddress, isAddress, pad, parseUnits, zeroAddress} from 'viem';
import {
 GATEWAY_TESTNET_SOURCES,GATEWAY_TESTNET_WALLET,GATEWAY_TESTNET_MINTER,
 type GatewayBalanceSnapshot,
} from './gatewayBalances';

export type GatewaySendSource=typeof GATEWAY_TESTNET_SOURCES[number];
export type GatewayAllocation={domain:number;chainId:number;value:bigint;maxFee:bigint};
export type GatewayFeeQuote={domain:number;maxFee:bigint;maxBlockHeight:bigint};
export interface GatewaySendRequest {
 owner:string; recipient:string; destinationChainId:number;
 amount:string; snapshot:GatewayBalanceSnapshot; quotes:ReadonlyArray<GatewayFeeQuote>;
 now?:number;
}
export class GatewaySendPlanError extends Error {
 constructor(public readonly code:string){super(code);}
}
const deny=(code:string):never=>{throw new GatewaySendPlanError(code);};
const DECIMAL_USDC=/^\d{1,18}(?:\.\d{1,6})?$/;
const MAX_QUOTE_FEE=10_000_000_000n; // ceiling sanity only, never a fee default (10,000 USDC)
const UINT256_MAX=(1n<<256n)-1n;

/**
 * Stable order chooses the largest *net* available source first. Do not deduct
 * fees from destination amount. Only confirmed, owner-scoped provider balances
 * are eligible. A quoted fee is reserved separately on each selected source.
 */
export function allocateGatewaySend(input:GatewaySendRequest):GatewayAllocation[]{
 const {owner,recipient,snapshot,quotes,amount,destinationChainId}=input;
 const now=input.now??Date.now();
 if(!isAddress(owner)||!isAddress(recipient))return deny('GATEWAY_INVALID_ADDRESS');
 if(snapshot.owner.toLowerCase()!==owner.toLowerCase()||
    snapshot.readAt>now+5000||now-snapshot.readAt>30_000)
   return deny('GATEWAY_BALANCE_UNVERIFIED_OR_STALE');
 if(!DECIMAL_USDC.test(amount))return deny('GATEWAY_AMOUNT_NOT_EXACT_USDC');
 const units=parseUnits(amount,6);
 if(units<=0n)return deny('GATEWAY_AMOUNT_NONPOSITIVE');
 if(!GATEWAY_TESTNET_SOURCES.some(s=>s.chainId===destinationChainId))
   return deny('GATEWAY_DESTINATION_UNSUPPORTED');
 const rows=GATEWAY_TESTNET_SOURCES.map(source=>{
   const balances=snapshot.sources.filter(r=>r.domain===source.domain&&r.chainId===source.chainId);
   if(balances.length!==1||balances[0].available<0n)
     return deny('GATEWAY_SOURCE_UNVERIFIED');
   // A verified zero-credit domain contributes no funds and needs no provider
   // quote. Do not let a down or unsupported empty domain block valid sources.
   if(balances[0].available===0n)return {source,fee:0n,free:0n};
   const matches=quotes.filter(q=>q.domain===source.domain);
   if(matches.length!==1)return deny('GATEWAY_ESTIMATE_MISSING_OR_DUPLICATED');
   const fee=matches[0].maxFee;
   const expiry=matches[0].maxBlockHeight;
   if(typeof fee!=='bigint'||fee<0n||fee>MAX_QUOTE_FEE||
      typeof expiry!=='bigint'||expiry<=0n||expiry>UINT256_MAX)
     return deny('GATEWAY_ESTIMATE_INVALID');
   const free=balances[0].available>fee?balances[0].available-fee:0n;
   return {source,fee,free};
 });
 // Tie-break by domain for predictable review; prevents provider/LLM route drift.
 rows.sort((a,b)=>a.free===b.free?a.source.domain-b.source.domain:a.free>b.free?-1:1);
 let remaining=units;
 const result:GatewayAllocation[]=[];
 for(const row of rows){
   if(remaining===0n)break;
   if(row.free<=0n)continue;
   const value=row.free<remaining?row.free:remaining;
   result.push({domain:row.source.domain,chainId:row.source.chainId,value,maxFee:row.fee});
   remaining-=value;
 }
 if(remaining!==0n)return deny('GATEWAY_INSUFFICIENT_AVAILABLE_AFTER_FEES');
 return result;
}

export interface GatewayTransferSpec {
 version:number;sourceDomain:number;destinationDomain:number;
 sourceContract:`0x${string}`;destinationContract:`0x${string}`;
 sourceToken:`0x${string}`;destinationToken:`0x${string}`;
 sourceDepositor:`0x${string}`;destinationRecipient:`0x${string}`;
 sourceSigner:`0x${string}`;destinationCaller:`0x${string}`;
 value:bigint;salt:`0x${string}`;hookData:'0x';
}
export interface GatewayBurnIntent {
 maxBlockHeight:bigint;maxFee:bigint;spec:GatewayTransferSpec;
}
export const GATEWAY_EIP712={
 domain:{name:'GatewayWallet',version:'1'},
 primaryType:'BurnIntent',
 types:{
  EIP712Domain:[{name:'name',type:'string'},{name:'version',type:'string'}],
  TransferSpec:[
   {name:'version',type:'uint32'},{name:'sourceDomain',type:'uint32'},
   {name:'destinationDomain',type:'uint32'},{name:'sourceContract',type:'bytes32'},
   {name:'destinationContract',type:'bytes32'},{name:'sourceToken',type:'bytes32'},
   {name:'destinationToken',type:'bytes32'},{name:'sourceDepositor',type:'bytes32'},
   {name:'destinationRecipient',type:'bytes32'},{name:'sourceSigner',type:'bytes32'},
   {name:'destinationCaller',type:'bytes32'},{name:'value',type:'uint256'},
   {name:'salt',type:'bytes32'},{name:'hookData',type:'bytes'},
  ],
  BurnIntent:[
   {name:'maxBlockHeight',type:'uint256'},{name:'maxFee',type:'uint256'},
   {name:'spec',type:'TransferSpec'},
  ],
 },
} as const;
const bytes32=(address:string):`0x${string}`=>pad(getAddress(address),{size:32});

/** Build exact Circle struct; caller must ensure quote is still within expiry.
 * Salt is a 32-byte CSPRNG value generated by the browser, not by AI.
 */
export function buildGatewayBurnIntent(
 allocation:GatewayAllocation,request:Pick<GatewaySendRequest,'owner'|'recipient'|'destinationChainId'>,
 quote:GatewayFeeQuote,salt:`0x${string}`,
):GatewayBurnIntent{
 const source=GATEWAY_TESTNET_SOURCES.find(s=>s.domain===allocation.domain&&s.chainId===allocation.chainId);
 const destination=GATEWAY_TESTNET_SOURCES.find(s=>s.chainId===request.destinationChainId);
 if(!source||!destination||!isAddress(request.owner)||!isAddress(request.recipient))
  return deny('GATEWAY_BURN_INTENT_ROUTE_INVALID');
 if(!/^0x[0-9a-fA-F]{64}$/.test(salt))return deny('GATEWAY_SALT_INVALID');
 if(quote.domain!==source.domain||quote.maxFee!==allocation.maxFee||
    quote.maxBlockHeight<=0n||quote.maxBlockHeight>UINT256_MAX ||
    allocation.value<=0n||allocation.maxFee<0n)
  return deny('GATEWAY_BURN_INTENT_ESTIMATE_CHANGED');
 return {
  maxBlockHeight:quote.maxBlockHeight,maxFee:quote.maxFee,
  spec:{
   version:1,sourceDomain:source.domain,destinationDomain:destination.domain,
   sourceContract:bytes32(GATEWAY_TESTNET_WALLET),
   destinationContract:bytes32(GATEWAY_TESTNET_MINTER),
   sourceToken:bytes32(source.token),destinationToken:bytes32(destination.token),
   sourceDepositor:bytes32(request.owner),destinationRecipient:bytes32(request.recipient),
   sourceSigner:bytes32(request.owner),destinationCaller:bytes32(zeroAddress),
   value:allocation.value,salt,hookData:'0x',
  },
 };
}

/** Strictly compare a provider-estimated intent with the exact owner-reviewed
 * plan. Never allow an estimate response to replace source, recipient or value.
 */
export function assertGatewayEstimateMatches(
 expected:GatewayBurnIntent,estimate:GatewayBurnIntent,
):void{
 const fields=[
  'version','sourceDomain','destinationDomain','sourceContract','destinationContract',
  'sourceToken','destinationToken','sourceDepositor','destinationRecipient','sourceSigner',
  'destinationCaller','value','salt','hookData',
 ] as const;
 for(const key of fields){
  if(expected.spec[key]!==estimate.spec[key])
   return deny('GATEWAY_ESTIMATE_CHANGED_REVIEW_REQUIRED');
 }
 if(expected.maxFee!==estimate.maxFee||expected.maxBlockHeight!==estimate.maxBlockHeight)
  return deny('GATEWAY_ESTIMATE_CHANGED_REVIEW_REQUIRED');
}


/**
 * A browser review must independently bind the BFF's quote to the exact
 * wallet, recipient, chain pair, amount, USDC contracts, and unique salt.
 * A source-domain/amount-only check is insufficient for signing readiness.
 * The salt returned with the estimate MUST survive unchanged until signing.
 */
export function assertGatewayQuotedSpecMatches(input:{
 owner:string;recipient:string;amount:string;sourceDomain:number;destinationDomain:number;
},rawSpec:unknown,fee:bigint,maxBlockHeight:bigint):`0x${string}`{
 if(!rawSpec||typeof rawSpec!=='object'||Array.isArray(rawSpec))
  return deny('GATEWAY_QUOTED_SPEC_MISSING');
 const spec=rawSpec as Record<string,unknown>;
 if(typeof spec.salt!=='string'||!/^0x[0-9a-fA-F]{64}$/.test(spec.salt))
  return deny('GATEWAY_QUOTED_SALT_INVALID');
 if(!DECIMAL_USDC.test(input.amount))
  return deny('GATEWAY_QUOTED_AMOUNT_INVALID');
 const source=GATEWAY_TESTNET_SOURCES.find(s=>s.domain===input.sourceDomain);
 if(!source||!GATEWAY_TESTNET_SOURCES.some(s=>s.domain===input.destinationDomain))
  return deny('GATEWAY_QUOTED_ROUTE_INVALID');
 const destination=GATEWAY_TESTNET_SOURCES.find(s=>s.domain===input.destinationDomain)!;
 const expected=buildGatewayBurnIntent(
  {domain:source.domain,chainId:source.chainId,
   value:parseUnits(input.amount,6),maxFee:fee},
  {owner:input.owner,recipient:input.recipient,destinationChainId:destination.chainId},
  {domain:source.domain,maxFee:fee,maxBlockHeight},
  spec.salt as `0x${string}`,
 ).spec;
 for(const key of Object.keys(expected) as Array<keyof GatewayTransferSpec>){
  const required=expected[key],received=spec[key];
  // The API boundary serializes uint256 as a string, not a JS float.
  if(typeof required==='bigint'){
   if(received!==required.toString())
    return deny('GATEWAY_QUOTED_SPEC_MISMATCH');
  }else if(typeof required==='number'){
   if(received!==required)
    return deny('GATEWAY_QUOTED_SPEC_MISMATCH');
  }else if(typeof received!=='string'||received.toLowerCase()!==required.toLowerCase()){
   return deny('GATEWAY_QUOTED_SPEC_MISMATCH');
  }
 }
 return spec.salt as `0x${string}`;
}
