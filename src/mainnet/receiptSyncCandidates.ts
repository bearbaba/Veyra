/** Candidate discovery only. Server does its own canonical chain verification.
 * Never triggers any wallet signature, allowance, send or retry.
 */
import type {LocalOperation} from './localOperations';
export function verifiedLocalPayMissingFromAccount(
 local:readonly LocalOperation[],
 verifiedStatuses:Readonly<Record<string,string>>,
 backendHashes:ReadonlySet<string>,
 owner:string,
 max=3,
):LocalOperation[]{
 if(!/^0x[0-9a-f]{40}$/i.test(owner))return [];
 const cap=Number.isInteger(max)?Math.max(0,Math.min(max,5)):3;
 return local.filter(v=>v.owner.toLowerCase()===owner.toLowerCase()&&
  v.type==='Pay'&&v.chainId===5042&&v.status==='RECORDED'&&
  verifiedStatuses[v.type+':'+v.chainId+':'+v.hash.toLowerCase()]==='VERIFIED'&&
  !backendHashes.has(v.hash.toLowerCase())).slice(0,cap);
}
