import {describe,it,expect} from 'vitest';
import {parseGatewayForwardedStatus} from '../mainnet/gatewayMainnetReconcile';
import {validGatewayMainnetOperation} from '../mainnet/gatewayMainnetJournal';
import {planGatewayMultiSource} from '../mainnet/gatewayMultiSourceAllocation';
import {parseGatewayMainnetBalance} from '../mainnet/gatewayMainnetBalances';
import type {GatewayMainnetOperation} from '../mainnet/gatewayMainnetJournal';
const owner='0x1111111111111111111111111111111111111111';
const receiver='0x2222222222222222222222222222222222222222';
const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const tx='0x'+'b'.repeat(64);
const padded=(v:string)=>'0x'+'0'.repeat(24)+v.slice(2).toLowerCase();
const wallet='0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE';
const minter='0x2222222d7164433c4C09B0b0D809a9b52C04C205';
const tokenBase='0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const tokenEth='0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const tokenArc='0x3600000000000000000000000000000000000000';
const ledger=parseGatewayMainnetBalance({token:'USDC',totalConfirmedBalance:'0.02',
 breakdown:[{depositor:owner,totalConfirmed:'0.02',breakdown:[
  {chain:'Base',confirmedBalance:'0.01'},
  {chain:'Arc',confirmedBalance:'0.01'},
 ]}]},owner);
const allocations=planGatewayMultiSource(ledger,'0.015');
const op:GatewayMainnetOperation={version:1,id,kind:'spend',chainId:8453,destinationChainId:1,
 owner,recipient:receiver,amount:'0.015',status:'DESTINATION_UNVERIFIED',
 transferId:id,minimumReceive:'0.014',allocations:allocations.map(x=>({chainId:x.chainId,amount:x.amount})),createdAt:Date.now()};
const specs=allocations.map((a,i)=>({
 transferSpecHash:'0x'+String(i+1).repeat(64),sourceDomain:a.chainId===8453?6:26,destinationDomain:0,
 sourceContract:padded(wallet),destinationContract:padded(minter),
 sourceToken:padded(a.chainId===8453?tokenBase:tokenArc),
 destinationToken:padded(tokenEth),sourceDepositor:padded(owner),
 sourceSigner:padded(owner),destinationRecipient:padded(receiver),
 value:String(BigInt(Math.round(Number(a.amount)*1e6))),
}));
const response={transfer:{status:'finalized',destinationDomain:0,transactionHash:tx,
 forwardingDetails:{forwardingEnabled:true},
 burnIntents:specs.map(s=>({transferSpecHash:s.transferSpecHash}))},specs};
describe('Multi-source Gateway original transfer proof is exact and fail-closed',()=>{
 it('binds every source, total, destination and one original forwarding ID',()=>{
  expect(validGatewayMainnetOperation(op,owner)).toBe(true);
  expect(parseGatewayForwardedStatus(response,op)).toMatchObject({transferId:id,amount:'0.015',destinationTxHash:tx});
 });
 it('rejects omission, duplication, switched owner, wrong USDC and changed values',()=>{
  expect(parseGatewayForwardedStatus({...response,specs:response.specs.slice(0,1)},op)).toBeNull();
  expect(parseGatewayForwardedStatus({...response,specs:response.specs.map((x,i)=>i?{...x,transferSpecHash:undefined}:x)},op)).toBeNull();
  expect(parseGatewayForwardedStatus({...response,specs:[response.specs[0],response.specs[0]]},op)).toBeNull();
  expect(parseGatewayForwardedStatus({...response,specs:response.specs.map((x,i)=>i?{...x,sourceSigner:padded(receiver)}:x)},op)).toBeNull();
  expect(parseGatewayForwardedStatus({...response,specs:response.specs.map((x,i)=>i?{...x,sourceToken:padded(tokenEth)}:x)},op)).toBeNull();
  expect(parseGatewayForwardedStatus({...response,specs:response.specs.map((x,i)=>i?{...x,value:'5001'}:x)},op)).toBeNull();
 });
 it('rejects any signed source allocation edit without matching original intent',()=>{
  expect(validGatewayMainnetOperation({...op,allocations:[{chainId:8453,amount:'0.015'}]},owner)).toBe(true);
  expect(parseGatewayForwardedStatus(response,{...op,allocations:[{chainId:8453,amount:'0.015'}]})).toBeNull();
 });
});
