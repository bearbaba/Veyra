/** A server-prepared recipient. An in-memory suggestion never authorizes payment.
 * Verify the snapshot again against the signed BFF session immediately before signing.
 */
import {isAddress} from 'viem';
export type VerifiedMainnetRecipient={
 owner:string;wallet:string;walletId:string;veyraUserId:string;veyraHandle:string;
 displayName:string;snapshotId:string;reviewToken:string;expiresAt:string;
};
export function validVerifiedRecipient(v:VerifiedMainnetRecipient,owner:string,recipient:string,now=Date.now()):boolean{
 return isAddress(v.owner)&&v.owner.toLowerCase()===owner.toLowerCase()&&
 isAddress(v.wallet)&&v.wallet.toLowerCase()===recipient.toLowerCase()&&
 typeof v.walletId==='string'&&v.walletId.length>0&&
 typeof v.veyraUserId==='string'&&/^usr_[1-9A-HJ-NP-Za-km-z]{10,}$/.test(v.veyraUserId)&&
 typeof v.veyraHandle==='string'&&/^[a-z0-9_-]{2,32}$/i.test(v.veyraHandle)&&
 typeof v.snapshotId==='string'&&v.snapshotId.length>0&&
 typeof v.reviewToken==='string'&&v.reviewToken.length>0&&
 Number.isFinite(Date.parse(v.expiresAt))&&Date.parse(v.expiresAt)>now;
}

export function isSameVerifiedPaymentReceiver(old:VerifiedMainnetRecipient,now:VerifiedMainnetRecipient):boolean{
 return old.owner.toLowerCase()===now.owner.toLowerCase()&&
 old.wallet.toLowerCase()===now.wallet.toLowerCase()&&
 old.walletId===now.walletId&&old.veyraUserId===now.veyraUserId&&
 old.veyraHandle.toLowerCase()===now.veyraHandle.toLowerCase()&&
 validVerifiedRecipient(now,old.owner,old.wallet);
}
