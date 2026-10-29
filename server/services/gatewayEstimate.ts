/**
 * Circle Gateway /v1/estimate strict, read-only adapter.
 * Never turn an estimate into permission to submit a burn. All financial
 * fields remain unsigned until the exact spec/fee/expiry are reviewed.
 */
import {getAddress,isAddress,pad,parseUnits,zeroAddress} from 'viem';
import {GATEWAY_TESTNET_SOURCES,GATEWAY_TESTNET_MINTER,GATEWAY_TESTNET_WALLET} from '../../src/core/gateway/gatewayBalances.js';
import type {GatewayFeeQuote} from '../../src/core/gateway/gatewaySendPlan.js';

export class GatewayEstimateError extends Error {
 constructor(public readonly code:string){super(code);}
}
const fail=(code:string):never=>{throw new GatewayEstimateError(code);};
const bytes32=(addr:string)=>pad(getAddress(addr),{size:32}).toLowerCase();
export interface GatewayEstimateInput {
 walletAddress:string;recipientAddress:string;
 sourceDomain:number;destinationDomain:number;amount:string;salt:string;
}
export interface GatewayEstimateRequest {
 input:GatewayEstimateInput;
 spec:{
  version:1;sourceDomain:number;destinationDomain:number;
  sourceContract:string;destinationContract:string;sourceToken:string;
  destinationToken:string;sourceDepositor:string;destinationRecipient:string;
  sourceSigner:string;destinationCaller:string;value:string;salt:string;hookData:'0x';
 };
}
const UINT256_MAX=(1n<<256n)-1n;
export function createGatewayEstimateRequest(input:GatewayEstimateInput):GatewayEstimateRequest{
 if(!isAddress(input.walletAddress)||!isAddress(input.recipientAddress)||
    !/^0x[0-9a-fA-F]{64}$/.test(input.salt)||!/^\d{1,18}(?:\.\d{1,6})?$/.test(input.amount))
  return fail('GATEWAY_ESTIMATE_ARGUMENT_INVALID');
 const amount=parseUnits(input.amount,6);
 if(amount<=0n)return fail('GATEWAY_ESTIMATE_AMOUNT_INVALID');
 const source=GATEWAY_TESTNET_SOURCES.find(s=>s.domain===input.sourceDomain);
 const destination=GATEWAY_TESTNET_SOURCES.find(s=>s.domain===input.destinationDomain);
 if(!source||!destination)return fail('GATEWAY_ESTIMATE_DOMAIN_UNSUPPORTED');
 return {input,spec:{
  version:1,sourceDomain:source.domain,destinationDomain:destination.domain,
  sourceContract:bytes32(GATEWAY_TESTNET_WALLET),
  destinationContract:bytes32(GATEWAY_TESTNET_MINTER),
  sourceToken:bytes32(source.token),destinationToken:bytes32(destination.token),
  sourceDepositor:bytes32(input.walletAddress),destinationRecipient:bytes32(input.recipientAddress),
  sourceSigner:bytes32(input.walletAddress),destinationCaller:bytes32(zeroAddress),
  value:amount.toString(),salt:input.salt.toLowerCase(),hookData:'0x',
 }};
}

/** Extract a provider quote only if its complete transfer spec exactly
 * matches the reviewed caller specification. Treat missing data as UNKNOWN.
 */
export function parseGatewayEstimate(raw:unknown,request:GatewayEstimateRequest):GatewayFeeQuote{
 const parsed=Array.isArray(raw)?raw:
  raw&&typeof raw==='object'&&Array.isArray((raw as {intents?:unknown}).intents)
    ?(raw as {intents:unknown[]}).intents:null;
 if(!parsed||parsed.length!==1||!parsed[0]||typeof parsed[0]!=='object')
  return fail('GATEWAY_ESTIMATE_RESPONSE_INVALID');
 const top=parsed[0] as Record<string,unknown>;
 const burn=top.burnIntent&&typeof top.burnIntent==='object'&&!Array.isArray(top.burnIntent)
  ?top.burnIntent as Record<string,unknown>:top;
 const spec=burn.spec;
 if(!spec||typeof spec!=='object'||Array.isArray(spec))
  return fail('GATEWAY_ESTIMATE_SPEC_MISSING');
 const actual=spec as Record<string,unknown>;
 const expected=request.spec as Record<string,unknown>;
 for(const key of Object.keys(expected)){
  const expectedValue=expected[key];
  const value=actual[key];
  // Typed API adapters sometimes encode uint32 as strings. No approximation.
  if(String(value).toLowerCase()!==String(expectedValue).toLowerCase())
   return fail('GATEWAY_ESTIMATE_SPEC_CHANGED');
 }
 const fee=burn.maxFee, height=burn.maxBlockHeight;
 if(typeof fee!=='string'||!/^(0|[1-9]\d*)$/.test(fee)||
    typeof height!=='string'||!/^[1-9]\d*$/.test(height))
  return fail('GATEWAY_ESTIMATE_FEE_OR_EXPIRY_MISSING');
 const maxFee=BigInt(fee),maxBlockHeight=BigInt(height);
 if(maxFee>10_000_000_000n||maxBlockHeight>UINT256_MAX)
  return fail('GATEWAY_ESTIMATE_OUT_OF_RANGE');
 return {domain:request.spec.sourceDomain,maxFee,maxBlockHeight};
}
