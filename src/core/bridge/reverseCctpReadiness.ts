/**
 * Reverse CCTP V2 research/readiness ONLY. This is deliberately NOT an
 * executable Veyra Bridge route: the hosted BFF source receipt/attestation
 * service still hard-codes Arc as source and must be generalized, deployed
 * and accepted end-to-end before enabling a reverse USDC burn.
 *
 * All checks read actual source-chain RPC; no mock balances, signatures,
 * permissions, receive attempts or durable Activity records.
 */
import { getAddress, isAddress, type PublicClient } from 'viem';
import { MANIFEST_CONSTANTS } from '../../providers/registry/providerManifest';
import { cctpDepositForBurnCall, chainIdToCctpDomain } from '../../providers/cctp/cctpV2Adapter';
import { createBridgeAction } from '../pipeline/bridgePipeline';

const M = MANIFEST_CONSTANTS;
const ERC20_READ_ABI = [
  { type:'function', name:'balanceOf', stateMutability:'view',
    inputs:[{name:'account',type:'address'}], outputs:[{name:'balance',type:'uint256'}] },
  { type:'function', name:'allowance', stateMutability:'view',
    inputs:[{name:'owner',type:'address'},{name:'spender',type:'address'}],
    outputs:[{name:'allowance',type:'uint256'}] },
] as const;

export type ReverseCctpSourceChainId =
  | typeof M.ETH_SEPOLIA_CHAIN_ID | typeof M.BASE_SEPOLIA_CHAIN_ID;
export const REVERSE_CCTP_SOURCES = [
  { chainId:M.ETH_SEPOLIA_CHAIN_ID, name:'Ethereum Sepolia', token:M.ETH_SEPOLIA_USDC },
  { chainId:M.BASE_SEPOLIA_CHAIN_ID, name:'Base Sepolia', token:M.BASE_SEPOLIA_USDC },
] as const;

export type ReverseCctpReadiness =
  | {status:'UNAVAILABLE';reason:string}
  | {status:'INSUFFICIENT_BALANCE';balance:bigint;allowance:bigint;token:string}
  | {status:'APPROVAL_REQUIRED';balance:bigint;allowance:bigint;token:string}
  | {status:'SIMULATED';balance:bigint;allowance:bigint;token:string};

export function reverseCctpSourceToken(sourceChainId:number):string|null {
  return REVERSE_CCTP_SOURCES.find((entry)=>entry.chainId===sourceChainId)?.token??null;
}

/**
 * This function NEVER requests a wallet signature. A passing eth_call is only
 * source-contract readiness, not a valid settlement quote or a BFF permit.
 */
export async function inspectReverseCctpSource(
  client:PublicClient,
  params:{sourceChainId:number;sender:string;recipient:string;amount:bigint},
):Promise<ReverseCctpReadiness>{
  const token=reverseCctpSourceToken(params.sourceChainId);
  if(!token || params.amount<=0n ||
     !isAddress(params.sender) || !isAddress(params.recipient) ||
     /^0x0{40}$/i.test(params.recipient)){
    return {status:'UNAVAILABLE',reason:'Select a supported testnet source, positive USDC amount, and valid recipient.'};
  }
  try {
    if(await client.getChainId()!==params.sourceChainId)
      return {status:'UNAVAILABLE',reason:'The source RPC network did not match the selected testnet.'};
    // Circle domains and both source/destination USDC contracts are fixed
    // independently of an untrusted wallet provider or Agent prompt.
    if(chainIdToCctpDomain(params.sourceChainId) !==
        (params.sourceChainId===M.ETH_SEPOLIA_CHAIN_ID?M.ETH_SEPOLIA_CCTP_DOMAIN:M.BASE_SEPOLIA_CCTP_DOMAIN) ||
       chainIdToCctpDomain(M.ARC_TESTNET_CHAIN_ID)!==M.ARC_TESTNET_CCTP_DOMAIN)
      return {status:'UNAVAILABLE',reason:'CCTP domain mapping is inconsistent.'};

    const sender=getAddress(params.sender),sourceToken=getAddress(token);
    const messenger=getAddress(M.CCTP_V2_TOKEN_MESSENGER);
    const transmitter=getAddress(M.CCTP_V2_MESSAGE_TRANSMITTER);
    const [tokenCode,messengerCode,transmitterCode,balance,allowance]=await Promise.all([
      client.getCode({address:sourceToken}),
      client.getCode({address:messenger}),
      client.getCode({address:transmitter}),
      client.readContract({address:sourceToken,abi:ERC20_READ_ABI,functionName:'balanceOf',args:[sender]}),
      client.readContract({address:sourceToken,abi:ERC20_READ_ABI,functionName:'allowance',args:[sender,messenger]}),
    ]);
    if(!tokenCode||tokenCode==='0x'||!messengerCode||messengerCode==='0x'||
       !transmitterCode||transmitterCode==='0x')
      return {status:'UNAVAILABLE',reason:'One or more required Circle contracts could not be verified on source RPC.'};
    if(balance<params.amount)
      return {status:'INSUFFICIENT_BALANCE',balance,allowance,token};
    if(allowance<params.amount)
      return {status:'APPROVAL_REQUIRED',balance,allowance,token};

    const action=createBridgeAction({
      from:sender,to:params.recipient,amount:params.amount,
      sourceChainId:params.sourceChainId,
      destinationChainId:M.ARC_TESTNET_CHAIN_ID,
      tokenAddress:sourceToken,tokenDecimals:6,
    });
    await client.simulateContract(cctpDepositForBurnCall(action));
    return {status:'SIMULATED',balance,allowance,token};
  }catch{
    return {status:'UNAVAILABLE',
      reason:'Source RPC read or CCTP eth_call could not be confirmed. No tokens were moved.'};
  }
}
