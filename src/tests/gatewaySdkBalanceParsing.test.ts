import {describe,expect,it} from 'vitest';
import {parseGatewaySdkBalances} from '../core/gateway/gatewayBalances';

const owner='0x1111111111111111111111111111111111111111';
const other='0x2222222222222222222222222222222222222222';
const sample=()=>({
 token:'USDC',totalConfirmedBalance:'5.250001',
 breakdown:[{depositor:owner,totalConfirmed:'5.250001',breakdown:[
  {chain:'Arc_Testnet',confirmedBalance:'1.25'},
  {chain:'Base_Sepolia',confirmedBalance:'4.000001'},
 ]}],
});

describe('Circle Unified SDK confirmed balance trust boundary',()=>{
 it('returns exact deposited USDC per supported Testnet and never wallet ERC20 totals',()=>{
  const result=parseGatewaySdkBalances(sample(),owner);
  expect(result.owner).toBe(owner.toLowerCase());
  expect(result.available).toBe(5250001n);
  expect(result.sources).toEqual([
   {chainId:5042002,domain:26,available:1250000n},
   {chainId:11155111,domain:0,available:0n},
   {chainId:84532,domain:6,available:4000001n},
  ]);
 });
 it('rejects a different depositor and inconsistent claimed totals',()=>{
  expect(()=>parseGatewaySdkBalances({...sample(),breakdown:[
   {...sample().breakdown[0],depositor:other}]},owner)).toThrow();
  expect(()=>parseGatewaySdkBalances({...sample(),totalConfirmedBalance:'9'},owner)).toThrow();
  expect(()=>parseGatewaySdkBalances({...sample(),breakdown:[
   {...sample().breakdown[0],totalConfirmed:'1'}]},owner)).toThrow();
 });
 it('rejects missing evidence, duplicate or unsupported chain rows',()=>{
  const payload=sample();
  expect(()=>parseGatewaySdkBalances({...payload,breakdown:[]},owner)).toThrow();
  expect(()=>parseGatewaySdkBalances({...payload,breakdown:[
   {...payload.breakdown[0],breakdown:[payload.breakdown[0].breakdown[0],
    payload.breakdown[0].breakdown[0]]}]},owner)).toThrow();
  expect(()=>parseGatewaySdkBalances({...payload,breakdown:[
   {...payload.breakdown[0],breakdown:[{chain:'Unknown_Chain',confirmedBalance:'5.250001'}]}]},owner)).toThrow();
  expect(()=>parseGatewaySdkBalances({...payload,breakdown:[
   {...payload.breakdown[0],breakdown:[{chain:'Arc_Testnet',confirmedBalance:'5.2500001'}]}]},owner)).toThrow();
 });
});
