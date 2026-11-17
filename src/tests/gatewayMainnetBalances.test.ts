import {describe,it,expect} from 'vitest';
import {parseGatewayMainnetBalance,GATEWAY_MAINNET_CHAINS} from '../mainnet/gatewayMainnetBalances';
import {readGatewayMainnetOperation,writeGatewayMainnetOperation} from '../mainnet/gatewayMainnetJournal';
const owner='0x1111111111111111111111111111111111111111';
const other='0x2222222222222222222222222222222222222222';
const sample=()=>({token:'USDC',totalConfirmedBalance:'5.250001',totalPendingBalance:'2.50',
 breakdown:[{depositor:owner,totalConfirmed:'5.250001',
  breakdown:[{chain:'Ethereum',confirmedBalance:'1.25'},{chain:'Base',confirmedBalance:'4.000001'}]}]});
describe('Mainnet Circle Gateway exact balances',()=>{
 it('uses actual Circle Mainnet chains, not Arc Testnet contract mapping',()=>{
  expect(GATEWAY_MAINNET_CHAINS.map(c=>[c.chainId,c.domain])).toEqual([[5042,26],[1,0],[8453,6]]);
  const result=parseGatewayMainnetBalance(sample(),owner);
  expect(result.available).toBe(5250001n);
  expect(result.pending).toBe(2500000n);
  expect(result.chains.reduce((sum,c)=>sum+c.available,0n)).toBe(result.available);
 });
 it('does not substitute wallet balances, include pending in spendable, or assume unknown pending=0',()=>{
  const raw=sample();delete (raw as {totalPendingBalance?:string}).totalPendingBalance;
  const result=parseGatewayMainnetBalance(raw,owner);
  expect(result.pending).toBe(null);
  expect(result.available).toBe(5250001n);
 });
 it('fails closed on wrong owner, mismatch, unsupported or duplicate breakdown',()=>{
  expect(()=>parseGatewayMainnetBalance({...sample(),breakdown:[{...sample().breakdown[0],depositor:other}]},owner)).toThrow();
  expect(()=>parseGatewayMainnetBalance({...sample(),totalConfirmedBalance:'7.0'},owner)).toThrow();
  expect(()=>parseGatewayMainnetBalance({...sample(),breakdown:[{...sample().breakdown[0],
   breakdown:[{chain:'UnknownChain',confirmedBalance:'5.250001'}]}]},owner)).toThrow();
 });
});
describe('Owner-local Gateway pending checkpoint',()=>{
 it('persists UNKNOWN and refuses silent overwrite or foreign owner',()=>{
  const map=new Map<string,string>();
  const store={getItem:(key:string)=>map.get(key)??null,setItem:(key:string,v:string)=>{map.set(key,v);},removeItem:(key:string)=>{map.delete(key);}};
  const op={version:1 as const,id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',owner,
   kind:'deposit' as const,chainId:8453,recipient:owner,amount:'0.01',
   createdAt:Date.now(),status:'UNKNOWN' as const};
  expect(writeGatewayMainnetOperation(op,store)).toBe(true);
  expect(readGatewayMainnetOperation(owner,store)).toEqual(op);
  expect(writeGatewayMainnetOperation({...op,amount:'0.02'},store)).toBe(false);
  expect(readGatewayMainnetOperation(other,store)).toBe(null);
 });
});
