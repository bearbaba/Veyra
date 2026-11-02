/**
 * Fail-closed CCTP V2 linkage verification (Arc <-> Base mainnet).
 * A valid destination Transfer alone does not prove it belongs to the source burn.
 *
 * Circle assigns the signed-message nonce after the source MessageSent event.
 * Resolve it from Circle Iris using the original burn transaction hash, then
 * compare canonical source MessageSent, signed CCTP message, and destination
 * MessageReceived (nonce, sender, source domain, body and destination domain).
 */
import {decodeEventLog,parseAbi,type Hex} from 'viem';
import {getMainnetChain,CCTP_V2_MAINNET} from '@/config/mainnetCatalog';

const hash=/^0x[0-9a-fA-F]{64}$/;
const bytes=/^0x(?:[0-9a-fA-F]{2})+$/;
const events=parseAbi([
 'event MessageSent(bytes message)',
 'event MessageReceived(address indexed caller,uint32 sourceDomain,bytes32 indexed nonce,bytes32 sender,uint32 indexed finalityThresholdExecuted,bytes messageBody)',
]);
type Log={address:string;data:Hex;topics:readonly (Hex|readonly Hex[]|null)[]};
type Receipt={logs:readonly Log[]};
type IrisMessage={status?:unknown;message?:unknown;eventNonce?:unknown;
 destinationMintTxHash?:unknown;sourceTxHash?:unknown};

export function matchCctpLinkedMessages(
 sourceDomain:number,destDomain:number,
 source:Receipt,destination:Receipt,
 signedMessage:string,eventNonce:string,
 expected?:{burnToken:string;mintRecipient:string;amount:bigint},
):boolean{
 if(!bytes.test(signedMessage)||signedMessage.length<2+148*2||
    !hash.test(eventNonce))return false;
 const data=signedMessage.toLowerCase().slice(2);
 const u32=(offset:number)=>parseInt(data.slice(offset*2,offset*2+8),16);
 if(u32(0)!==1||u32(4)!==sourceDomain||u32(8)!==destDomain)return false;
 const nonce='0x'+data.slice(24,88);
 const sender='0x'+data.slice(88,152);
 const body='0x'+data.slice(296);
 if(nonce!==eventNonce.toLowerCase()||!bytes.test(body))return false;
 // TokenMessengerV2 burn body: version/token/mintRecipient/amount/sender/maxFee/
 // feeExecuted/expirationBlock, followed by optional hookData.
 if(body.length<2+228*2||Number.parseInt(body.slice(2,10),16)!==1)return false;
 if(expected){
  const pad=(a:string)=>'0x'+'0'.repeat(24)+a.slice(2).toLowerCase();
  if(!/^0x[0-9a-fA-F]{40}$/.test(expected.burnToken)||
     !/^0x[0-9a-fA-F]{40}$/.test(expected.mintRecipient)||
     '0x'+body.slice(10,74)!==pad(expected.burnToken)||
     '0x'+body.slice(74,138)!==pad(expected.mintRecipient)||
     BigInt('0x'+body.slice(138,202))!==expected.amount)return false;
 }
 const sourceMessages:string[]=[];
 for(const log of source.logs){
  if(log.address.toLowerCase()!==CCTP_V2_MAINNET.messageTransmitterV2.toLowerCase())continue;
  try{
   if(log.topics.some(topic=>typeof topic!=='string'))continue;
   const result=decodeEventLog({abi:events,data:log.data,topics:log.topics as [Hex,...Hex[]]});
   if(result.eventName==='MessageSent')sourceMessages.push(result.args.message.toLowerCase());
  }catch{/* Not a CCTP MessageSent event. */}
 }
 const sourceLinked=sourceMessages.some(original=>{
  if(!bytes.test(original)||original.length<2+(148+228)*2)return false;
  const o=original.slice(2);
  // Compare immutable CCTP header and burn fields, not only the nonce/header.
  // Circle may update nonce, executedFinality, feeExecuted and expirationBlock.
  return o.slice(0,24)===data.slice(0,24)&&
   o.slice(88,288)===data.slice(88,288)&&
   o.slice(296,624)===data.slice(296,624)&&
   o.slice(752)===data.slice(752);
 });
 if(!sourceLinked)return false;
 for(const log of destination.logs){
  if(log.address.toLowerCase()!==CCTP_V2_MAINNET.messageTransmitterV2.toLowerCase())continue;
  try{
   if(log.topics.some(topic=>typeof topic!=='string'))continue;
   const result=decodeEventLog({abi:events,data:log.data,topics:log.topics as [Hex,...Hex[]]});
   if(result.eventName==='MessageReceived'&&
     result.args.sourceDomain===sourceDomain&&
     result.args.nonce.toLowerCase()===nonce&&
     result.args.sender.toLowerCase()===sender&&
     result.args.messageBody.toLowerCase()===body)return true;
  }catch{/* Not the canonical CCTP receive event. */}
 }
 return false;
}

export async function assertCctpBridgeLinked(
 sourceChain:number,destinationChain:number,burnHash:string,mintHash:string,
 burn:Receipt,mint:Receipt,owner:string,amount:bigint,
):Promise<void>{
 const sourceDomain=getMainnetChain(sourceChain)?.cctpDomain;
 const destDomain=getMainnetChain(destinationChain)?.cctpDomain;
 if(sourceDomain===undefined||destDomain===undefined||sourceDomain===destDomain||
    !hash.test(burnHash)||!hash.test(mintHash))
  throw Error('Unsupported CCTP route or missing original transaction hash.');
 const token=getMainnetChain(sourceChain)?.usdc;
 if(!token||!/^0x[0-9a-fA-F]{40}$/.test(owner)||amount<=0n)
  throw Error('Cannot validate the original CCTP token, recipient or amount.');
 const response=await fetch('https://iris-api.circle.com/v2/messages/'+sourceDomain+
   '?transactionHash='+encodeURIComponent(burnHash),{
   method:'GET',headers:{Accept:'application/json'},cache:'no-store',
   signal:AbortSignal.timeout(12000),
 });
 if(!response.ok)throw Error('Circle attestation unavailable. Bridge remains unverified.');
 const payload:unknown=await response.json();
 if(!payload||typeof payload!=='object'||Array.isArray(payload)||
   !('messages' in payload)||!Array.isArray(payload.messages))
  throw Error('Circle did not return a valid attestation response.');
 const messages=payload.messages as IrisMessage[];
 const sourceTxHash='sourceTxHash' in payload?payload.sourceTxHash:undefined;
 if(typeof sourceTxHash==='string'&&sourceTxHash.toLowerCase()!==burnHash.toLowerCase())
  throw Error('Circle attestation belongs to another source transaction.');
 const matches=messages.filter(item=>
   item.status==='complete'&&typeof item.message==='string'&&
   typeof item.eventNonce==='string'&&
   (typeof item.sourceTxHash!=='string'||item.sourceTxHash.toLowerCase()===burnHash.toLowerCase())&&
   (typeof item.destinationMintTxHash!=='string'||item.destinationMintTxHash.toLowerCase()===mintHash.toLowerCase())&&
   matchCctpLinkedMessages(sourceDomain,destDomain,burn,mint,item.message,item.eventNonce,
    {burnToken:token,mintRecipient:owner,amount}));
 if(matches.length!==1)
  throw Error('CCTP source burn and destination mint could not be linked by the Circle signed-message nonce. Do not treat this bridge as complete.');
}
