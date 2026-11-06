import {afterEach,describe,expect,it,vi} from 'vitest';
import {encodeAbiParameters,encodeEventTopics,encodeFunctionData,parseAbi,type Hex} from 'viem';
import {GATEWAY_MAINNET_WALLET,gatewayDepositAbi,parseGatewayForwardedStatus,
 reconcileGatewayMainnetOperation,type GatewayChainReceipt,type GatewayChainTx,
 type GatewayReconciliationDeps} from '../mainnet/gatewayMainnetReconcile';
import {readGatewayMainnetHistory,readGatewayMainnetOperation,writeGatewayMainnetOperation,
 type GatewayMainnetOperation} from '../mainnet/gatewayMainnetJournal';
import {parseGatewayMainnetBalance} from '../mainnet/gatewayMainnetBalances';
const owner='0x1111111111111111111111111111111111111111';
const recipient='0x2222222222222222222222222222222222222222';
const sourceHash='0x'+'a'.repeat(64),destinationHash='0x'+'b'.repeat(64),blockHash='0x'+'c'.repeat(64);
const token='0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const tx:GatewayChainTx={from:owner,to:GATEWAY_MAINNET_WALLET,hash:sourceHash,
 input:encodeFunctionData({abi:gatewayDepositAbi,functionName:'deposit',args:[token,10000n]})};
const transfer=parseAbi(['event Transfer(address indexed from,address indexed to,uint256 value)']);
const log=(tokenAddress:string,from:string,to:string,value:bigint)=>({
 address:tokenAddress,
 topics:encodeEventTopics({abi:transfer,eventName:'Transfer',args:{from:from as Hex,to:to as Hex}})
  .flatMap(topic=>typeof topic==='string'?[topic]:[]),
 data:encodeAbiParameters([{type:'uint256'}],[value]),
});
const sourceReceipt:GatewayChainReceipt={status:'success',transactionHash:sourceHash,blockHash,
 logs:[log(token,owner,GATEWAY_MAINNET_WALLET,10000n)]};
const makeStore=()=>{
 const map=new Map<string,string>();
 return {getItem:(key:string)=>map.get(key)??null,
  setItem:(key:string,val:string)=>{map.set(key,val);},removeItem:(key:string)=>{map.delete(key);}};
};
const deposit:GatewayMainnetOperation={
 version:1,id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',kind:'deposit',
 owner,recipient:owner,amount:'0.01',status:'SUBMITTED',chainId:8453,
 createdAt:Date.now(),sourceHash,beforeAvailable:'1.50',
};
const balances=(base:string)=>parseGatewayMainnetBalance({
 token:'USDC',totalConfirmedBalance:base,breakdown:[{depositor:owner,totalConfirmed:base,
  breakdown:[{chain:'Base',confirmedBalance:base}]}],
},owner);
const deps:GatewayReconciliationDeps={
 getTransaction:()=>Promise.resolve(tx),getTransactionReceipt:()=>Promise.resolve(sourceReceipt),
 getConfirmedBalances:()=>Promise.resolve(balances('1.51')),
 getForwardingStatus:()=>Promise.resolve(null),
};
afterEach(()=>vi.unstubAllGlobals());
describe('Mainnet Gateway deposit reconciliation is receipt-bound and fail closed',()=>{
 it('archives exact source deposit and confirmed Circle credit; releases active without deleting history',async()=>{
  const store=makeStore();expect(writeGatewayMainnetOperation(deposit,store)).toBe(true);
  const result=await reconcileGatewayMainnetOperation(owner,deps,store);
  expect(result.state).toBe('VERIFIED');
  expect(readGatewayMainnetOperation(owner,store)).toBeNull();
  const history=readGatewayMainnetHistory(owner,store);
  expect(history).not.toBe('blocked');
  if(history==='blocked')return;
  expect(history).toHaveLength(1);
  expect(history[0]?.sourceHash).toBe(sourceHash);
  expect(history[0]?.gatewayConfirmedAfter).toBe('1.51');
  expect(readGatewayMainnetHistory(recipient,store)).toEqual([]);
 });
 it('source confirmed is NOT finality before exact Gateway credit',async()=>{
  const store=makeStore();writeGatewayMainnetOperation(deposit,store);
  const out=await reconcileGatewayMainnetOperation(owner,{
   ...deps,getConfirmedBalances:()=>Promise.resolve(balances('1.50'))},store);
  expect(out.state).toBe('PENDING');
  expect(readGatewayMainnetOperation(owner,store)).not.toBeNull();
  expect(readGatewayMainnetHistory(owner,store)).toEqual([]);
 });
 it('rejects unrelated deposit calldata or sender, even when Circle balance rises',async()=>{
  const store=makeStore();writeGatewayMainnetOperation(deposit,store);
  const out=await reconcileGatewayMainnetOperation(owner,{
   ...deps,getTransaction:()=>Promise.resolve({...tx,from:recipient})},store);
  expect(out.state).toBe('PENDING');
  expect(readGatewayMainnetOperation(owner,store)).not.toBeNull();
 });
 it('reverted original deposit may be archived only with matched source transaction',async()=>{
  const store=makeStore();writeGatewayMainnetOperation(deposit,store);
  const out=await reconcileGatewayMainnetOperation(owner,{
   ...deps,getTransactionReceipt:()=>Promise.resolve({...sourceReceipt,status:'reverted' as const,logs:[]})},store);
  expect(out.state).toBe('REVERTED');
  expect(readGatewayMainnetOperation(owner,store)).toBeNull();
  expect(readGatewayMainnetHistory(owner,store)).not.toBe('blocked');
 });
 it('pre-existing submission without a pre-credit snapshot remains locked',async()=>{
  const store=makeStore();writeGatewayMainnetOperation({...deposit,beforeAvailable:undefined},store);
  const out=await reconcileGatewayMainnetOperation(owner,deps,store);
  expect(out.state).toBe('PENDING');
  expect(readGatewayMainnetOperation(owner,store)).not.toBeNull();
 });
 it('wrong source hash or unavailable wallet remains blocked without any signature attempt',async()=>{
  const store=makeStore();writeGatewayMainnetOperation({...deposit,sourceHash:undefined,status:'UNKNOWN'},store);
  const read=vi.fn();const out=await reconcileGatewayMainnetOperation(owner,{
   ...deps,getTransaction:read},store);
  expect(out.state).toBe('PENDING');
  expect(read).not.toHaveBeenCalled();
  expect(readGatewayMainnetOperation(owner,store)).not.toBeNull();
 });
});
describe('Gateway forwarded spend verification',()=>{
 const spending:GatewayMainnetOperation={
  version:1,id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',owner,kind:'spend',recipient,
  amount:'0.01',chainId:8453,destinationChainId:1,createdAt:Date.now(),
  status:'DESTINATION_UNVERIFIED',transferId:'confirmed-reference',minimumReceive:'0.009',
 };
 const forwarded={transferId:'confirmed-reference',status:'confirmed',sourceDomain:6,
  destinationDomain:0,sourceDepositor:owner,destinationRecipient:recipient,
  amount:'0.01',destinationTxHash:destinationHash};
 const destinationReceipt:GatewayChainReceipt={
  status:'success',transactionHash:destinationHash,blockHash,
  logs:[log('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
   '0x0000000000000000000000000000000000000000',recipient,9000n)]};
 it('archives only Circle confirmed matching reference and destination recipient Transfer',async()=>{
  const store=makeStore();writeGatewayMainnetOperation(spending,store);
  const result=await reconcileGatewayMainnetOperation(owner,{
   ...deps,getForwardingStatus:()=>Promise.resolve(forwarded),
   getTransactionReceipt:()=>Promise.resolve(destinationReceipt)},store);
  expect(result.state).toBe('VERIFIED');
  expect(readGatewayMainnetOperation(owner,store)).toBeNull();
  const receipts=readGatewayMainnetHistory(owner,store);
  if(receipts==='blocked')throw Error('History invalid');
  expect(receipts[0]?.destinationHash).toBe(destinationHash);
  expect(receipts[0]?.received).toBe('0.009');
 });
 it('rejects mismatched owner, recipient, transfer ID and fake receipts',async()=>{
  const store=makeStore();writeGatewayMainnetOperation(spending,store);
  expect(parseGatewayForwardedStatus({...forwarded,destinationRecipient:owner},spending)).toBeNull();
  expect(parseGatewayForwardedStatus({...forwarded,transferId:'someone-else'},spending)).toBeNull();
  const result=await reconcileGatewayMainnetOperation(owner,{
   ...deps,getForwardingStatus:()=>Promise.resolve(forwarded),
   getTransactionReceipt:()=>Promise.resolve({...destinationReceipt,logs:[
    log('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',owner,owner,9000n)]})},store);
  expect(result.state).toBe('PENDING');
  expect(readGatewayMainnetOperation(owner,store)).not.toBeNull();
 });
});
