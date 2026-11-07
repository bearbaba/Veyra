/** Exact six-decimal Unified → Arc wallet funding bounds. Circle spend is
 * GROSS, and the destination receives gross minus the provider fee quote.
 * Gateway funding never marks a Settlement payment as paid.
 */
import {formatUnits,parseUnits} from 'viem';
import {gatewayMainnetAmount} from './gatewayMainnetBalances';
import type {GatewaySdkFee} from '../core/gateway/gatewaySdkSpend';
const six=(s:string)=>parseUnits(s.startsWith('.')?'0'+s:s,6);
export function settlementFundingShortfall(gross:string,walletUsdc:bigint|null):string|null{
 if(!gatewayMainnetAmount(gross)||walletUsdc===null||walletUsdc<0n)return null;
 const required=parseUnits(gross,6);
 return formatUnits(required>walletUsdc?required-walletUsdc:0n,6);
}
export function gatewayFeeUnits(fees:ReadonlyArray<GatewaySdkFee>):bigint{
 if(!fees.length)throw Error('Gateway fee quote unavailable.');
 return fees.reduce((acc,f)=>{
  if(f.token!=='USDC'||!/^(?:[0-9]+(?:\.[0-9]{1,6})?|\.[0-9]{1,6})$/.test(f.amount))
   throw Error('Unverified Gateway fee amount or token.');
  return acc+six(f.amount);
 },0n);
}
export function gatewayFundingGrossForNet(minimumNet:string,
 fees:ReadonlyArray<GatewaySdkFee>,confirmedAvailable:bigint):string{
 if(!gatewayMainnetAmount(minimumNet))throw Error('A valid Arc wallet funding shortfall is required.');
 const gross=six(minimumNet)+gatewayFeeUnits(fees);
 if(gross<=0n||gross>confirmedAvailable)
  throw Error('Gateway Available cannot cover Settlement funding after fees. No signature requested.');
 return formatUnits(gross,6);
}
export function assertGatewayFundingNet(gross:string,
 fees:ReadonlyArray<GatewaySdkFee>,minimumNet:string):void{
 if(!gatewayMainnetAmount(gross)||!gatewayMainnetAmount(minimumNet)||
  six(gross)-gatewayFeeUnits(fees)<six(minimumNet))
  throw Error('Net Gateway transfer cannot cover the Arc wallet shortfall. Review a larger gross amount.');
}
