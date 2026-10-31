import {describe,expect,it} from 'vitest';
import {keccak256,pad,stringToHex,zeroAddress} from 'viem';
import {GATEWAY_TESTNET_SOURCES} from '../core/gateway/gatewayBalances';
import {
 bridgeChain,bridgeKey,makeBridgeAttempt,readBridgeAttempt,
 getAppKitBridgeSteps,verifyCompletedAppKitBridge,
} from '../core/bridge/arcAppKitBridge';

const owner='0x1111111111111111111111111111111111111111';
const other='0x2222222222222222222222222222222222222222';
const id='usr_TEST_CCTP_ONLY';
const burnHash='0x'+'ab'.repeat(32),mintHash='0x'+'cd'.repeat(32);
const intent=()=>makeBridgeAttempt({owner,identity:id,sourceChainId:84532,
 destinationChainId:5042002,recipient:other,amount:'2',minReceive:'1.8'},1234567);
const transfer=keccak256(stringToHex('Transfer(address,address,uint256)'));
const token=GATEWAY_TESTNET_SOURCES[0].token;
const mint=(to:string,value:bigint)=>({address:token,
 topics:[transfer,pad(zeroAddress,{size:32}),pad(to as `0x${string}`,{size:32})],
 data:'0x'+value.toString(16).padStart(64,'0'),
});
describe('Bidirectional App Kit CCTP Testnet acceptance gate',()=>{
 it('supports both directions between verified Arc, Sepolia and Base chains',()=>{
  expect(bridgeChain(5042002)).toBe('Arc_Testnet');
  expect(bridgeChain(11155111)).toBe('Ethereum_Sepolia');
  expect(bridgeChain(84532)).toBe('Base_Sepolia');
  expect(()=>bridgeChain(1)).toThrow();
  expect(makeBridgeAttempt({...intent(),sourceChainId:84532,destinationChainId:5042002})
   .destinationChainId).toBe(5042002);
  expect(makeBridgeAttempt({...intent(),sourceChainId:5042002,destinationChainId:84532})
   .sourceChainId).toBe(5042002);
  expect(()=>makeBridgeAttempt({...intent(),sourceChainId:5042002,destinationChainId:5042002})).toThrow();
  expect(()=>makeBridgeAttempt({...intent(),minReceive:'2.1'})).toThrow();
 });
 it('binds checkpoint to exact wallet, identity, recipient and supported routes',()=>{
  const memory=new Map<string,string>();
  const store={getItem:(key:string)=>memory.get(key)??null};
  const pending=intent();
  memory.set(bridgeKey(owner,id),JSON.stringify(pending));
  expect(readBridgeAttempt(store,owner,id)).toEqual(pending);
  expect(readBridgeAttempt(store,other,id)).toBeNull();
  expect(readBridgeAttempt(store,owner,'usr_OTHER')).toBeNull();
  memory.set(bridgeKey(owner,id),JSON.stringify({...pending,state:'VERIFIED'}));
  expect(readBridgeAttempt(store,owner,id)).toBeNull();
 });
 it('requires successful Circle source burn and destination mint step hashes',()=>{
  const result={state:'success',steps:[
   {name:'approve',state:'success',txHash:burnHash},
   {name:'burn',state:'success',txHash:burnHash},
   {name:'mint',state:'success',txHash:mintHash},
  ]};
  const step=getAppKitBridgeSteps(result);
  expect(step).toEqual({providerState:'success',burnHash,mintHash});
  expect(getAppKitBridgeSteps({state:'pending',steps:[]})).toEqual({providerState:'pending'});
  const checkpoint={...intent(),state:'SUBMITTED_UNVERIFIED' as const,...step};
  const receipt={status:'success',transactionHash:mintHash,logs:[mint(other,1900000n)]};
  expect(verifyCompletedAppKitBridge(receipt,checkpoint)).toEqual({
   burnHash,proof:{chainId:5042002,txHash:mintHash,mintedUsdc:'1.9'},
  });
  expect(()=>verifyCompletedAppKitBridge({...receipt,status:'reverted'},checkpoint)).toThrow();
  expect(()=>verifyCompletedAppKitBridge({...receipt,logs:[mint(owner,1900000n)]},checkpoint)).toThrow();
  expect(()=>verifyCompletedAppKitBridge({...receipt,logs:[mint(other,1000000n)]},checkpoint)).toThrow();
  expect(()=>verifyCompletedAppKitBridge(receipt,{...checkpoint,providerState:'pending'})).toThrow();
  expect(()=>verifyCompletedAppKitBridge(receipt,{...checkpoint,burnHash:undefined})).toThrow();
 });
});
