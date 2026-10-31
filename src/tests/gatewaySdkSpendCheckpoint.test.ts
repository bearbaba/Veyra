import {describe,expect,it} from 'vitest';
import {keccak256,pad,stringToHex,zeroAddress} from 'viem';
import {verifyGatewayDestinationMint} from '../core/gateway/gatewayDestinationMint';
import type {EIP1193Provider} from 'viem';
import {gatewaySpendKey,prepareGatewaySpendCheckpoint,readGatewaySpendCheckpoint,assertGatewayProviderWallet,parseGatewaySdkFees,assertGatewaySdkFeesUnchanged}
 from '../core/gateway/gatewaySdkSpend';

const owner='0x1111111111111111111111111111111111111111';
const recipient='0x2222222222222222222222222222222222222222';
const identity='usr_owner_bound_test_only';
const input={owner,recipient,identity,amount:'1.25',sourceChainId:5042002,
 destinationChainId:84532};
const memory=new Map<string,string>();
const store={
 getItem(key:string){return memory.get(key)??null;},
 setItem(key:string,value:string){memory.set(key,value);},
};
describe('Gateway user-scoped pending send checkpoint',()=>{
 it('persists unresolved outcome and cannot cross wallet/identity boundaries',()=>{
  memory.clear();
  const pending=prepareGatewaySpendCheckpoint(input,12345);
  expect(pending.state).toBe('SUBMISSION_UNKNOWN');
  const key=gatewaySpendKey(owner,identity);
  store.setItem(key,JSON.stringify(pending));
  expect(readGatewaySpendCheckpoint(store,owner,identity)).toEqual(pending);
  expect(readGatewaySpendCheckpoint(store,owner,'usr_other')).toBeNull();
  expect(readGatewaySpendCheckpoint(store,recipient,identity)).toBeNull();
 });
 it('rejects invalid owner, amount, unsupported network and corrupted state',()=>{
  expect(()=>prepareGatewaySpendCheckpoint({...input,amount:'1.0000001'})).toThrow();
  expect(()=>prepareGatewaySpendCheckpoint({...input,amount:'0'})).toThrow();
  expect(()=>prepareGatewaySpendCheckpoint({...input,sourceChainId:1})).toThrow();
  expect(()=>prepareGatewaySpendCheckpoint({...input,recipient:'invalid'})).toThrow();
  const key=gatewaySpendKey(owner,identity);
  store.setItem(key,JSON.stringify({...prepareGatewaySpendCheckpoint(input),
    state:'VERIFIED'}));
  expect(readGatewaySpendCheckpoint(store,owner,identity)).toBeNull();
  store.setItem(key,'not json');
  expect(readGatewaySpendCheckpoint(store,owner,identity)).toBeNull();
 });
});

describe('Circle SDK spend preflight and exact fee consent',()=>{
 const provider=(accounts:unknown,chain:unknown)=>({
  request:({method}:{method:string})=>Promise.resolve(
   method==='eth_accounts'?accounts:method==='eth_chainId'?chain:null),
 }) as EIP1193Provider;
 it('accepts only the exact wallet on the reviewed source chain',async()=>{
  await expect(assertGatewayProviderWallet(
   provider([owner],'0x4cef12'),owner,5042002)).rejects.toThrow();
  // 5042002 (Arc Testnet) is 0x4cef52.
  await expect(assertGatewayProviderWallet(
   provider([owner],'0x4cef52'),owner,5042002)).resolves.toBeUndefined();
  await expect(assertGatewayProviderWallet(
   provider([recipient],'0x4cef52'),owner,5042002)).rejects.toThrow();
  await expect(assertGatewayProviderWallet(
   provider([owner],'0xaa36a7'),owner,5042002)).rejects.toThrow();
  await expect(assertGatewayProviderWallet(
   provider([],'0x4cef52'),owner,5042002)).rejects.toThrow();
 });
 it('accepts only known, exact USDC provider fees and SDK forwarding fees',()=>{
  expect(parseGatewaySdkFees([{type:'forwarder',token:'USDC',amount:'.1'},
   {type:'provider',token:'USDC',amount:'0.000050'},
   {type:'gasFee',token:'USDC',amount:'0.02'}])).toHaveLength(3);
  for(const invalid of [
   [],[{type:'forwarder',token:'USDC',amount:0.1}],
   [{type:'forwarder',token:'USDC',amount:'1e5'}],
   [{type:'forwarder',token:'USDC',amount:'1.0000001'}],
   [{type:'forwarder',token:'EURC',amount:'0.01'}],
   [{type:'nonsense',token:'USDC',amount:'0.01'}],
  ])expect(()=>parseGatewaySdkFees(invalid)).toThrow();
 });
});

describe('Gate signing on the exact Circle fees reviewed by the owner',()=>{
 const quoted=[{type:'provider',token:'USDC' as const,amount:'0.001000'},
  {type:'forwarder',token:'USDC' as const,amount:'0.2'}];
 it('allows same verified quote even when Circle formats 0.20 as 0.2',()=>{
  expect(()=>assertGatewaySdkFeesUnchanged(quoted,[
   {type:'forwarder',token:'USDC',amount:'0.200000'},
   {type:'provider',token:'USDC',amount:'0.001'},
  ])).not.toThrow();
 });
 it('requires a new explicit review on changed or missing fees',()=>{
  expect(()=>assertGatewaySdkFeesUnchanged(quoted,[
   {...quoted[0],amount:'0.001001'},quoted[1],
  ])).toThrow('Circle forwarding fees changed');
  expect(()=>assertGatewaySdkFeesUnchanged(quoted,[])).toThrow();
  expect(()=>assertGatewaySdkFeesUnchanged([],quoted)).toThrow();
 });
});

describe('Circle destination mint is independently verified from chain receipts',()=>{
 const tx='0x'+'ab'.repeat(32);
 const token='0x3333333333333333333333333333333333333333';
 const transfer=keccak256(stringToHex('Transfer(address,address,uint256)'));
 const mint=(to:string,from:string,value:bigint,emitter=token)=>({
  address:emitter,topics:[transfer,pad(from as `0x${string}`,{size:32}),
   pad(to as `0x${string}`,{size:32})],
  data:'0x'+value.toString(16).padStart(64,'0'),
 });
 const input={expectedHash:tx,token,recipient,amount:'2',minReceive:'1.9',chainId:84532};
 it('requires successful destination chain USDC mint to the exact reviewed recipient',()=>{
  const proof=verifyGatewayDestinationMint({
   status:'success',transactionHash:tx,logs:[mint(recipient,zeroAddress,1950000n)],
  },input);
  expect(proof).toEqual({chainId:84532,txHash:tx,mintedUsdc:'1.95'});
 });
 it('rejects a source receipt, unrelated transfer, wrong token or recipient, and fee shortfall',()=>{
  const valid={status:'success',transactionHash:tx,
   logs:[mint(recipient,zeroAddress,1950000n)]};
  expect(()=>verifyGatewayDestinationMint({...valid,status:'reverted'},input)).toThrow();
  expect(()=>verifyGatewayDestinationMint({...valid,transactionHash:'0x'+'cd'.repeat(32)},input)).toThrow();
  expect(()=>verifyGatewayDestinationMint({...valid,logs:[mint(recipient,owner,1950000n)]},input)).toThrow();
  expect(()=>verifyGatewayDestinationMint({...valid,logs:[mint(owner,zeroAddress,1950000n)]},input)).toThrow();
  expect(()=>verifyGatewayDestinationMint({...valid,logs:[mint(recipient,zeroAddress,1950000n,owner)]},input)).toThrow();
  expect(()=>verifyGatewayDestinationMint({...valid,logs:[mint(recipient,zeroAddress,1000000n)]},input)).toThrow();
  expect(()=>verifyGatewayDestinationMint({...valid,logs:[mint(recipient,zeroAddress,2100000n)]},input)).toThrow();
 });
});
