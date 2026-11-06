/** Deterministic, confirmed-only Circle Gateway source planning.
 * SDK executes one reviewed transfer with explicit allocations; this utility
 * NEVER signs, sends or counts pending USDC as spendable.
 */
import {formatUnits,parseUnits} from 'viem';
import {gatewayMainnetAmount,type GatewayMainnetBalance,
 GATEWAY_MAINNET_CHAINS} from './gatewayMainnetBalances';
export type GatewayAllocation={chainId:number;chain:string;amount:string};
const DECIMALS=6;
export function planGatewayMultiSource(balance:GatewayMainnetBalance,
 requested:string,manualChainId?:number):GatewayAllocation[]{
 if(!gatewayMainnetAmount(requested))throw Error('Enter a positive six-decimal USDC amount.');
 const units=parseUnits(requested,DECIMALS);
 if(units>balance.available)throw Error('Combined confirmed Gateway Available cannot cover this transfer.');
 const eligible=balance.chains.filter(x=>x.available>0n&&
  GATEWAY_MAINNET_CHAINS.some(c=>c.chainId===x.chainId&&c.chain===x.chain));
 const sorted=manualChainId===undefined?
  [...eligible].sort((a,b)=>a.available===b.available?a.chainId-b.chainId:a.available>b.available?-1:1):
  eligible.filter(x=>x.chainId===manualChainId);
 let remaining=units;
 const plan:GatewayAllocation[]=[];
 for(const source of sorted){
  if(remaining===0n)break;
  const use=remaining<source.available?remaining:source.available;
  if(use>0n){plan.push({chainId:source.chainId,chain:source.chain,
   amount:formatUnits(use,DECIMALS)});remaining-=use;}
 }
 if(remaining!==0n||plan.length===0)
  throw Error(manualChainId===undefined?'No confirmed source allocation can cover the payment.':
   'The manually selected source does not have enough confirmed USDC.');
 if(plan.reduce((sum,row)=>sum+parseUnits(row.amount,DECIMALS),0n)!==units)
  throw Error('Source allocation does not add up to reviewed USDC.');
 return plan;
}
export function matchingGatewayAllocation(a:readonly GatewayAllocation[],
 b:readonly GatewayAllocation[]):boolean{
 return a.length===b.length&&a.every((x,i)=>x.chainId===b[i]?.chainId&&
  x.chain===b[i]?.chain&&x.amount===b[i]?.amount);
}
