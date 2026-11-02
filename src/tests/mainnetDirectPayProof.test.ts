import {describe,it,expect} from 'vitest';
import {encodeFunctionData,parseAbi,toEventSelector,type Hex} from 'viem';
import {ARC_MAINNET_USDC,verifyCanonicalDirectPay} from '../../server/services/mainnetDirectPayProof';
const alice='0x1111111111111111111111111111111111111111';
const bob='0x2222222222222222222222222222222222222222';
const token=ARC_MAINNET_USDC;
const hash='0x'+'a'.repeat(64),blockHash='0x'+'b'.repeat(64);
const abi=parseAbi(['function transfer(address to,uint256 value) returns (bool)']);
const pad=(address:string)=>('0x'+'0'.repeat(24)+address.slice(2)) as Hex;
function fixture(){
 const value=120000n;
 const tx={hash,from:alice,to:token,input:encodeFunctionData({abi,functionName:'transfer',args:[bob,value]}),
  value:0n,blockHash};
 const receipt={transactionHash:hash,blockHash,blockNumber:100n,status:'success' as const,
  gasUsed:45000n,effectiveGasPrice:1000000000n,
  logs:[{address:token,topics:[toEventSelector('Transfer(address,address,uint256)'),pad(alice),pad(bob)],
   data:('0x'+value.toString(16).padStart(64,'0')) as Hex}]};
 return {chainId:5042,transaction:tx,receipt,block:{number:100n,hash:blockHash},
  tipBlockNumber:101n,expectedSender:alice};
}
describe('Canonical Arc Mainnet Pay receipt proof (no wallet signing)',()=>{
 it('confirms exactly the sender, recipient, amount, token, event and canonical block',()=>{
  expect(verifyCanonicalDirectPay(fixture())).toMatchObject({txHash:hash,sender:alice,recipient:bob,
   token,chainId:5042,amountRaw:'120000',blockNumber:'100',feeWei:'45000000000000'});
 });
 it('refuses wrong wallet, chain, USDC address, signature calldata and zero amount',()=>{
  const f=fixture();
  expect(()=>verifyCanonicalDirectPay({...f,chainId:5042002})).toThrow('WRONG_MAINNET_CHAIN');
  expect(()=>verifyCanonicalDirectPay({...f,expectedSender:bob})).toThrow('SENDER_WALLET_MISMATCH');
  expect(()=>verifyCanonicalDirectPay({...f,transaction:{...f.transaction,to:bob}})).toThrow('NOT_DIRECT_USDC_TRANSFER');
  expect(()=>verifyCanonicalDirectPay({...f,transaction:{...f.transaction,input:'0x' as Hex}})).toThrow('INVALID_TRANSFER_CALLDATA');
  expect(()=>verifyCanonicalDirectPay({...f,transaction:{...f.transaction,
   input:encodeFunctionData({abi,functionName:'transfer',args:[bob,0n]})}})).toThrow('INVALID_TRANSFER_CALLDATA');
 });
 it('cannot verify a reverted, missing, replaced or unrelated event',()=>{
  const f=fixture();
  expect(()=>verifyCanonicalDirectPay({...f,receipt:{...f.receipt,status:'reverted' as const}})).toThrow('PAYMENT_REVERTED');
  expect(()=>verifyCanonicalDirectPay({...f,receipt:{...f.receipt,logs:[]}})).toThrow('USDC_TRANSFER_LOG_MISMATCH');
  expect(()=>verifyCanonicalDirectPay({...f,receipt:{...f.receipt,
   logs:[{...f.receipt.logs[0]!,topics:[toEventSelector('Transfer(address,address,uint256)'),pad(alice),pad(alice)]}]}}))
   .toThrow('USDC_TRANSFER_LOG_MISMATCH');
  expect(()=>verifyCanonicalDirectPay({...f,block:{...f.block,hash:'0x'+'c'.repeat(64)}})).toThrow('NONCANONICAL_PAYMENT_RECEIPT');
 });
 it('does not call unconfirmed or unfetched receipts verified',()=>{
  const f=fixture();
  expect(()=>verifyCanonicalDirectPay({...f,tipBlockNumber:100n,minConfirmations:2})).toThrow('PAYMENT_NOT_FINALIZED');
  expect(()=>verifyCanonicalDirectPay({...f,receipt:{...f.receipt,blockNumber:102n}})).toThrow('NONCANONICAL_PAYMENT_RECEIPT');
 });
});
