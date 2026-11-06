/** Simulated, never a mainnet payment: full recovery lifecycle from an
 * original finalized deposit to an independent Circle balance and two more
 * user-originated operations. No fabricated provider credit is ever claimed.
 */
import {describe,it,expect} from 'vitest';
import {encodeFunctionData,encodeEventTopics,encodeAbiParameters,parseAbi,type Hex} from 'viem';
import {gatewayDepositAbi,GATEWAY_MAINNET_WALLET,reconcileGatewayMainnetOperation,
 type GatewayReconciliationDeps,type GatewayChainReceipt} from '../mainnet/gatewayMainnetReconcile';
import {writeGatewayMainnetOperation,readGatewayMainnetOperation,readGatewayMainnetHistory,
 type GatewayMainnetOperation} from '../mainnet/gatewayMainnetJournal';
import {parseGatewayMainnetBalance} from '../mainnet/gatewayMainnetBalances';
const owner='0x1111111111111111111111111111111111111111';
const recipient='0x2222222222222222222222222222222222222222';
const baseUsdc='0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const ethUsdc='0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const source='0x'+'a'.repeat(64),destination='0x'+'b'.repeat(64),block='0x'+'c'.repeat(64);
const specHash='0x'+'d'.repeat(64);
const transferId='ffffffff-ffff-4fff-8fff-ffffffffffff';
const transferAbi=parseAbi(['event Transfer(address indexed from,address indexed to,uint256 value)']);
const log=(token:string,from:string,to:string,value:bigint)=>({
 address:token,topics:encodeEventTopics({abi:transferAbi,eventName:'Transfer',
  args:{from:from as Hex,to:to as Hex}}).flatMap(x=>typeof x==='string'?[x]:[]),
 data:encodeAbiParameters([{type:'uint256'}],[value]),
});
const sourceReceipt:GatewayChainReceipt={status:'success',transactionHash:source,
 blockHash:block,blockNumber:10n,logs:[log(baseUsdc,owner,GATEWAY_MAINNET_WALLET,10000n)]};
const destinationReceipt:GatewayChainReceipt={status:'success',transactionHash:destination,
 blockHash:block,blockNumber:10n,logs:[log(ethUsdc,GATEWAY_MAINNET_WALLET,recipient,9000n)]};
const pad=(address:string)=>'0x'+'0'.repeat(24)+address.slice(2).toLowerCase();
const transfer={
 transfer:{status:'finalized',destinationDomain:0,transactionHash:destination,
  forwardingDetails:{forwardingEnabled:true},burnIntents:[{transferSpecHash:specHash}]},
 spec:{sourceDomain:6,destinationDomain:0,
  sourceContract:pad(GATEWAY_MAINNET_WALLET),
  destinationContract:pad('0x2222222d7164433c4C09B0b0D809a9b52C04C205'),
  sourceToken:pad(baseUsdc),destinationToken:pad(ethUsdc),
  sourceDepositor:pad(owner),sourceSigner:pad(owner),
  destinationRecipient:pad(recipient),value:'10000'},
};
const createStore=()=>{
 const storage=new Map<string,string>();
 return {getItem:(key:string)=>storage.get(key)??null,
  setItem:(key:string,value:string)=>{storage.set(key,value);},
  removeItem:(key:string)=>{storage.delete(key);}};
};
const deps:GatewayReconciliationDeps={
 getTransaction:()=>Promise.resolve({
  from:owner,to:GATEWAY_MAINNET_WALLET,hash:source,
  input:encodeFunctionData({abi:gatewayDepositAbi,functionName:'deposit',
   args:[baseUsdc,10000n]})}),
 getTransactionReceipt:(_id,hash)=>Promise.resolve(hash===source?sourceReceipt:destinationReceipt),
 getCanonicalBlock:(_id,number)=>Promise.resolve({
  hash:block,number,timestamp:BigInt(Math.floor(Date.now()/1000))-3600n}),
 getFinalizedBlock:()=>Promise.resolve({hash:block,number:1000n,timestamp:0n}),
 getLatestBlockNumber:()=>Promise.resolve(1100n),
 getForwardingStatus:()=>Promise.resolve(transfer),
};
const deposit:GatewayMainnetOperation={version:1,id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 kind:'deposit',chainId:8453,owner,recipient:owner,amount:'0.01',
 sourceHash:source,status:'SUBMITTED',createdAt:Date.now()};
describe('Gateway second operation after onchain-finalized source deposit',()=>{
 it('closes source only, displays actual Circle balance independently, completes spend then allows a third operation',async()=>{
  const storage=createStore();
  expect(writeGatewayMainnetOperation(deposit,storage)).toBe(true);
  const first=await reconcileGatewayMainnetOperation(owner,deps,storage);
  expect(first.state).toBe('SOURCE_FINALIZED');
  expect(first.receipt?.gatewayCreditReference).toBeUndefined();
  expect(readGatewayMainnetOperation(owner,storage)).toBeNull();
  const notCredited=parseGatewayMainnetBalance({token:'USDC',totalConfirmedBalance:'0',
   breakdown:[{depositor:owner,totalConfirmed:'0',breakdown:[]}]},owner);
  expect(notCredited.available).toBe(0n);
  // Provider balance can independently become spendable; never attribute a
  // particular increase to the archived deposit.
  const available=parseGatewayMainnetBalance({token:'USDC',totalConfirmedBalance:'0.02',
   breakdown:[{depositor:owner,totalConfirmed:'0.02',
    breakdown:[{chain:'Base',confirmedBalance:'0.02'}]}]},owner);
  expect(available.available).toBe(20000n);
  const spend:GatewayMainnetOperation={
   version:1,id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
   kind:'spend',chainId:8453,destinationChainId:1,owner,recipient,
   amount:'0.01',minimumReceive:'0.009',status:'DESTINATION_UNVERIFIED',
   createdAt:Date.now()+1000,transferId,
  };
  expect(writeGatewayMainnetOperation(spend,storage)).toBe(true);
  const sent=await reconcileGatewayMainnetOperation(owner,deps,storage);
  expect(sent.state).toBe('VERIFIED');
  expect(sent.receipt?.destinationHash).toBe(destination);
  expect(readGatewayMainnetOperation(owner,storage)).toBeNull();
  const third:GatewayMainnetOperation={...deposit,id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
   sourceHash:undefined,status:'UNKNOWN',createdAt:Date.now()+2000};
  expect(writeGatewayMainnetOperation(third,storage)).toBe(true);
  expect(readGatewayMainnetOperation(owner,storage)).toMatchObject({id:third.id,status:'UNKNOWN'});
  const history=readGatewayMainnetHistory(owner,storage);
  if(history==='blocked')throw Error('Invalid');
  expect(history.map(x=>x.status)).toEqual(['VERIFIED','SOURCE_FINALIZED']);
 });
});
