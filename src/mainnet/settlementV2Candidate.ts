/** Standalone, unsigned V2 integration candidate. No Production registry/address.
 * Only an owner-reviewed NEW deployment with pinned runtime code hash may be
 * simulated. Receipt synchronization still requires independent canonical
 * indexer support and is NOT enabled by this module.
 */
import {getAddress,hashTypedData,isAddress,keccak256,parseAbi,
 type Address,type Hex,type PublicClient} from 'viem';

export const LEGACY_VEYRA_SETTLEMENT='0xfbec434fc2190f1887578b7a59b527d1b4acbe98';
export const V2_CANDIDATE_ABI=parseAbi([
 'function pay(address recipient,uint256 amount,bytes32 ref)',
 'function payRequest(address recipient,uint256 amount,bytes32 ref,uint256 deadline,bytes authorization)',
 'function requestDigest(address payer,address recipient,uint256 amount,bytes32 ref,uint256 deadline) view returns (bytes32)',
 'function payerRefUsed(address payer,bytes32 ref) view returns (bool)',
 'function requestRefUsed(bytes32 ref) view returns (bool)',
 'function feeBps() view returns (uint16)',
 'function usdc() view returns (address)',
 'event PaymentSettled(bytes32 indexed paymentId,address indexed payer,address indexed recipient,uint256 amount,uint256 fee,bytes32 ref)',
]);
const REF=/^0x[0-9a-fA-F]{64}$/;
const HASH=/^0x[0-9a-fA-F]{64}$/;
const REQUEST_TYPES={
 PaymentRequest:[
  {name:'payer',type:'address'},{name:'recipient',type:'address'},
  {name:'amount',type:'uint256'},{name:'ref',type:'bytes32'},
  {name:'deadline',type:'uint256'},
 ],
} as const;
export type CandidateV2Deployment={
 address:Address;runtimeCodeHash:Hex;chainId:5042;usdc:Address;
 reviewedByOwner:true;
};
export type V2RequestFields={
 payer:Address;recipient:Address;amount:bigint;ref:Hex;deadline:bigint;
};
export function v2RequestTypedData(deployment:CandidateV2Deployment,fields:V2RequestFields){
 if(!deployment.reviewedByOwner||deployment.chainId!==5042||
  !isAddress(deployment.address)||deployment.address.toLowerCase()===LEGACY_VEYRA_SETTLEMENT||
  !HASH.test(deployment.runtimeCodeHash)||!isAddress(deployment.usdc)||
  !isAddress(fields.payer)||!isAddress(fields.recipient)||
  fields.amount<=0n||!REF.test(fields.ref)||fields.ref==='0x'+'0'.repeat(64)||
  fields.deadline<=0n)
  throw Error('V2 deployment or typed Payment Request review is invalid.');
 return {domain:{name:'VeyraSettlement',version:'2',chainId:5042,
   verifyingContract:getAddress(deployment.address)},
  types:REQUEST_TYPES,primaryType:'PaymentRequest' as const,
  message:{payer:getAddress(fields.payer),recipient:getAddress(fields.recipient),
   amount:fields.amount,ref:fields.ref,deadline:fields.deadline}};
}
export function v2RequestAuthorizationDigest(deployment:CandidateV2Deployment,fields:V2RequestFields){
 return hashTypedData(v2RequestTypedData(deployment,fields));
}
/** Checks the pinned deployed runtime bytecode, chain, USDC and then
 * simulates the entire signed request. Does NOT submit any transaction.
 */
export async function simulateV2RequestCandidate(
 client:Pick<PublicClient,'getChainId'|'getCode'|'readContract'|'simulateContract'>,
 deployment:CandidateV2Deployment,fields:V2RequestFields,authorization:Hex,
 nowSeconds:bigint=BigInt(Math.floor(Date.now()/1000)),
){
 const typed=v2RequestTypedData(deployment,fields);
 if(fields.deadline<=nowSeconds||!/^0x[0-9a-fA-F]*$/.test(authorization)||
  authorization.length<=2)throw Error('Signed request expired or malformed.');
 const chain=await client.getChainId();
 if(chain!==5042)throw Error('V2 candidate chain mismatch.');
 const code=await client.getCode({address:deployment.address});
 if(!code||keccak256(code).toLowerCase()!==deployment.runtimeCodeHash.toLowerCase())
  throw Error('V2 candidate runtime code hash does not match owner review.');
 const usdc=await client.readContract({address:deployment.address,abi:V2_CANDIDATE_ABI,functionName:'usdc'});
 if(usdc.toLowerCase()!==deployment.usdc.toLowerCase())
  throw Error('V2 candidate canonical USDC differs from approved deployment.');
 const simulated=await client.simulateContract({account:fields.payer,
  address:deployment.address,abi:V2_CANDIDATE_ABI,functionName:'payRequest',
  args:[fields.recipient,fields.amount,fields.ref,fields.deadline,authorization]});
 return {digest:hashTypedData(typed),request:simulated.request};
}
