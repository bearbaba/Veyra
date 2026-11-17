import {describe,it,expect,vi} from 'vitest';
import type {EIP1193Provider} from 'viem';
import {observeGatewayWalletSigning} from '../mainnet/gatewayMainnetExecution';
import {archiveGatewayMainnetReceipt,readGatewayMainnetHistory,
 readGatewayMainnetOperation,writeGatewayMainnetOperation,
 type GatewayMainnetOperation} from '../mainnet/gatewayMainnetJournal';
const owner='0x1111111111111111111111111111111111111111';
const request=(method:string)=>({method,params:[]}) as Parameters<EIP1193Provider['request']>[0];
const denied=()=>Object.assign(Error('user rejected'),{code:4001});
const makeStore=()=>{
 const map=new Map<string,string>();
 return {getItem:(key:string)=>map.get(key)??null,
  setItem:(key:string,val:string)=>{map.set(key,val);},
  removeItem:(key:string)=>{map.delete(key);}};
};
const op:GatewayMainnetOperation={version:1,id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 owner,kind:'deposit',recipient:owner,amount:'0.01',chainId:8453,status:'UNKNOWN',createdAt:Date.now(),
 beforeAvailable:'1.2'};
describe('Gateway Mainnet first-signature rejection safety',()=>{
 it('tracks an explicit 4001 rejection before any successful financial request',async()=>{
  const provider={request:vi.fn(()=>Promise.reject(denied()))} as unknown as EIP1193Provider;
  const watched=observeGatewayWalletSigning(provider);
  await expect(watched.provider.request(request('eth_signTypedData_v4'))).rejects.toThrow();
  expect(watched.rejectedBeforeSignature).toBe('eth_signTypedData_v4');
 });
 it('does not unlock after a successful approval/signature even when the second request is rejected',async()=>{
  const mock=vi.fn((arg:{method:string})=>arg.method==='eth_sendTransaction'?
   Promise.resolve('0x'+'a'.repeat(64)):Promise.reject(denied()));
  const watched=observeGatewayWalletSigning({request:mock} as unknown as EIP1193Provider);
  await watched.provider.request(request('eth_sendTransaction'));
  await expect(watched.provider.request(request('eth_signTypedData_v4'))).rejects.toThrow();
  expect(watched.rejectedBeforeSignature).toBeNull();
 });
 it('does not mistake a normal network failure for explicit user refusal',async()=>{
  const watched=observeGatewayWalletSigning({
   request:()=>Promise.reject(Error('network timeout')),
  } as unknown as EIP1193Provider);
  await expect(watched.provider.request(request('eth_signTypedData_v4'))).rejects.toThrow();
  expect(watched.rejectedBeforeSignature).toBeNull();
 });
 it('archives a canceled first request without a fabricated onchain receipt',()=>{
  const store=makeStore();expect(writeGatewayMainnetOperation(op,store)).toBe(true);
  expect(archiveGatewayMainnetReceipt({version:1,operationId:op.id,owner,kind:'deposit',
   status:'CANCELLED_BEFORE_SOURCE',chainId:op.chainId,recipient:op.recipient,
   amount:op.amount,verifiedAt:Date.now(),rejectionMethod:'eth_signTypedData_v4'},store)).toBe(true);
  expect(readGatewayMainnetOperation(owner,store)).toBeNull();
  const history=readGatewayMainnetHistory(owner,store);
  if(history==='blocked')throw Error('History invalid');
  expect(history).toHaveLength(1);
  expect(history[0]?.status).toBe('CANCELLED_BEFORE_SOURCE');
  expect(history[0]?.sourceHash).toBeUndefined();
 });
 it('does not archive a cancellation when an original source hash was already recorded',()=>{
  const store=makeStore();writeGatewayMainnetOperation({...op,sourceHash:'0x'+'a'.repeat(64)},store);
  expect(archiveGatewayMainnetReceipt({version:1,operationId:op.id,owner,kind:'deposit',
   status:'CANCELLED_BEFORE_SOURCE',chainId:op.chainId,recipient:op.recipient,
   amount:op.amount,verifiedAt:Date.now(),rejectionMethod:'eth_sendTransaction'},store)).toBe(false);
  expect(readGatewayMainnetOperation(owner,store)).not.toBeNull();
 });
});
