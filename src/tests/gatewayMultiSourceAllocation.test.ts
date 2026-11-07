import {formatUnits,parseUnits} from 'viem';
import {describe,expect,it} from 'vitest';
import {parseGatewayMainnetBalance} from '../mainnet/gatewayMainnetBalances';
import {matchingGatewayAllocation,planGatewayMultiSource} from '../mainnet/gatewayMultiSourceAllocation';
const owner='0x1111111111111111111111111111111111111111';
const gateway=(base:string,arc:string,ethereum:string,pending='6')=>{
 const total=formatUnits(parseUnits(base,6)+parseUnits(arc,6)+parseUnits(ethereum,6),6);
 return parseGatewayMainnetBalance({
  token:'USDC',totalConfirmedBalance:total,
  totalPendingBalance:pending,
  breakdown:[{depositor:owner,totalConfirmed:total,
   breakdown:[
    {chain:'Base',confirmedBalance:base},
    {chain:'Arc',confirmedBalance:arc},
    {chain:'Ethereum',confirmedBalance:ethereum},
   ]}],
 },owner);
};
describe('Gateway confirmed-only USDC source allocation',()=>{
 it('greedily splits a single reviewed amount across all confirmed sources',()=>{
  const result=planGatewayMultiSource(gateway('0.4','0.3','0.1','100'),'0.65');
  expect(result).toEqual([{chainId:8453,chain:'Base',amount:'0.4'},
   {chainId:5042,chain:'Arc',amount:'0.25'}]);
 });
 it('never includes pending USDC when Available cannot cover',()=>{
  expect(()=>planGatewayMultiSource(gateway('0.2','0','0','100'),'0.3')).toThrow('Combined confirmed');
 });
 it('uses a single chain when enough and prevents silent fallback in manual mode',()=>{
  expect(planGatewayMultiSource(gateway('0.4','0.3','0.1'),'0.25'))
   .toEqual([{chainId:8453,chain:'Base',amount:'0.25'}]);
  expect(()=>planGatewayMultiSource(gateway('0.4','0.3','0.1'),'0.35',5042))
   .toThrow('manually selected');
 });
 it('rejects malformed amount and preserves exact micro-USDC arithmetic',()=>{
  const ledger=gateway('0.000001','0.000002','0.000003');
  expect(planGatewayMultiSource(ledger,'0.000006').map(x=>x.amount))
   .toEqual(['0.000003','0.000002','0.000001']);
  expect(()=>planGatewayMultiSource(ledger,'0.0000001')).toThrow();
  expect(matchingGatewayAllocation(
   planGatewayMultiSource(ledger,'0.000006'),
   planGatewayMultiSource(ledger,'0.000006'))).toBe(true);
  expect(matchingGatewayAllocation(
   planGatewayMultiSource(ledger,'0.000006'),
   planGatewayMultiSource(ledger,'0.000005'))).toBe(false);
 });
});
