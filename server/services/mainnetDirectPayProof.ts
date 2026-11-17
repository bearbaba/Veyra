/** Canonical Arc Mainnet direct USDC transfer proof; read-only, wallet-signed only.
 * An indexer may persist a sender/receiver receipt ONLY after this returns proof.
 * Input is RPC-derived, never from a user-supplied browser receipt or note.
 */
import {decodeFunctionData,getAddress,isAddress,parseAbi,toEventSelector,type Hex} from 'viem';
export const ARC_MAINNET_ID=5042;
export const ARC_MAINNET_USDC='0x3600000000000000000000000000000000000000' as const;
const TRANSFER_ABI=parseAbi(['function transfer(address to,uint256 value) returns (bool)']);
const TRANSFER_TOPIC=toEventSelector('Transfer(address,address,uint256)');
const HASH=/^0x[0-9a-fA-F]{64}$/;
const word=(a:string):string=>'0x'+'0'.repeat(24)+a.slice(2).toLowerCase();
export type ChainPayTransaction={hash:string;from:string;to:string|null;input:Hex;value:bigint;blockHash:string|null};
export type ChainPayReceipt={
 transactionHash:string;blockHash:string;blockNumber:bigint;status:'success'|'reverted';
 gasUsed:bigint;effectiveGasPrice:bigint;
 logs:ReadonlyArray<{address:string;topics:readonly string[];data:Hex}>;
};
export type ChainPayBlock={number:bigint;hash:string;timestamp:bigint};
export type CanonicalDirectPayProof={
 txHash:string;sender:string;recipient:string;chainId:5042;
 token:typeof ARC_MAINNET_USDC;amountRaw:string;blockNumber:string;blockTimeSeconds:string;feeWei:string;
};
export class DirectPayProofError extends Error{
 constructor(public readonly code:string){super(code);this.name='DirectPayProofError';}
}
const deny=(code:string):never=>{throw new DirectPayProofError(code);};
export function verifyCanonicalDirectPay(
 input:{chainId:number;transaction:ChainPayTransaction;receipt:ChainPayReceipt;
 block:ChainPayBlock;tipBlockNumber:bigint;expectedSender:string;minConfirmations?:number},
):CanonicalDirectPayProof{
 const {transaction:tx,receipt,block}=input;
 if(input.chainId!==ARC_MAINNET_ID)deny('WRONG_MAINNET_CHAIN');
 if(!isAddress(input.expectedSender)||!isAddress(tx.from)||
    tx.from.toLowerCase()!==input.expectedSender.toLowerCase())deny('SENDER_WALLET_MISMATCH');
 if(!HASH.test(tx.hash)||tx.to?.toLowerCase()!==ARC_MAINNET_USDC.toLowerCase()||
    tx.value!==0n||!tx.blockHash)deny('NOT_DIRECT_USDC_TRANSFER');
 if(!HASH.test(receipt.transactionHash)||
    receipt.transactionHash.toLowerCase()!==tx.hash.toLowerCase()||
    receipt.blockHash.toLowerCase()!==(tx.blockHash??'').toLowerCase()||
    block.hash.toLowerCase()!==receipt.blockHash.toLowerCase()||
    block.number!==receipt.blockNumber)deny('NONCANONICAL_PAYMENT_RECEIPT');
 if(receipt.status!=='success')deny('PAYMENT_REVERTED');
 if(block.timestamp<=0n||block.timestamp>8640000000000n)deny('INVALID_CANONICAL_BLOCK_TIME');
 const confirmations=input.minConfirmations??2;
 if(!Number.isSafeInteger(confirmations)||confirmations<1||confirmations>100||
    receipt.blockNumber>input.tipBlockNumber||
    input.tipBlockNumber-receipt.blockNumber+1n<BigInt(confirmations))
   deny('PAYMENT_NOT_FINALIZED');
 let decoded:ReturnType<typeof decodeFunctionData<typeof TRANSFER_ABI>>;
 try{decoded=decodeFunctionData({abi:TRANSFER_ABI,data:tx.input});}
 catch{return deny('INVALID_TRANSFER_CALLDATA');}
 if(decoded.functionName!=='transfer'||!Array.isArray(decoded.args)||decoded.args.length!==2)
  deny('NOT_DIRECT_USDC_TRANSFER');
 const [recipient,amount]=decoded.args;
 if(typeof recipient!=='string'||!isAddress(recipient)||typeof amount!=='bigint'||amount<=0n)
  deny('INVALID_TRANSFER_CALLDATA');
 const matches=receipt.logs.filter(log=>log.address.toLowerCase()===ARC_MAINNET_USDC.toLowerCase()&&
   log.topics.length===3&&log.topics[0]?.toLowerCase()===TRANSFER_TOPIC.toLowerCase()&&
   log.topics[1]?.toLowerCase()===word(tx.from)&&
   log.topics[2]?.toLowerCase()===word(recipient)&&
   /^0x[0-9a-fA-F]{64}$/.test(log.data)&&BigInt(log.data)===amount);
 if(matches.length!==1)deny('USDC_TRANSFER_LOG_MISMATCH');
 return {txHash:tx.hash.toLowerCase(),sender:getAddress(tx.from),recipient:getAddress(recipient),
  chainId:5042,token:ARC_MAINNET_USDC,amountRaw:amount.toString(),
  blockNumber:receipt.blockNumber.toString(),blockTimeSeconds:block.timestamp.toString(),
  feeWei:(receipt.gasUsed*receipt.effectiveGasPrice).toString()};
}
