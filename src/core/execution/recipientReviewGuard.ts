import type {PreparedRecipient} from '../../lib/api/identityApi';
const ADDRESS=/^0x[0-9a-fA-F]{40}$/;
const ZERO=/^0x0{40}$/i;
const has=(x:unknown):x is string=>typeof x==='string'&&x.length>0&&x.length<=1024;
/** A signed Veyra ID cannot downgrade to an unchecked wallet transfer. */
export function assertPreparedRecipientReview(input:{
 prepared:PreparedRecipient|null|undefined;originalRecipient:string;
 senderAddress:string;expectedChainId:number;now?:number;
}):void {
 const {prepared,originalRecipient,senderAddress,expectedChainId}=input;
 if(!prepared||!ADDRESS.test(prepared.resolvedAddress)||ZERO.test(prepared.resolvedAddress))
   throw Error('Recipient wallet could not be verified.');
 if(!ADDRESS.test(senderAddress)||prepared.resolvedAddress.toLowerCase()===senderAddress.toLowerCase())
   throw Error('Recipient must be a different verified wallet.');
 if(prepared.chainId!==expectedChainId)
   throw Error('Recipient was resolved for a different blockchain. Review again.');
 if(ADDRESS.test(originalRecipient)){
   if(prepared.kind!=='WALLET'||prepared.snapshot!==null)
     throw Error('Literal wallet transfer has an unexpected identity proof.');
   if(originalRecipient.toLowerCase()!==prepared.resolvedAddress.toLowerCase())
     throw Error('Wallet address changed after review. Start again.');
   return;
 }
 if(prepared.kind!=='VEYRA_IDENTITY'||!prepared.snapshot)
   throw Error('Veyra ID requires a fresh verified recipient snapshot.');
 const p=prepared.snapshot;
 if(!has(p.snapshotId)||!has(p.walletId)||!has(p.reviewToken)||
    !has(p.veyraHandle)||!has(p.veyraUserId)||!p.veyraUserId.startsWith('usr_'))
   throw Error('Incomplete Veyra ID verification. Recipient is not approved.');
 const expires=Date.parse(p.expiresAt);
 if(!Number.isFinite(expires)||expires<=(input.now??Date.now()))
   throw Error('Veyra ID verification expired. Resolve again.');
}
