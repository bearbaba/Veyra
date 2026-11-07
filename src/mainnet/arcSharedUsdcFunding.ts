/** Arc uses ONE underlying USDC balance: native is 18dp, ERC-20 view is
 * 6dp. Do not sum these balances. Native wei = ERC20 micro-USDC * 10^12
 * plus a sub-micro remainder. A stale/conflicting read fails closed.
 *
 * The provisional 300k-unit allowance+pay gas budget is a conservative
 * planning reserve, NOT a guaranteed network fee; a fresh onchain
 * simulation and gas/allowance check are mandatory before Settlement.
 */
import {formatUnits,parseUnits} from 'viem';
import {gatewayMainnetAmount} from './gatewayMainnetBalances';
const OFFSET=1_000_000_000_000n;
export const ARC_PRE_FUND_GAS_LIMIT=300_000n;
const BUFFER_NUM=130n,BUFFER_DEN=100n;
const ceil=(a:bigint,b:bigint)=>(a+b-1n)/b;
export type ArcSharedUsdcFunding={
 paymentGross:string;gasReserve:string;available:string;
 minimumTotal:string;shortfall:string;gasUnitsBudget:string;
};
export function arcSharedUsdcFunding(input:{
 gross:string;nativeBalanceWei:bigint|null;erc20BalanceMicro:bigint|null;
 gasPriceWei:bigint|null;
}):ArcSharedUsdcFunding|null{
 const {gross,nativeBalanceWei:native,erc20BalanceMicro:erc20,gasPriceWei:gasPrice}=input;
 if(!gatewayMainnetAmount(gross)||native===null||erc20===null||gasPrice===null||
  native<0n||erc20<0n||gasPrice<=0n)return null;
 // A single USDC balance is exposed through two precision interfaces.
 const nativeMicro=native/OFFSET;
 // The read calls may have different heads. Refuse stale mismatches rather
 // than double count the balances or pretend it is a second gas asset.
 const difference=nativeMicro>erc20?nativeMicro-erc20:erc20-nativeMicro;
 if(difference>1n)return null;
 const actual=nativeMicro<erc20?nativeMicro:erc20;
 const grossMicro=parseUnits(gross,6);
 const gasWei=ceil(ARC_PRE_FUND_GAS_LIMIT*gasPrice*BUFFER_NUM,BUFFER_DEN);
 const reserveMicro=ceil(gasWei,OFFSET);
 const target=grossMicro+reserveMicro;
 const shortfall=target>actual?target-actual:0n;
 return {paymentGross:formatUnits(grossMicro,6),gasReserve:formatUnits(reserveMicro,6),
  available:formatUnits(actual,6),minimumTotal:formatUnits(target,6),
  shortfall:formatUnits(shortfall,6),gasUnitsBudget:ARC_PRE_FUND_GAS_LIMIT.toString()};
}
export function quoteSettlementProtocolNet(gross:string,feeBps:bigint|null){
 if(!gatewayMainnetAmount(gross)||feeBps===null||feeBps<0n||feeBps>100n)return null;
 const amount=parseUnits(gross,6);
 const fee=amount*feeBps/10000n;
 return {gross:formatUnits(amount,6),protocolFee:formatUnits(fee,6),
  recipientNet:formatUnits(amount-fee,6)};
}
