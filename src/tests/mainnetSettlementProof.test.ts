import {describe,expect,it} from 'vitest';
import {encodeAbiParameters,encodeEventTopics,encodeFunctionData,parseAbi,type Hex} from 'viem';
import {getVeyraSettlementDeployment,ARC_MAINNET_USDC} from '../config/veyraSettlement';
import {verifyCanonicalSettlement} from '../../server/services/mainnetSettlementProof';
const sender='0x1111111111111111111111111111111111111111';
const recipient='0x2222222222222222222222222222222222222222';
const contract=getVeyraSettlementDeployment(5042)!.address;
const hash=('0x'+'a'.repeat(64)) as Hex,blockHash=('0x'+'b'.repeat(64)) as Hex,ref=('0x'+'c'.repeat(64)) as Hex;
const paymentId=('0x'+'d'.repeat(64)) as Hex;
const abi=parseAbi([
 'function pay(address recipient,uint256 amount,bytes32 ref)',
 'event PaymentSettled(bytes32 indexed paymentId,address indexed payer,address indexed recipient,uint256 amount,uint256 fee,bytes32 ref)',
 'event Transfer(address indexed from,address indexed to,uint256 value)',
]);
function transfer(from:string,to:string,value:bigint){
 return {address:ARC_MAINNET_USDC,topics:encodeEventTopics({abi,eventName:'Transfer',
  args:{from:from as Hex,to:to as Hex}}),
  data:encodeAbiParameters([{type:'uint256'}],[value])};
}
function fixture(){
 const amount=100_000n,fee=0n;
 return {chainId:5042,expectedSender:sender,
  transaction:{hash,from:sender,to:contract,
   input:encodeFunctionData({abi,functionName:'pay',args:[recipient,amount,ref]}),
   value:0n,blockHash},
  receipt:{transactionHash:hash,blockHash,blockNumber:100n,status:'success' as const,
   gasUsed:75000n,effectiveGasPrice:1000000000n,logs:[
    {address:contract,topics:encodeEventTopics({abi,eventName:'PaymentSettled',
      args:{paymentId,payer:sender,recipient}}),
     data:encodeAbiParameters([{type:'uint256'},{type:'uint256'},{type:'bytes32'}],
      [amount,fee,ref])},
    transfer(sender,contract,amount),transfer(contract,recipient,amount),
   ]},
  block:{number:100n,hash:blockHash,timestamp:1793610000n},
  tipBlockNumber:102n};
}
describe('canonical Mainnet VeyraSettlement contract payment (read-only)',()=>{
 it('verifies unique contract event and two canonical USDC transfers',()=>{
  expect(verifyCanonicalSettlement(fixture())).toMatchObject({
   txHash:hash,contractAddress:contract.toLowerCase(),sender,recipient,
   ref,paymentId,amountRaw:'100000',netAmountRaw:'100000',protocolFeeRaw:'0',
   blockTimeSeconds:'1793610000'});
 });
 it('rejects wrong user, chain, contract, calldata or pending finality',()=>{
  const f=fixture();
  expect(()=>verifyCanonicalSettlement({...f,chainId:8453})).toThrow('WRONG_MAINNET_CHAIN');
  expect(()=>verifyCanonicalSettlement({...f,expectedSender:recipient})).toThrow('SENDER_WALLET_MISMATCH');
  expect(()=>verifyCanonicalSettlement({...f,transaction:{...f.transaction,to:recipient}})).toThrow('NOT_SETTLEMENT_PAYMENT');
  expect(()=>verifyCanonicalSettlement({...f,transaction:{...f.transaction,input:'0x'}})).toThrow('INVALID_SETTLEMENT_CALLDATA');
  expect(()=>verifyCanonicalSettlement({...f,tipBlockNumber:100n})).toThrow('SETTLEMENT_NOT_FINALIZED');
 });
 it('rejects forged, absent, duplicated or reverted original contract event',()=>{
  const f=fixture();
  expect(()=>verifyCanonicalSettlement({...f,receipt:{...f.receipt,status:'reverted' as const}})).toThrow('SETTLEMENT_REVERTED');
  expect(()=>verifyCanonicalSettlement({...f,receipt:{...f.receipt,logs:f.receipt.logs.slice(1)}}))
   .toThrow('SETTLEMENT_EVENT_NOT_UNIQUE');
  expect(()=>verifyCanonicalSettlement({...f,receipt:{...f.receipt,logs:[f.receipt.logs[0]!,f.receipt.logs[0]!,...f.receipt.logs.slice(1)]}}))
   .toThrow('SETTLEMENT_EVENT_NOT_UNIQUE');
  expect(()=>verifyCanonicalSettlement({...f,receipt:{...f.receipt,
   logs:[{...f.receipt.logs[0]!,address:recipient},...f.receipt.logs.slice(1)]}}))
   .toThrow('SETTLEMENT_EVENT_NOT_UNIQUE');
 });
 it('requires the exact input and output USDC events, not just an emitted Settled event',()=>{
  const f=fixture();
  expect(()=>verifyCanonicalSettlement({...f,receipt:{...f.receipt,
    logs:[f.receipt.logs[0]!,f.receipt.logs[1]!]}}))
   .toThrow('SETTLEMENT_USDC_TRANSFER_MISMATCH');
  expect(()=>verifyCanonicalSettlement({...f,receipt:{...f.receipt,
    logs:[f.receipt.logs[0]!,f.receipt.logs[1]!,transfer(contract,sender,100_000n)]}}))
   .toThrow('SETTLEMENT_USDC_TRANSFER_MISMATCH');
  expect(()=>verifyCanonicalSettlement({...f,block:{...f.block,hash:('0x'+'e'.repeat(64)) as Hex}}))
   .toThrow('NONCANONICAL_SETTLEMENT_RECEIPT');
 });
});
