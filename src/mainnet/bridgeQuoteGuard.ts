/** Circle estimates MUST include an explicit provider-guaranteed output floor.
 * Fees alone aren't a safe lower-bound for Forwarding Service execution.
 * No user-entered "minimum receive" or inferred zero-fee claim.
 */
import {parseUnits} from 'viem';
const AMOUNT=/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,6})?$/;
function amount(field:unknown):string|null{
 const value=field&&typeof field==='object'&&!Array.isArray(field)?(field as {amount?:unknown}).amount:field;
 return typeof value==='string'&&AMOUNT.test(value)&&parseUnits(value,6)>0n?value:null;
}
export function readBridgeQuoteAmounts(estimate:unknown,sent:string):{minimum:string;expected:string}{
 if(!estimate||typeof estimate!=='object'||Array.isArray(estimate))
  throw Error('Circle Bridge quote unavailable. No wallet request will be started.');
 const v=estimate as Record<string,unknown>;
 const floor=amount(v.minimumReceived??v.minimumOutput??v.minimumReceive??v.minReceive??v.stopLimit);
 const expected=amount(v.estimatedOutput??v.expectedOutput??v.receiveAmount??v.amountOut);
 if(!floor||!expected||!AMOUNT.test(sent)||parseUnits(floor,6)>parseUnits(expected,6)||
    parseUnits(expected,6)>parseUnits(sent,6))
  throw Error('Circle has not provided a guaranteed destination minimum for this Bridge quote. Signing is unavailable; no manual minimum is required.');
 return {minimum:floor,expected};
}
