/** Read-only, canonical VeyraSettlement.pay proof. Never uses browser-supplied
 * recipient, amount, success status, or identity claims as chain evidence.
 */
import {decodeEventLog,decodeFunctionData,erc20Abi,getAddress,isAddress,parseAbi,type Hex} from 'viem';
import {getVeyraSettlementDeployment,ARC_MAINNET_USDC} from '../../src/config/veyraSettlement.js';
import type {ChainPayTransaction,ChainPayReceipt,ChainPayBlock} from './mainnetDirectPayProof.js';

const ARC=5042;
const HASH=/^0x[0-9a-fA-F]{64}$/;
const SETTLEMENT_ABI=parseAbi([
 'function pay(address recipient,uint256 amount,bytes32 ref)',
 'event PaymentSettled(bytes32 indexed paymentId,address indexed payer,address indexed recipient,uint256 amount,uint256 fee,bytes32 ref)',
]);
export class SettlementProofError extends Error{
 constructor(public readonly code:string){super(code);this.name='SettlementProofError';}
}
const reject=(code:string):never=>{throw new SettlementProofError(code);};
export type CanonicalSettlementProof={
 txHash:string;chainId:5042;contractAddress:string;paymentId:string;ref:string;
 sender:string;recipient:string;amountRaw:string;netAmountRaw:string;protocolFeeRaw:string;
 feeWei:string;blockNumber:string;blockTimeSeconds:string;
};
export function verifyCanonicalSettlement(input:{
 chainId:number;expectedSender:string;transaction:ChainPayTransaction;
 receipt:ChainPayReceipt;block:ChainPayBlock;tipBlockNumber:bigint;minConfirmations?:number;
}):CanonicalSettlementProof{
 const {transaction:tx,receipt,block}=input;
 const deploy=getVeyraSettlementDeployment(ARC);
 if(!deploy)return reject('SETTLEMENT_DEPLOYMENT_UNAVAILABLE');
 if(input.chainId!==ARC)return reject('WRONG_MAINNET_CHAIN');
 if(!isAddress(input.expectedSender)||!isAddress(tx.from)||
   tx.from.toLowerCase()!==input.expectedSender.toLowerCase())return reject('SENDER_WALLET_MISMATCH');
 if(!HASH.test(tx.hash)||tx.to?.toLowerCase()!==deploy.address.toLowerCase()||
  tx.value!==0n||!tx.blockHash)return reject('NOT_SETTLEMENT_PAYMENT');
 if(receipt.transactionHash.toLowerCase()!==tx.hash.toLowerCase()||
  receipt.blockHash.toLowerCase()!==tx.blockHash.toLowerCase()||
  block.hash.toLowerCase()!==receipt.blockHash.toLowerCase()||
  receipt.blockNumber!==block.number)return reject('NONCANONICAL_SETTLEMENT_RECEIPT');
 if(receipt.status!=='success')return reject('SETTLEMENT_REVERTED');
 if(block.timestamp<=0n||block.timestamp>8640000000000n)
  return reject('INVALID_CANONICAL_BLOCK_TIME');
 const confirmations=input.minConfirmations??2;
 if(!Number.isSafeInteger(confirmations)||confirmations<1||confirmations>100||
   receipt.blockNumber>input.tipBlockNumber||
   input.tipBlockNumber-receipt.blockNumber+1n<BigInt(confirmations))
  return reject('SETTLEMENT_NOT_FINALIZED');
 let recipient:string,amount:bigint,ref:string;
 try{
  const call=decodeFunctionData({abi:SETTLEMENT_ABI,data:tx.input});
  if(call.functionName!=='pay'||!Array.isArray(call.args)||call.args.length!==3)
   return reject('NOT_SETTLEMENT_PAYMENT');
  [recipient,amount,ref]=call.args;
 }catch{return reject('INVALID_SETTLEMENT_CALLDATA');}
 if(!isAddress(recipient)||amount<=0n||!HASH.test(ref))
  return reject('INVALID_SETTLEMENT_CALLDATA');
 const events: Array<{paymentId:string;payer:string;recipient:string;amount:bigint;fee:bigint;ref:string}>=[];
 const transfers: Array<{from:string;to:string;value:bigint}>=[];
 for(const log of receipt.logs){
  if(log.address.toLowerCase()===deploy.address.toLowerCase()){
   try{
    const decoded=decodeEventLog({abi:SETTLEMENT_ABI,data:log.data,topics:log.topics as [Hex,...Hex[]]});
    if(decoded.eventName==='PaymentSettled')events.push(decoded.args);
   }catch{/* Never trust non-payment events. */}
  }
  if(log.address.toLowerCase()===ARC_MAINNET_USDC.toLowerCase()){
   try{
    const decoded=decodeEventLog({abi:erc20Abi,data:log.data,topics:log.topics as [Hex,...Hex[]]});
    if(decoded.eventName==='Transfer')transfers.push(decoded.args);
   }catch{/* Non-Transfer logs do not authorize credit. */}
  }
 }
 if(events.length!==1)return reject('SETTLEMENT_EVENT_NOT_UNIQUE');
 const event=events[0]!;
 if(event.payer.toLowerCase()!==tx.from.toLowerCase()||
  event.recipient.toLowerCase()!==recipient.toLowerCase()||
  event.amount!==amount||event.ref.toLowerCase()!==ref.toLowerCase()||
  !HASH.test(event.paymentId)||event.fee<0n||event.fee>=amount||
  event.fee*10000n>amount*100n)
  return reject('SETTLEMENT_EVENT_MISMATCH');
 const count=(sender:string,target:string,value:bigint)=>transfers.filter(v=>
  v.from.toLowerCase()===sender.toLowerCase()&&
  v.to.toLowerCase()===target.toLowerCase()&&v.value===value).length;
 if(count(tx.from,deploy.address,amount)!==1||
  count(deploy.address,recipient,amount-event.fee)!==1)
  return reject('SETTLEMENT_USDC_TRANSFER_MISMATCH');
 return {txHash:tx.hash.toLowerCase(),chainId:5042,contractAddress:deploy.address.toLowerCase(),
  paymentId:event.paymentId.toLowerCase(),ref:ref.toLowerCase(),
  sender:getAddress(tx.from),recipient:getAddress(recipient),
  amountRaw:amount.toString(),netAmountRaw:(amount-event.fee).toString(),
  protocolFeeRaw:event.fee.toString(),
  feeWei:(receipt.gasUsed*receipt.effectiveGasPrice).toString(),
  blockNumber:receipt.blockNumber.toString(),blockTimeSeconds:block.timestamp.toString()};
}
