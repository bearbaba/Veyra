/**
 * Independently verify a destination Circle Gateway USDC mint against the
 * already owner-bound Circle forwarding status and the signed user review.
 * Do not equate a provider status or submitted tx with confirmed receipt.
 */
import {formatUnits,getAddress,isAddress,keccak256,pad,parseUnits,stringToHex,zeroAddress} from 'viem';

export interface GatewayDestinationProof {
 chainId:number;txHash:string;mintedUsdc:string;
}
type ReceiptEvidence={
 status:string;transactionHash:string;
 logs:ReadonlyArray<{address:string;topics:ReadonlyArray<string>;data:string}>;
};
const TRANSFER=keccak256(stringToHex('Transfer(address,address,uint256)'));
const MINT_FROM=pad(zeroAddress,{size:32}).toLowerCase();
const USDC=/^\d{1,18}(?:\.\d{1,6})?$/;

/** Requires mint Transfer(0x0, recipient, value) from the pinned USDC token. */
export function verifyGatewayDestinationMint(receipt:ReceiptEvidence,input:{
 expectedHash:string;token:string;recipient:string;amount:string;
 minReceive:string;chainId:number;
}):GatewayDestinationProof{
 if(!isAddress(input.token)||!isAddress(input.recipient)||!USDC.test(input.amount)||
    !USDC.test(input.minReceive)||!Number.isInteger(input.chainId)||
    !/^0x[0-9a-fA-F]{64}$/.test(input.expectedHash))
  throw Error('Gateway destination evidence is invalid.');
 const maximum=parseUnits(input.amount,6),minimum=parseUnits(input.minReceive,6);
 if(minimum<=0n||minimum>maximum||receipt.status!=='success'||
    receipt.transactionHash.toLowerCase()!==input.expectedHash.toLowerCase()||
    !Array.isArray(receipt.logs))
  throw Error('Destination mint is not a confirmed matching transaction.');
 const recipientTopic=pad(getAddress(input.recipient),{size:32}).toLowerCase();
 let credited=0n;
 for(const log of receipt.logs){
  if(!log||!isAddress(log.address)||
     getAddress(log.address)!==getAddress(input.token))continue;
  if(log.topics.length!==3||
     log.topics[0]?.toLowerCase()!==TRANSFER.toLowerCase()||
     log.topics[1]?.toLowerCase()!==MINT_FROM||
     log.topics[2]?.toLowerCase()!==recipientTopic)continue;
  if(!/^0x[0-9a-fA-F]{64}$/.test(log.data))
   throw Error('Malformed destination mint amount.');
  credited+=BigInt(log.data);
 }
 if(credited<minimum||credited>maximum)
  throw Error('Destination USDC mint amount does not meet the reviewed range.');
 return {chainId:input.chainId,txHash:input.expectedHash,
  mintedUsdc:formatUnits(credited,6)};
}
