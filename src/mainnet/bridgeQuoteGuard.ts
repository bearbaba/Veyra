/** Circle App Kit's Bridge EstimateResult does not provide `estimatedOutput` or
 * `stopLimit` for CCTP USDC. It supplies `amount`, `token` and `fees`.
 * In SLOW forwarder mode, the SDK honors config.maxFee as an on-chain burn
 * fee cap. Bind that cap to the reviewed fee quote before user signing:
 * destination USDC must be >= amount - maxFee or the bridge cannot settle as
 * quoted. Never subtract gas fees in other native currencies from minted USDC.
 *
 * Missing/errored fees, mismatched amount, non-USDC fee or speed warnings
 * fail closed. This is NOT an independent funded end-to-end acceptance.
 */
import {formatUnits,parseUnits} from 'viem';
const AMOUNT=/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,6})?$/;
const error='Circle Bridge has no complete, fee-capped USDC quote. No wallet signature was requested.';
const micro=(v:unknown,zero=false):bigint|null=>{
 if(typeof v!=='string'||!AMOUNT.test(v))return null;
 const amount=parseUnits(v,6);
 return amount>0n||zero&&amount===0n?amount:null;
};
export type BridgeQuoteAmounts={minimum:string;expected:string;maxFee:string};
export function readBridgeQuoteAmounts(estimate:unknown,sent:string):BridgeQuoteAmounts{
 if(!estimate||typeof estimate!=='object'||Array.isArray(estimate))throw Error(error);
 const v=estimate as Record<string,unknown>;
 const input=micro(sent),quoted=micro(v.amount);
 if(input===null||quoted!==input||v.token!=='USDC'||!Array.isArray(v.fees)||
  v.fees.length===0||!Array.isArray(v.gasFees)||
  v.gasFees.some(item=>!!item&&typeof item==='object'&&'error' in item&&item.error!=null)||
  (Array.isArray(v.warnings)&&v.warnings.length>0))
  throw Error(error);
 let total=0n;
 for(const entry of v.fees){
  if(!entry||typeof entry!=='object'||Array.isArray(entry))throw Error(error);
  const fee=entry as Record<string,unknown>;
  const value=micro(fee.amount,true);
  if(fee.error!==undefined&&fee.error!==null||fee.token!=='USDC'||
   !['kit','provider','forwarder'].includes(String(fee.type))||value===null)
   throw Error(error);
  total+=value;
 }
 if(total>=input)throw Error('Bridge fees exceed the transfer amount. Nothing will be sent.');
 // SDK uses maxFee as the CCTP on-chain fee cap in SLOW + useForwarder mode.
 // The same value MUST be supplied to kit.bridge() at signing, never just shown.
 const min=input-total;
 return {minimum:formatUnits(min,6),expected:formatUnits(min,6),maxFee:formatUnits(total,6)};
}

/** Accept only fresh CCTP fees covered by the user's frozen onchain fee cap.
 * An equal/lower total is safe under that cap even if fee components changed;
 * an increased total requires explicit review and no wallet signature.
 */
export function assertBridgeQuoteWithinReviewedCap(
 freshEstimate:unknown,sent:string,reviewed:{minimum:string;maxFee:string}
):BridgeQuoteAmounts{
 const latest=readBridgeQuoteAmounts(freshEstimate,sent);
 const cap=micro(reviewed.maxFee,true),floor=micro(reviewed.minimum);
 if(cap===null||floor===null||parseUnits(latest.maxFee,6)>cap||
   parseUnits(latest.minimum,6)<floor)
  throw Error('Bridge fees increased. Refresh the quote to approve the new minimum.');
 return latest;
}
