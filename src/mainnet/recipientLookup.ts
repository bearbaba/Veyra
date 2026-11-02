/** Shared human-first Mainnet recipient lookup. No X-handle-to-wallet guessing.
 * An explicit .veyra namespace is always validated by the signed identity backend;
 * wallet addresses are only address syntax, not proof of a Veyra account.
 */
import {isAddress,getAddress} from 'viem';
import {preparePaymentRecipient,verifyPaymentRecipient,type PreparedRecipient} from '@/lib/api/identityApi';
import {validVerifiedRecipient,type VerifiedMainnetRecipient} from './verifiedRecipient';

export type RecipientQuery=
 | {kind:'veyra';query:string}
 | {kind:'wallet';wallet:string}
 | {kind:'x-unavailable';handle:string;query:string};
export type RecipientSearchResult=
 | {kind:'veyra';person:VerifiedMainnetRecipient}
 | {kind:'wallet';wallet:string}
 | {kind:'x-unavailable';handle:string;inviteText:string};

const VEYRA=/^@?([a-z0-9_-]{2,32})\.veyra$/i;
const X=/^@([a-z0-9_]{1,15})$/i;
const XURL=/^https:\/\/(?:www\.)?(?:x\.com|twitter\.com)\/([a-z0-9_]{1,15})\/?$/i;
export function parseRecipientQuery(input:string):RecipientQuery{
 const raw=input.trim();
 if(isAddress(raw)&&/^0x[0-9a-fA-F]{40}$/.test(raw))return {kind:'wallet',wallet:getAddress(raw)};
 const v=VEYRA.exec(raw);
 if(v)return {kind:'veyra',query:'@'+v[1].toLowerCase()+'.veyra'};
 const x=X.exec(raw)??XURL.exec(raw);
 if(x)return {kind:'x-unavailable',handle:x[1].toLowerCase(),query:'@'+x[1].toLowerCase()};
 throw new Error('Enter a full @name.veyra, a verified wallet address, or an @Xhandle. A bare name is ambiguous.');
}
type LookupDeps={
 prepare:(query:string,chainId:number,token:string)=>Promise<PreparedRecipient>;
 verify:(args:{snapshotId:string;expectedWalletId:string;expectedWalletAddress:string;
  expectedChainId:number;reviewToken:string},token:string)=>Promise<void>;
};
const defaultDeps:LookupDeps={prepare:preparePaymentRecipient,verify:verifyPaymentRecipient};
export async function lookupMainnetRecipient(
 input:string,owner:string,sessionToken:string|undefined,
 deps:LookupDeps=defaultDeps,
):Promise<RecipientSearchResult>{
 const query=parseRecipientQuery(input);
 if(query.kind==='wallet')return query;
 if(query.kind==='x-unavailable')
  return {kind:'x-unavailable',handle:query.handle,
   inviteText:'You can receive USDC with Veyra. Create your verified Veyra ID at https://veyra-seven-beta.vercel.app/'};
 if(!isAddress(owner)||!sessionToken)throw Error('Sign in to your Veyra ID to verify this recipient.');
 const data=await deps.prepare(query.query,5042,sessionToken);
 if(data.kind!=='VEYRA_IDENTITY'||data.chainId!==5042||!data.snapshot||!isAddress(data.resolvedAddress))
  throw Error('This Veyra ID has no independently verified Arc Mainnet receiving wallet.');
 const s=data.snapshot;
 const person:VerifiedMainnetRecipient={owner,wallet:data.resolvedAddress,walletId:s.walletId,
  veyraUserId:s.veyraUserId,veyraHandle:s.veyraHandle,displayName:s.displayName,
  avatarUrl:s.avatarUrl,snapshotId:s.snapshotId,reviewToken:s.reviewToken,expiresAt:s.expiresAt};
 if(!validVerifiedRecipient(person,owner,person.wallet))
  throw Error('This recipient snapshot is invalid or expired. Search again.');
 await deps.verify({snapshotId:person.snapshotId,expectedWalletId:person.walletId,
  expectedWalletAddress:person.wallet,expectedChainId:5042,reviewToken:person.reviewToken},sessionToken);
 return {kind:'veyra',person};
}
/** Only the latest completed async lookup may change the selected recipient. */
export function createRecipientSearchGuard(){
 let current=0;
 return {start:()=>++current,invalid:()=>{current++;},isCurrent:(ticket:number)=>ticket===current};
}
