/** One immutable onchain bytes32 Settlement reference per server-issued request.
 * A text message, UUID claim or UI success is never evidence of paid USDC.
 */
import {keccak256,stringToHex,type Hex} from 'viem';
export const PAYMENT_REQUEST_ID=/^prq_[1-9A-HJ-NP-Za-km-z]{10,}$/;
export function paymentRequestRef(requestId:string):Hex{
 if(!PAYMENT_REQUEST_ID.test(requestId))throw Error('Invalid payment request ID.');
 return keccak256(stringToHex('VEYRA_PAYMENT_REQUEST_V1:'+requestId));
}
export const USDC_REQUEST_AMOUNT=/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,6})?$/;
export function validRequestUsdcAmount(amount:string):boolean{
 if(!USDC_REQUEST_AMOUNT.test(amount))return false;
 const [whole,part='']=amount.split('.');
 const raw=BigInt(whole)*1000000n+BigInt(part.padEnd(6,'0')||'0');
 return raw>0n&&raw<=1000000000000n;
}
