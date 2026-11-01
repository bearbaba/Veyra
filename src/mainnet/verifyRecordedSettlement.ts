/**
 * Read-only Mainnet VeyraSettlement.pay reconciliation for Activity.
 *
 * A browser operation pointer is NOT proof. We re-fetch the original signed
 * transaction, canonical block, contract event and both real USDC transfers.
 * We cannot recover the original pre-sign review snapshot from this index:
 * the receipt is verified against the tx calldata + wallet-local pointer.
 * This function never signs, retries, or changes spending permissions.
 */
import {decodeEventLog,decodeFunctionData,erc20Abi,formatUnits,isAddress,parseUnits,type Hash} from 'viem';
import {arcMainnetRpc,assertArcMainnetNetwork} from './arcMainnetPay';
import {ARC_MAINNET_CHAIN_ID,ARC_MAINNET_USDC,VEYRA_SETTLEMENT_ABI,getVeyraSettlementDeployment} from '@/config/veyraSettlement';
import {verifyPaymentReceipt,type PaymentSettledArgs,type TransferLog} from '@/lib/settlementVerify';
import type {Inspection} from './verifyArcTransfer';

const HASH=/^0x[0-9a-fA-F]{64}$/;
const AMOUNT=/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,6})?$/;
function obj(raw:unknown):Record<string,unknown>{
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('Malformed Arc RPC response');
  return raw as Record<string,unknown>;
}
function hex(raw:unknown):bigint{
  if(typeof raw!=='string'||!/^0x[0-9a-fA-F]+$/.test(raw))throw Error('Malformed Arc RPC quantity');
  return BigInt(raw);
}
function same(a:unknown,b:string):boolean{
  return typeof a==='string'&&a.toLowerCase()===b.toLowerCase();
}
function unverified(hash:string,detail:string):Inspection{return {hash,status:'UNVERIFIED',detail};}

export async function inspectRecordedSettlement(
  hash:string,owner:string,amount:string,recipient:string|undefined,
):Promise<Inspection>{
  if(!HASH.test(hash)||!isAddress(owner)||!recipient||!isAddress(recipient)||
      !AMOUNT.test(amount)||parseUnits(amount,6)<=0n)
    return unverified(hash,'Missing or invalid wallet-scoped payment details. Open the original transaction.');
  const deployment=getVeyraSettlementDeployment(ARC_MAINNET_CHAIN_ID);
  if(!deployment)return unverified(hash,'No pinned Arc Mainnet settlement contract.');
  await assertArcMainnetNetwork();
  const txRaw=await arcMainnetRpc('eth_getTransactionByHash',[hash]);
  if(!txRaw)return {hash,status:'PENDING',detail:'Transaction not indexed yet. Recheck without signing.'};
  const tx=obj(txRaw);
  if(!same(tx.hash,hash)||!same(tx.from,owner)||!same(tx.to,deployment.address)||hex(tx.value)!==0n)
    return unverified(hash,'Transaction sender, contract or value does not match this payment.');
  let calldataRecipient:string,calldataAmount:bigint,calldataRef:string;
  try{
    const decoded=decodeFunctionData({abi:VEYRA_SETTLEMENT_ABI,data:tx.input as Hash});
    if(decoded.functionName!=='pay'||!Array.isArray(decoded.args)||decoded.args.length!==3)
      return unverified(hash,'Transaction did not call VeyraSettlement.pay().');
    calldataRecipient=decoded.args[0] as string;
    calldataAmount=decoded.args[1] as bigint;
    calldataRef=decoded.args[2] as string;
  }catch{return unverified(hash,'Could not decode the original pay() calldata.');}
  if(!same(calldataRecipient,recipient)||calldataAmount!==parseUnits(amount,6)||
      typeof calldataRef!=='string'||!HASH.test(calldataRef))
    return unverified(hash,'Original signed recipient, amount or reference differs from recorded details.');
  const receiptRaw=await arcMainnetRpc('eth_getTransactionReceipt',[hash]);
  if(!receiptRaw)return {hash,status:'PENDING',detail:'Awaiting transaction receipt. No new signature is required.'};
  const receipt=obj(receiptRaw);
  if(!same(receipt.transactionHash,hash)||!same(receipt.to,deployment.address)||
      typeof receipt.blockHash!=='string'||!HASH.test(receipt.blockHash)||
      !same(tx.blockHash,receipt.blockHash))
    return unverified(hash,'Receipt, contract or block identity does not match the original transaction.');
  if(receipt.status==='0x0')return {hash,status:'REVERTED',detail:'Settlement reverted on Arc Mainnet.'};
  if(receipt.status!=='0x1')return unverified(hash,'Unrecognized settlement receipt status.');
  const block=obj(await arcMainnetRpc('eth_getBlockByNumber',[receipt.blockNumber,false]));
  if(!same(block.hash,receipt.blockHash))
    return unverified(hash,'Receipt block could not be matched to the canonical Arc block.');
  const logs=Array.isArray(receipt.logs)?receipt.logs:[];
  let event:PaymentSettledArgs|null=null;
  const transfers:TransferLog[]=[];
  for(const rawLog of logs){
    if(!rawLog||typeof rawLog!=='object'||Array.isArray(rawLog))continue;
    const log=obj(rawLog);
    if(typeof log.address!=='string'||typeof log.data!=='string'||!Array.isArray(log.topics))continue;
    try{
      if(same(log.address,deployment.address)&&!event){
        const decoded=decodeEventLog({abi:VEYRA_SETTLEMENT_ABI,data:log.data as Hash,topics:log.topics as [Hash,...Hash[]]});
        if(decoded.eventName==='PaymentSettled'){
          const args=decoded.args as unknown as {
            paymentId:string;payer:string;recipient:string;amount:bigint;fee:bigint;ref:string
          };
          event={emitterAddress:log.address,paymentId:args.paymentId,payer:args.payer,
            recipient:args.recipient,amount:args.amount,fee:args.fee,ref:args.ref};
        }
      }
      if(same(log.address,ARC_MAINNET_USDC)){
        const decoded=decodeEventLog({abi:erc20Abi,data:log.data as Hash,topics:log.topics as [Hash,...Hash[]]});
        if(decoded.eventName==='Transfer'){
          const t=decoded.args;
          transfers.push({tokenAddress:log.address,from:t.from,to:t.to,value:t.value});
        }
      }
    }catch{/* Ignore other canonical-contract logs, never count them as proof. */}
  }
  if(!event||event.fee<0n||event.fee>event.amount||
      event.fee*10_000n>event.amount*100n)
    return unverified(hash,'Expected PaymentSettled event or valid fee not found.');
  const amountUnits=parseUnits(amount,6);
  const result=verifyPaymentReceipt({
    status:'success',to:receipt.to as string,transactionHash:hash,
    blockNumber:hex(receipt.blockNumber),gasUsed:hex(receipt.gasUsed),
  },ARC_MAINNET_CHAIN_ID,event,transfers,{
    chainId:ARC_MAINNET_CHAIN_ID,walletAddress:owner,recipient,amountParsed:amountUnits,
    contractAddress:deployment.address,usdcAddress:ARC_MAINNET_USDC,feeBps:0n,
    feeAmount:event.fee,netAmount:amountUnits-event.fee,ref:calldataRef,
  });
  if(!result.verified)return unverified(hash,'Onchain settlement evidence mismatch: '+result.failReasons.join('; '));
  return {hash,status:'VERIFIED',detail:
    'Onchain VeyraSettlement.pay verified: '+formatUnits(amountUnits-event.fee,6)+
    ' USDC reached '+recipient+'; fee '+formatUnits(event.fee,6)+
    ' USDC; block '+result.blockNumber+'. Original pre-sign review is not stored in Activity.'};
}
