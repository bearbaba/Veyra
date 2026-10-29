/**
 * Testnet Gateway deposit provenance. A successful receipt alone is not
 * enough: the hash must correspond to the exact reviewed deposit.
 * This check does NOT establish Circle finality/credit by itself.
 */
import {decodeFunctionData, getAddress, parseUnits} from 'viem';
import {GATEWAY_TESTNET_SOURCES,GATEWAY_TESTNET_WALLET,isGatewayDepositAmount} from './gatewayBalances';

export const GATEWAY_DEPOSIT_ABI=[{
  type:'function',name:'deposit',stateMutability:'nonpayable',
  inputs:[{name:'token',type:'address'},{name:'value',type:'uint256'}],outputs:[],
}] as const;

export interface GatewayDepositProof {
  owner:string;
  chainId:number;
  amount:string;
}
export interface GatewaySourceTransaction {
  from:string;
  to:string|null;
  input:string;
}

/** Fail closed on a wrong sender, receiver, token, method or amount. */
export function isMatchingGatewayDepositTransaction(
  tx:GatewaySourceTransaction,checkpoint:GatewayDepositProof,
):boolean{
  try{
    if(!isGatewayDepositAmount(checkpoint.amount))return false;
    const source=GATEWAY_TESTNET_SOURCES.find(s=>s.chainId===checkpoint.chainId);
    if(!source||!tx.to)return false;
    if(getAddress(tx.from)!==getAddress(checkpoint.owner)||
       getAddress(tx.to)!==getAddress(GATEWAY_TESTNET_WALLET))return false;
    const decoded=decodeFunctionData({abi:GATEWAY_DEPOSIT_ABI,data:tx.input as `0x${string}`});
    return decoded.functionName==='deposit' &&
      getAddress(decoded.args[0])===getAddress(source.token) &&
      decoded.args[1]===parseUnits(checkpoint.amount,6);
  }catch{return false;}
}
