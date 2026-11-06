import {afterEach,describe,expect,it,vi} from 'vitest';
import {encodeAbiParameters,encodeEventTopics,encodeFunctionData,parseAbi,type Hex} from 'viem';
import {GATEWAY_MAINNET_WALLET,gatewayDepositAbi,parseGatewayForwardedStatus,
 parseGatewayDepositCreditProof,verifyGatewayCanonicalFinality,reconcileGatewayMainnetOperation,
 type GatewayChainReceipt,type GatewayChainTx,type GatewayReconciliationDeps} from '../mainnet/gatewayMainnetReconcile';
import {readGatewayMainnetHistory,readGatewayMainnetOperation,writeGatewayMainnetOperation,
 type GatewayMainnetOperation} from '../mainnet/gatewayMainnetJournal';
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
const blockNumber=900n,latest=1050n;
const canonical={number:blockNumber,hash:blockHash,timestamp:BigInt(Math.floor(Date.now()/1000))-3600n};
const sourceReceipt:GatewayChainReceipt={status:'success',transactionHash:sourceHash,blockHash,blockNumber,
 logs:[log(token,owner,GATEWAY_MAINNET_WALLET,10000n)]};
const makeStore=()=>{
 const map=new Map<string,string>();
 return {getItem:(key:string)=>map.get(key)??null,setItem:(key:string,val:string)=>{map.set(key,val);},
  removeItem:(key:string)=>{map.delete(key);}};
};
const deposit:GatewayMainnetOperation={
 version:1,id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',kind:'deposit',owner,recipient:owner,
 amount:'0.01',status:'SUBMITTED',chainId:8453,createdAt:Date.now(),sourceHash,beforeAvailable:'1.50',
};
const credit={status:'credited',creditId:'gateway-credit-123',sourceTxHash:sourceHash,
 sourceBlockHash:blockHash,chainId:8453,owner,token,amount:'0.01'};
const deps:GatewayReconciliationDeps={
 getTransaction:()=>Promise.resolve(tx),
 getTransactionReceipt:()=>Promise.resolve(sourceReceipt),
 getCanonicalBlock:()=>Promise.resolve(canonical),
 getFinalizedBlock:()=>Promise.resolve({...canonical,number:1000n}),
 getLatestBlockNumber:()=>Promise.resolve(latest),
};
afterEach(()=>vi.unstubAllGlobals());
describe('Circle Gateway per-source finality and individual credit',()=>{
 it('never verifies a deposit merely because total Gateway balance increased',async()=>{
  const store=makeStore();expect(writeGatewayMainnetOperation(deposit,store)).toBe(true);
  const result=await reconcileGatewayMainnetOperation(owner,deps,store);
  expect(result.state).toBe('PENDING');
  expect(result.reason).toContain('Deposit confirmed · credit pending');
  expect(readGatewayMainnetOperation(owner,store)).toMatchObject({status:'SOURCE_CONFIRMED'});
  expect(readGatewayMainnetHistory(owner,store)).toEqual([]);
 });
 it('rejects an unrelated provider credit even if an exact deposit finalized',async()=>{
  const store=makeStore();writeGatewayMainnetOperation(deposit,store);
  const result=await reconcileGatewayMainnetOperation(owner,{
   ...deps,getDepositCreditProof:()=>Promise.resolve({...credit,sourceTxHash:'0x'+'f'.repeat(64)})},store);
  expect(result.state).toBe('PENDING');
  expect(readGatewayMainnetOperation(owner,store)).not.toBeNull();
  expect(parseGatewayDepositCreditProof({...credit,owner:recipient},deposit,sourceReceipt)).toBeNull();
 });
 it('archives only an exact individually attributed provider credit and finalized deposit',async()=>{
  const store=makeStore();writeGatewayMainnetOperation(deposit,store);
  const result=await reconcileGatewayMainnetOperation(owner,{
   ...deps,getDepositCreditProof:()=>Promise.resolve(credit)},store);
  expect(result.state).toBe('VERIFIED');
  expect(readGatewayMainnetOperation(owner,store)).toBeNull();
  const history=readGatewayMainnetHistory(owner,store);
  if(history==='blocked')throw Error('Invalid history');
  expect(history).toHaveLength(1);
  expect(history[0]?.gatewayCreditReference).toBe('gateway-credit-123');
 });
 it('wrong calldata/sender is not a deposit even with a provider credit',async()=>{
  const store=makeStore();writeGatewayMainnetOperation(deposit,store);
  const result=await reconcileGatewayMainnetOperation(owner,{
   ...deps,getTransaction:()=>Promise.resolve({...tx,from:recipient}),
   getDepositCreditProof:()=>Promise.resolve(credit)},store);
  expect(result.state).toBe('PENDING');
  expect(readGatewayMainnetOperation(owner,store)).not.toBeNull();
 });
 it('reverted source is archived ONLY after finality and canonical block check',async()=>{
  const store=makeStore();writeGatewayMainnetOperation(deposit,store);
  const reverted={...sourceReceipt,status:'reverted' as const,logs:[]};
  const pending=await reconcileGatewayMainnetOperation(owner,{
   ...deps,getTransactionReceipt:()=>Promise.resolve(reverted),
   getFinalizedBlock:()=>Promise.resolve({...canonical,number:899n})},store);
  expect(pending.state).toBe('PENDING');
  expect(readGatewayMainnetOperation(owner,store)).not.toBeNull();
  const done=await reconcileGatewayMainnetOperation(owner,{
   ...deps,getTransactionReceipt:()=>Promise.resolve(reverted)},store);
  expect(done.state).toBe('REVERTED');
  expect(readGatewayMainnetOperation(owner,store)).toBeNull();
 });
 it('rejects a reorged block with same transaction hash but different canonical hash',async()=>{
  const store=makeStore();writeGatewayMainnetOperation(deposit,store);
  const result=await reconcileGatewayMainnetOperation(owner,{
   ...deps,getCanonicalBlock:()=>Promise.resolve({...canonical,hash:'0x'+'d'.repeat(64)}),
   getDepositCreditProof:()=>Promise.resolve(credit)},store);
  expect(result.state).toBe('PENDING');
  expect(readGatewayMainnetOperation(owner,store)).not.toBeNull();
 });
 it('rejects underconfirmed ETH even when finalized tag is inconsistent',async()=>{
  const receipt={...sourceReceipt,blockNumber:1000n};
  const check=await verifyGatewayCanonicalFinality(1,receipt,{
   ...deps,getCanonicalBlock:()=>Promise.resolve({...canonical,number:1000n}),
   getFinalizedBlock:()=>Promise.resolve({...canonical,number:1000n}),
   getLatestBlockNumber:()=>Promise.resolve(1005n),
  });
  expect(check).toBe(false);
 });
 it('does not equate 65 Base L2 blocks with L1 finality',async()=>{
  const check=await verifyGatewayCanonicalFinality(8453,sourceReceipt,{
   ...deps,getFinalizedBlock:()=>Promise.resolve({...canonical,number:800n}),
   getLatestBlockNumber:()=>Promise.resolve(9999n),
  });
  expect(check).toBe(false);
 });
 it('fails closed on Arc until its Mainnet finality acceptance policy is reviewed',async()=>{
  const check=await verifyGatewayCanonicalFinality(5042,sourceReceipt,deps);
  expect(check).toBe(false);
 });
});
describe('Gateway forwarded spend finality and source identity',()=>{
 const spending:GatewayMainnetOperation={
  version:1,id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',owner,kind:'spend',recipient,
  amount:'0.01',chainId:8453,destinationChainId:1,createdAt:Date.now(),
  status:'DESTINATION_UNVERIFIED',transferId:'confirmed-reference',minimumReceive:'0.009',
 };
 const padded=(address:string)=>'0x'+'0'.repeat(24)+address.slice(2).toLowerCase();
 const transferSpecHash='0x'+'f'.repeat(64);
 const forwarded={
  transfer:{destinationDomain:0,status:'finalized',transactionHash:destinationHash,
   forwardingDetails:{forwardingEnabled:true},
   burnIntents:[{transferSpecHash}]},
  spec:{sourceDomain:6,destinationDomain:0,
   sourceContract:padded(GATEWAY_MAINNET_WALLET),
   destinationContract:padded('0x2222222d7164433c4C09B0b0D809a9b52C04C205'),
   sourceToken:padded(token),
   destinationToken:padded('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'),
   sourceDepositor:padded(owner),sourceSigner:padded(owner),
   destinationRecipient:padded(recipient),value:'10000'},
 };
 const destinationReceipt:GatewayChainReceipt={
  status:'success',transactionHash:destinationHash,blockHash,blockNumber,
  logs:[log('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
   '0x0000000000000000000000000000000000000000',recipient,9000n)]};
 it('requires externally supplied verified forwarding schema plus canonical destination receipt',async()=>{
  const store=makeStore();writeGatewayMainnetOperation(spending,store);
  const without=await reconcileGatewayMainnetOperation(owner,deps,store);
  expect(without.state).toBe('PENDING');
  const done=await reconcileGatewayMainnetOperation(owner,{
   ...deps,getForwardingStatus:()=>Promise.resolve(forwarded),
   getTransactionReceipt:()=>Promise.resolve(destinationReceipt)},store);
  expect(done.state).toBe('VERIFIED');
  expect(readGatewayMainnetOperation(owner,store)).toBeNull();
 });
 it('refuses a reorged destination block or unrelated USDC receiver',async()=>{
  const store=makeStore();writeGatewayMainnetOperation(spending,store);
  const reorg=await reconcileGatewayMainnetOperation(owner,{
   ...deps,getForwardingStatus:()=>Promise.resolve(forwarded),
   getTransactionReceipt:()=>Promise.resolve(destinationReceipt),
   getCanonicalBlock:()=>Promise.resolve({...canonical,hash:'0x'+'d'.repeat(64)})},store);
  expect(reorg.state).toBe('PENDING');
  const wrong=await reconcileGatewayMainnetOperation(owner,{
   ...deps,getForwardingStatus:()=>Promise.resolve(forwarded),
   getTransactionReceipt:()=>Promise.resolve({...destinationReceipt,logs:[
    log('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',owner,owner,9000n)]})},store);
  expect(wrong.state).toBe('PENDING');
  expect(parseGatewayForwardedStatus({...forwarded,spec:{...forwarded.spec,destinationRecipient:padded(owner)}},spending)).toBeNull();
  expect(readGatewayMainnetOperation(owner,store)).not.toBeNull();
 });
 it('rejects wrong chain domain, USDC token, signer, missing spec and nonfinalized Circle transfer',()=>{
  expect(parseGatewayForwardedStatus({...forwarded,transfer:{...forwarded.transfer,status:'confirmed'}},spending)).toBeNull();
  expect(parseGatewayForwardedStatus({...forwarded,spec:{...forwarded.spec,sourceDomain:26}},spending)).toBeNull();
  expect(parseGatewayForwardedStatus({...forwarded,spec:{...forwarded.spec,sourceToken:padded(owner)}},spending)).toBeNull();
  expect(parseGatewayForwardedStatus({...forwarded,spec:{...forwarded.spec,sourceSigner:padded(recipient)}},spending)).toBeNull();
  expect(parseGatewayForwardedStatus({...forwarded,spec:null},spending)).toBeNull();
 });

});
