/** Production Gateway write boundary. Always fail closed until a separately accepted
 * Ethereum/Base canary. No Testnet contract or wallet allowance ever reused.
 * All wallet signatures are requested only from explicit user callbacks.
 */
import {AppKit} from '@circle-fin/app-kit';
import {createViemAdapterFromProvider} from '@circle-fin/adapter-viem-v2';
import {erc20Abi,formatUnits,getAddress,isAddress,parseUnits,type EIP1193Provider,type PublicClient} from 'viem';
import {GATEWAY_MAINNET_CHAINS,GATEWAY_MAINNET_WRITE_ENABLED,
 gatewayMainnetAmount,type GatewayMainnetBalance} from './gatewayMainnetBalances';
import {hasUnresolvedGatewayMainnetOperation,writeGatewayMainnetOperation,
 archiveGatewayMainnetReceipt,
 type GatewayMainnetOperation} from './gatewayMainnetJournal';
import {activeSignedIdentityToken} from '@/lib/api/liveIdentitySession';
import {MAINNET_CANARY_OWNER,MAINNET_CANARY_MAX_UNITS} from './releaseGates';
import {parseGatewaySdkFees,assertGatewaySdkFeesUnchanged,type GatewaySdkFee} from '@/core/gateway/gatewaySdkSpend';
import {planGatewayMultiSource,matchingGatewayAllocation,type GatewayAllocation} from './gatewayMultiSourceAllocation';

/** SDK fee amounts are exact six-decimal USDC; preserve reviewed minimum. */
function minimumGatewayReceive(review:GatewayMainnetReview):string{
 if(review.kind!=='spend'||!review.fees.length)throw Error('Circle fees have not been reviewed.');
 const costs=review.fees.reduce((total,fee)=>total+parseUnits(fee.amount.startsWith('.')?'0'+fee.amount:fee.amount,6),0n);
 const value=parseUnits(review.amount,6);
 if(value<=costs)throw Error('Circle fees exceed this transfer amount.');
 return formatUnits(value-costs,6);
}
const HASH=/^0x[0-9a-fA-F]{64}$/;
/** A first EIP-1193 wallet rejection (code 4001) before ANY successful
 * signature or transaction request is the only SDK failure eligible for
 * cancelling the local UNKNOWN checkpoint without an onchain receipt.
 */
const signingMethod=(method:string)=>method==='eth_sendTransaction'||method==='eth_sendRawTransaction'||
 method==='personal_sign'||method==='eth_sign'||method==='eth_signTypedData'||
 /^eth_signTypedData_v[0-9]+$/.test(method);
const walletRejected=(error:unknown)=>!!error&&typeof error==='object'&&
 'code' in error&&error.code===4001;
export function observeGatewayWalletSigning(provider:EIP1193Provider){
 let completedFinancialRequest=false;
 let rejectedBeforeAnySignature:string|null=null;
 const watched={...provider,request:async(args:Parameters<EIP1193Provider['request']>[0])=>{
  const method=(args as {method:string}).method;
  try{
   const response:unknown=await provider.request(args);
   if(signingMethod(method))completedFinancialRequest=true;
   return response;
  }catch(e){
   if(signingMethod(method)&&walletRejected(e)&&!completedFinancialRequest)
    rejectedBeforeAnySignature=method;
   throw e;
  }
 }} as EIP1193Provider;
 return {provider:watched,
  get rejectedBeforeSignature(){return completedFinancialRequest?null:rejectedBeforeAnySignature;},
 };
}

const chains=GATEWAY_MAINNET_CHAINS;
const picked=(id:number)=>{
 const value=chains.find(x=>x.chainId===id);
 if(!value)throw Error('Gateway network is not in the reviewed Mainnet catalog.');
 return value;
};
export type GatewayMainnetReview={
 kind:'deposit'|'spend';owner:string;sourceChainId:number;destinationChainId?:number;
 recipient:string;amount:string;balance:GatewayMainnetBalance;sessionToken:string;
 fees:GatewaySdkFee[];
 allocations?:GatewayAllocation[];manualSourceChainId?:number;
};
export async function assertGatewayMainnetWallet(provider:EIP1193Provider,owner:string,chainId:number){
 if(!isAddress(owner))throw Error('Invalid connected owner wallet.');
 const [accounts,id]=await Promise.all([provider.request({method:'eth_accounts'}),
  provider.request({method:'eth_chainId'})]);
 if(!Array.isArray(accounts)||typeof accounts[0]!=='string'||!isAddress(accounts[0])||
  accounts[0].toLowerCase()!==owner.toLowerCase()||
  typeof id!=='string'||!/^0x[0-9a-fA-F]+$/.test(id)||
  parseInt(id,16)!==chainId)throw Error('Wallet or source network changed. Review again.');
}
async function adapterFor(input:{provider:EIP1193Provider;owner:string;chainId:number}){
 await assertGatewayMainnetWallet(input.provider,input.owner,input.chainId);
 const adapter=await createViemAdapterFromProvider({provider:input.provider});
 await assertGatewayMainnetWallet(input.provider,input.owner,input.chainId);
 return adapter;
}
/** Quote calculation is read-only, but every execution still requires the
 * hard-coded owner and micro-canary. Changing quote access NEVER opens spend.
 */
export function assertGatewayMainnetCanaryExecution(owner:string,amount:bigint):void{
 if(owner.toLowerCase()!==MAINNET_CANARY_OWNER.toLowerCase()||
  amount<=0n||amount>MAINNET_CANARY_MAX_UNITS)
  throw Error('Unified Mainnet canary requires the authorized owner and up to 0.01 USDC.');
}
function validate(review:GatewayMainnetReview,execution=true){
 const owner=getAddress(review.owner).toLowerCase(),source=picked(review.sourceChainId);
 if(!gatewayMainnetAmount(review.amount)||!isAddress(review.recipient)||
  review.balance.owner!==owner||review.balance.readAt<Date.now()-60000||
  review.balance.readAt>Date.now()+5000)
  throw Error('Unified amount, recipient or confirmed balance needs a new review.');
 if(!review.sessionToken||activeSignedIdentityToken()!==review.sessionToken)
  throw Error('Veyra ID session changed. Sign in again.');
 const amount=parseUnits(review.amount,6);
 // New real-money operations begin with an explicit, owner-only small-value canary.
 if(execution)assertGatewayMainnetCanaryExecution(owner,amount);
 if(review.kind==='spend'){
  if(!review.destinationChainId)throw Error('Destination not reviewed.');
  picked(review.destinationChainId);
  const allocation=planGatewayMultiSource(review.balance,review.amount,review.manualSourceChainId);
  if(!review.allocations||!matchingGatewayAllocation(allocation,review.allocations)||
   review.allocations[0]?.chainId!==review.sourceChainId)
   throw Error('Source allocation changed. Review the amounts and fees again.');
 }
 return {owner,source,amount};
}
/** One Circle spend intent, with exact reviewed multi-source allocations.
 * Never emit N independent fallback transfers or auto retry. */
function reviewedSdkAllocations(review:GatewayMainnetReview){
 if(!review.allocations?.length)throw Error('Source allocation was not reviewed.');
 const parts=review.allocations.map(x=>({chain:picked(x.chainId).chain,amount:x.amount}));
 return parts.length===1?parts[0]:parts;
}
export async function estimateGatewayMainnetSpend(review:GatewayMainnetReview,
 provider:EIP1193Provider):Promise<GatewaySdkFee[]>{
 const {owner,source}=validate({...review,kind:'spend'},false);
 const adapter=await adapterFor({provider,owner,chainId:source.chainId});
 const destination=picked(review.destinationChainId!);
 const kit=new AppKit();
 const fees=await kit.unifiedBalance.estimateSpend({
  from:{adapter,allocations:reviewedSdkAllocations(review)},
  to:{chain:destination.chain,recipientAddress:getAddress(review.recipient),useForwarder:true},
  amount:review.amount,token:'USDC',
 });
 return parseGatewaySdkFees(fees.fees);
}
export async function submitGatewayMainnetReview(review:GatewayMainnetReview,
 provider:EIP1193Provider,publicClient:PublicClient):Promise<GatewayMainnetOperation>{
 if(!GATEWAY_MAINNET_WRITE_ENABLED)
  throw Error('Unified Mainnet writes are not enabled in Veyra until a real transfer is accepted.');
 const {owner,source,amount}=validate(review);
 if(hasUnresolvedGatewayMainnetOperation(owner))
  throw Error('Original Unified operation is unresolved. Refresh Activity; never sign twice.');
 if(await publicClient.getChainId()!==source.chainId)
  throw Error('Source RPC chain ID differs from review. No signature requested.');
 const gas=await publicClient.getBalance({address:getAddress(owner)});
 if(review.kind==='deposit'&&gas<=0n)throw Error('Source wallet needs network gas for the deposit. Arc uses USDC as gas.');
 if(review.kind==='deposit'){
  const balance=await publicClient.readContract({address:source.usdc,abi:erc20Abi,
   functionName:'balanceOf',args:[getAddress(owner)]});
  if(balance<amount)throw Error('Insufficient source wallet USDC.');
 }
 const watched=observeGatewayWalletSigning(provider);
 const adapter=await adapterFor({provider:watched.provider,owner,chainId:source.chainId});
 if(activeSignedIdentityToken()!==review.sessionToken)
  throw Error('Signed Veyra ID session changed.');
 const kit=new AppKit();
 if(review.kind==='spend'){
  const latest=await estimateGatewayMainnetSpend(review,provider);
  assertGatewaySdkFeesUnchanged(review.fees,latest);
 }
 await assertGatewayMainnetWallet(provider,owner,source.chainId);
 if(hasUnresolvedGatewayMainnetOperation(owner))
  throw Error('Unresolved Unified checkpoint; signing is blocked.');
 const operation:GatewayMainnetOperation={
  version:1,id:crypto.randomUUID(),owner,kind:review.kind,chainId:source.chainId,
  ...(review.destinationChainId?{destinationChainId:review.destinationChainId}:{}),
  recipient:getAddress(review.recipient),amount:review.amount,createdAt:Date.now(),
  status:'UNKNOWN',
  ...(review.kind==='spend'?{allocations:review.allocations?.map(x=>({chainId:x.chainId,amount:x.amount}))}:{}),
  ...(review.kind==='deposit'?{
   beforeAvailable:formatUnits(review.balance.chains.find(c=>c.chainId===source.chainId)?.available??0n,6),
  }:{minimumReceive:minimumGatewayReceive(review)}),
 };
 if(!writeGatewayMainnetOperation(operation))
  throw Error('Recovery checkpoint storage failed. No wallet signature requested.');
 // SDK may have initiated approval or signed the spend when a provider throws;
 // never delete the UNKNOWN checkpoint after any error.
 if(review.kind==='deposit'){
  let result:Awaited<ReturnType<AppKit['unifiedBalance']['deposit']>>;
  try{
   result=await kit.unifiedBalance.deposit({
    from:{adapter,chain:source.chain},amount:review.amount,token:'USDC',
    allowanceStrategy:'approve',
   });
  }catch(error){
   if(watched.rejectedBeforeSignature){
    const archived=archiveGatewayMainnetReceipt({
     version:1,operationId:operation.id,owner,kind:'deposit',status:'CANCELLED_BEFORE_SOURCE',
     chainId:operation.chainId,recipient:operation.recipient,amount:operation.amount,
     verifiedAt:Date.now(),rejectionMethod:watched.rejectedBeforeSignature,
    });
    if(archived)throw Error('Wallet declined before any signature. No Gateway deposit was sent; you can review a new request.');
   }
   throw error;
  }
  const txHash=typeof result.txHash==='string'&&HASH.test(result.txHash)?result.txHash:undefined;
  const submitted:GatewayMainnetOperation={...operation,status:'SUBMITTED',...(txHash?{sourceHash:txHash}:{})};
  if(!writeGatewayMainnetOperation(submitted))
   throw Error('Deposit submitted but local recovery could not be saved. Check wallet Activity; never resend.');
  return submitted;
 }
 const dest=picked(review.destinationChainId!);
 let result:Awaited<ReturnType<AppKit['unifiedBalance']['spend']>>;
 try{
  result=await kit.unifiedBalance.spend({
   from:{adapter,allocations:reviewedSdkAllocations(review)},
   to:{chain:dest.chain,recipientAddress:getAddress(review.recipient),useForwarder:true},
   amount:review.amount,token:'USDC',
  });
 }catch(error){
  if(watched.rejectedBeforeSignature){
   const archived=archiveGatewayMainnetReceipt({
    version:1,operationId:operation.id,owner,kind:'spend',status:'CANCELLED_BEFORE_SOURCE',
    chainId:operation.chainId,destinationChainId:operation.destinationChainId,
    recipient:operation.recipient,amount:operation.amount,
    verifiedAt:Date.now(),rejectionMethod:watched.rejectedBeforeSignature,
   });
   if(archived)throw Error('Wallet declined before any signature. No Gateway transfer was signed; you can review again.');
  }
  throw error;
 }
 const txHash=typeof result.txHash==='string'&&HASH.test(result.txHash)?result.txHash:undefined;
 const transferId=typeof result.transferId==='string'?result.transferId:undefined;
 const pending:GatewayMainnetOperation={...operation,status:'DESTINATION_UNVERIFIED',
  ...(txHash?{sourceHash:txHash}:{}),...(transferId?{transferId}:{}),
 };
 if(!writeGatewayMainnetOperation(pending))
  throw Error('Gateway transfer submitted but local checkpoint failed. Do not sign another.');
 return pending;
}
