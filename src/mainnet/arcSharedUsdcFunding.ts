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

/** Exact pre-sign Arc invariant: gas + ERC20 are a single USDC asset.
 * Fresh chain reads must cover payment and buffered network gas. Material
 * fee drift requires another explicit Review rather than silent signing.
 */
export function assertArcLivePayFunds(input:{
 grossMicro:bigint;nativeBalanceWei:bigint;erc20BalanceMicro:bigint;
 gasEstimateUnits:bigint;gasPriceWei:bigint;reviewedGasWei:bigint;
}):void{
 const {grossMicro:gross,nativeBalanceWei:native,
  erc20BalanceMicro:token,gasEstimateUnits:units,
  gasPriceWei:price,reviewedGasWei:reviewed}=input;
 if(gross<=0n||native<0n||token<0n||units<=0n||price<=0n||reviewed<=0n)
  throw Error('Current Arc USDC and gas review are unavailable. No signing.');
 const observed=native/OFFSET;
 const delta=observed>token?observed-token:token-observed;
 if(delta>1n)throw Error('Arc USDC balance views disagree. Refresh before signing.');
 const gas=units*price;
 if(gas>ceil(reviewed*125n,100n))
  throw Error('Arc gas changed since Review. Review fees again before signing.');
 const buffered=ceil(gas*BUFFER_NUM,BUFFER_DEN);
 if(native<gross*OFFSET+buffered||token<gross)
  throw Error('Arc USDC cannot cover payment and network gas. Top up or reduce amount before signing.');
}
