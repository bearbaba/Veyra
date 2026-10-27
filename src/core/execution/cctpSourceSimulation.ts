/**
 * CCTP source simulation — never substitute route/health preflight for an
 * on-chain eth_call of the exact reviewed depositForBurn transaction.
 */
import { getAddress, type PublicClient } from 'viem';
import type { BridgeAction } from '../actions/actionSchema';
import { MANIFEST_CONSTANTS } from '../../providers/registry/providerManifest';
import { cctpDepositForBurnCall } from '../../providers/cctp/cctpV2Adapter';

const BALANCE_ABI=[{type:'function',name:'balanceOf',stateMutability:'view',
  inputs:[{name:'owner',type:'address'}],outputs:[{name:'',type:'uint256'}]}] as const;
const ALLOWANCE_ABI=[{type:'function',name:'allowance',stateMutability:'view',
  inputs:[{name:'owner',type:'address'},{name:'spender',type:'address'}],outputs:[{name:'',type:'uint256'}]}] as const;
const APPROVE_ABI=[{type:'function',name:'approve',stateMutability:'nonpayable',
  inputs:[{name:'spender',type:'address'},{name:'amount',type:'uint256'}],outputs:[{name:'',type:'bool'}]}] as const;

export interface BridgeSimulationEvidence {
  actionId:string;
  sender:string;
  recipient:string;
  tokenAddress:string;
  amount:bigint;
  sourceChainId:number;
  destinationChainId:number;
  checkedAt:number;
  simulatedCall:'CCTP_V2_DEPOSIT_FOR_BURN';
}
export type CctpSourceSimulationResult=
  | {status:'READY';proof:BridgeSimulationEvidence}
  | {status:'APPROVAL_REQUIRED';allowance:bigint}
  | {status:'BLOCKED';reason:string};

export function matchesCctpSimulation(action:BridgeAction,proof?:BridgeSimulationEvidence,now=Date.now()):boolean{
  return Boolean(proof && proof.simulatedCall==='CCTP_V2_DEPOSIT_FOR_BURN'
    && proof.actionId===action.actionId
    && proof.sender.toLowerCase()===action.from.toLowerCase()
    && proof.recipient.toLowerCase()===action.to.toLowerCase()
    && proof.tokenAddress.toLowerCase()===action.tokenAddress.toLowerCase()
    && proof.amount===action.amount
    && proof.sourceChainId===action.sourceChainId
    && proof.destinationChainId===action.destinationChainId
    && proof.checkedAt>0 && proof.checkedAt<=now && now-proof.checkedAt<=20_000);
}

export async function simulateCctpSourceBurn(
  publicClient:PublicClient,
  action:BridgeAction,
):Promise<CctpSourceSimulationResult>{
  if(action.sourceChainId!==MANIFEST_CONSTANTS.ARC_TESTNET_CHAIN_ID
    || action.tokenAddress.toLowerCase()!==MANIFEST_CONSTANTS.ARC_TESTNET_USDC.toLowerCase()
    || (action.destinationChainId!==MANIFEST_CONSTANTS.ETH_SEPOLIA_CHAIN_ID
       && action.destinationChainId!==MANIFEST_CONSTANTS.BASE_SEPOLIA_CHAIN_ID)){
    return {status:'BLOCKED',reason:'This CCTP source, token or destination is not enabled.'};
  }
  try{
    if(await publicClient.getChainId()!==action.sourceChainId)
      return {status:'BLOCKED',reason:'Source RPC is not Arc Testnet.'};
    const sender=getAddress(action.from),token=getAddress(action.tokenAddress);
    const messenger=getAddress(MANIFEST_CONSTANTS.CCTP_V2_TOKEN_MESSENGER);
    const [balance,allowance,messengerCode]=await Promise.all([
      publicClient.readContract({address:token,abi:BALANCE_ABI,functionName:'balanceOf',args:[sender]}),
      publicClient.readContract({address:token,abi:ALLOWANCE_ABI,functionName:'allowance',args:[sender,messenger]}),
      publicClient.getCode({address:messenger}),
    ]);
    if(!messengerCode||messengerCode==='0x')
      return {status:'BLOCKED',reason:'Could not verify CCTP TokenMessenger on Arc Testnet.'};
    if(balance<action.amount)
      return {status:'BLOCKED',reason:'Insufficient Arc Testnet USDC balance for this bridge.'};
    if(allowance<action.amount)return {status:'APPROVAL_REQUIRED',allowance};
    // eth_call MUST succeed on the exact contract, sender and seven arguments.
    await publicClient.simulateContract(cctpDepositForBurnCall(action));
    return {status:'READY',proof:{
      actionId:action.actionId,sender:action.from,recipient:action.to,tokenAddress:action.tokenAddress,
      amount:action.amount,sourceChainId:action.sourceChainId,
      destinationChainId:action.destinationChainId,checkedAt:Date.now(),
      simulatedCall:'CCTP_V2_DEPOSIT_FOR_BURN',
    }};
  }catch{
    return {status:'BLOCKED',reason:'CCTP deposit simulation failed or Arc RPC unavailable. No tokens were moved.'};
  }
}

/** Separate exact-amount USDC approval simulation; not proof of a burn. */
export async function simulateExactCctpApproval(publicClient:PublicClient,action:BridgeAction):Promise<void>{
  if(action.sourceChainId!==MANIFEST_CONSTANTS.ARC_TESTNET_CHAIN_ID
    || action.tokenAddress.toLowerCase()!==MANIFEST_CONSTANTS.ARC_TESTNET_USDC.toLowerCase()
    || await publicClient.getChainId()!==MANIFEST_CONSTANTS.ARC_TESTNET_CHAIN_ID)
    throw new Error('Cannot approve a mismatched CCTP source chain or token.');
  await publicClient.simulateContract({
    account:getAddress(action.from),address:getAddress(action.tokenAddress),
    abi:APPROVE_ABI,functionName:'approve',
    args:[getAddress(MANIFEST_CONSTANTS.CCTP_V2_TOKEN_MESSENGER),action.amount],
  });
}
