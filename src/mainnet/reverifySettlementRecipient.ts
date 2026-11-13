/** An identity suggestion is never enough to authorize Settlement.pay().
 * Re-read the signed Veyra ID against its immutable wallet identity just before
 * writing a contract payment, and reject any change in wallet/user/handle.
 */
import {isAddress} from 'viem';
import {preparePaymentRecipient,verifyPaymentRecipient,type PreparedRecipient} from '@/lib/api/identityApi';
import {isSameVerifiedPaymentReceiver,type VerifiedMainnetRecipient} from './verifiedRecipient';

type IdentityDeps={
 prepare:typeof preparePaymentRecipient;
 verify:typeof verifyPaymentRecipient;
};
const defaults:IdentityDeps={prepare:preparePaymentRecipient,verify:verifyPaymentRecipient};

export async function reverifySettlementRecipient(args:{
 original:VerifiedMainnetRecipient|null|undefined;owner:string;recipient:string;
 sessionToken:string|undefined;sessionWalletBound:boolean;
},deps:IdentityDeps=defaults):Promise<VerifiedMainnetRecipient|null>{
 const {original,owner,recipient,sessionToken,sessionWalletBound}=args;
 if(!isAddress(owner)||!isAddress(recipient))throw Error('Invalid Settlement sender or recipient wallet.');
 if(!original)return null; // Explicit plain-address Settlement, no Veyra ID claimed.
 if(!sessionWalletBound||!sessionToken)
  throw Error('Sign in again with the connected wallet to verify this Veyra recipient.');
 if(original.owner.toLowerCase()!==owner.toLowerCase()||
  original.wallet.toLowerCase()!==recipient.toLowerCase())
  throw Error('Settlement recipient differs from the selected verified Veyra ID.');
 const prepared:PreparedRecipient=await deps.prepare('@'+original.veyraHandle+'.veyra',5042,sessionToken);
 if(prepared.kind!=='VEYRA_IDENTITY'||prepared.chainId!==5042||!prepared.snapshot||
   !isAddress(prepared.resolvedAddress))
  throw Error('Selected Veyra ID is no longer resolvable to a verified Arc Mainnet wallet.');
 const sn=prepared.snapshot;
 const renewed:VerifiedMainnetRecipient={
  owner,wallet:prepared.resolvedAddress,walletId:sn.walletId,
  veyraUserId:sn.veyraUserId,veyraHandle:sn.veyraHandle,
  displayName:sn.displayName,avatarUrl:sn.avatarUrl,
  snapshotId:sn.snapshotId,reviewToken:sn.reviewToken,expiresAt:sn.expiresAt,
 };
 if(!isSameVerifiedPaymentReceiver(original,renewed)||
  renewed.wallet.toLowerCase()!==recipient.toLowerCase())
  throw Error('Veyra ID ownership or receiving wallet changed. Return to People and review again.');
 await deps.verify({
  snapshotId:renewed.snapshotId,expectedWalletId:renewed.walletId,
  expectedWalletAddress:recipient,expectedChainId:5042,reviewToken:renewed.reviewToken,
 },sessionToken);
 return renewed;
}
