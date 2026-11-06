/** Signed-session-only, friend-scoped USDC requests. A request never moves
 * funds and is PAID only when a separately verified onchain Settlement
 * receipt exactly matches its immutable reference, actors, wallet and amount.
 */
import {and,desc,eq,gte,gt,isNull,or} from 'drizzle-orm';
import {walletBindings} from '../db/schema/wallets.js';
import {getAddress,parseUnits} from 'viem';
import type {DbClient} from '../db/client.js';
import {newNotificationId,newPaymentRequestId,isValidClientIntentId} from '../db/ids.js';
import {paymentRequests} from '../db/schema/paymentRequests.js';
import {mainnetSettlementReceipts} from '../db/schema/mainnetSettlement.js';
import {veyraNotifications} from '../db/schema/notifications.js';
import {getConnectionStatus} from '../db/repositories/socialRepository.js';
import {freezeSnapshot} from './identityResolver.js';
import {chooseRecipientWallet} from './paymentRecipientService.js';
import {paymentRequestRef,PAYMENT_REQUEST_ID,validRequestUsdcAmount} from '../../src/mainnet/paymentRequestRef.js';

const USER=/^usr_[1-9A-HJ-NP-Za-km-z]{10,}$/;
export const REQUEST_TTL_MS=7*24*60*60*1000;
/** No local-only expiry; all clients read one server deadline. */
export class PaymentRequestError extends Error{
 constructor(public readonly code:string,message:string,public readonly httpStatus=400){
  super(message);this.name='PaymentRequestError';
 }
}
const deny=(code:string,message:string,status=400):never=>{throw new PaymentRequestError(code,message,status);};
async function requirePeer(db:DbClient,owner:string,peer:unknown):Promise<string>{
 if(typeof peer!=='string'||!USER.test(peer)||peer===owner)
  return deny('INVALID_REQUEST_PEER','Select another verified Veyra ID.');
 if(await getConnectionStatus(db,owner,peer)!=='CONNECTED')
  return deny('REQUEST_FRIEND_REQUIRED','Payment requests are available only to connected, unblocked friends.',403);
 return peer;
}
export function parseRequestAmount(value:unknown):string{
 if(typeof value!=='string'||!validRequestUsdcAmount(value))
  return deny('INVALID_REQUEST_AMOUNT','Enter 0.000001–1,000,000 USDC with at most six decimal places.');
 return parseUnits(value,6).toString();
}
type Row=typeof paymentRequests.$inferSelect;
export function visiblePaymentRequest(row:Row){
 return {requestId:row.requestId,requesterUserId:row.requesterUserId,
  payerUserId:row.payerUserId,amountRaw:row.amountRaw,chainId:5042 as const,
  recipientWallet:row.recipientWallet,paymentRef:row.paymentRef,
  status:row.status,txHash:row.txHash,paymentInProgress:row.claimId!==null,
  createdAt:row.createdAt.toISOString(),updatedAt:row.updatedAt.toISOString(),
  expiresAt:row.expiresAt.toISOString(),
  ...(row.paidAt?{paidAt:row.paidAt.toISOString()}:{}),
  ...(row.cancelledAt?{cancelledAt:row.cancelledAt.toISOString()}:{}),
 };
}
export function receiptMatchesPaymentRequest(
 request:Pick<Row,'requesterUserId'|'payerUserId'|'recipientWallet'|'amountRaw'|'paymentRef'|'createdAt'|'expiresAt'>,
 receipt:Pick<typeof mainnetSettlementReceipts.$inferSelect,
  'senderUserId'|'recipientUserId'|'recipientAddress'|'amountRaw'|'paymentRef'|'paidAt'>,
):boolean{
 return receipt.senderUserId===request.payerUserId&&
  receipt.recipientUserId===request.requesterUserId&&
  receipt.recipientAddress.toLowerCase()===request.recipientWallet.toLowerCase()&&
  receipt.amountRaw===request.amountRaw&&receipt.paymentRef===request.paymentRef&&
  receipt.paidAt.getTime()>=request.createdAt.getTime()&&
  receipt.paidAt.getTime()<request.expiresAt.getTime();
}
/** This only reads canonical receipt rows written by the onchain verifier.
 * A chat message, browser-supplied hash or user click cannot call PAID.
 * Compare-and-swap preserves cancellation and prevents duplicate attribution.
 */
export async function reconcileOneRequest(db:DbClient,request:Row):Promise<Row>{
 if(request.status==='PAID'||request.status==='CANCELLED')return request;
 const receipts=await db.select().from(mainnetSettlementReceipts).where(and(
  eq(mainnetSettlementReceipts.paymentRef,request.paymentRef),
  eq(mainnetSettlementReceipts.senderUserId,request.payerUserId),
  eq(mainnetSettlementReceipts.recipientUserId,request.requesterUserId),
  eq(mainnetSettlementReceipts.recipientAddress,request.recipientWallet.toLowerCase()),
  eq(mainnetSettlementReceipts.amountRaw,request.amountRaw),
  gte(mainnetSettlementReceipts.paidAt,request.createdAt),
 )).limit(2);
 if(receipts.length===1&&receiptMatchesPaymentRequest(request,receipts[0]!)){
  const receipt=receipts[0]!,now=new Date();
  // Even an expired request may later receive proof that the original
  // payment actually happened before expiry. No second transfer is triggered.
  const [paid]=await db.update(paymentRequests).set({
   status:'PAID',txHash:receipt.txHash,paidAt:receipt.paidAt,updatedAt:now,
  }).where(and(eq(paymentRequests.requestId,request.requestId),
   or(eq(paymentRequests.status,'PENDING'),eq(paymentRequests.status,'EXPIRED')),
   isNull(paymentRequests.txHash))).returning();
  if(paid){
   await db.insert(veyraNotifications).values({
    notificationId:newNotificationId(),ownerUserId:request.requesterUserId,
    actorUserId:request.payerUserId,kind:'PAYMENT_STATUS',
    eventRef:'payment-request:'+request.requestId+':paid',
   }).onConflictDoNothing();
   return paid;
  }
 }
 if(request.status==='PENDING'&&request.expiresAt.getTime()<=Date.now()){
  const [expired]=await db.update(paymentRequests)
   .set({status:'EXPIRED',updatedAt:new Date()})
   .where(and(eq(paymentRequests.requestId,request.requestId),
    eq(paymentRequests.status,'PENDING'),isNull(paymentRequests.txHash))).returning();
  if(expired)return expired;
 }
 const [latest]=await db.select().from(paymentRequests)
  .where(eq(paymentRequests.requestId,request.requestId)).limit(1);
 return latest??request;
}
export async function createPaymentRequest(
 db:DbClient,requesterUserId:string,
 input:{peerUserId:unknown;amount:unknown;clientRequestId:unknown},
){
 const payerUserId=await requirePeer(db,requesterUserId,input.peerUserId);
 const amountRaw=parseRequestAmount(input.amount);
 if(typeof input.clientRequestId!=='string'||!isValidClientIntentId(input.clientRequestId))
  return deny('INVALID_REQUEST_KEY','A valid idempotency key is required.');
 const [prior]=await db.select().from(paymentRequests).where(and(
  eq(paymentRequests.requesterUserId,requesterUserId),
  eq(paymentRequests.clientRequestId,input.clientRequestId))).limit(1);
 if(prior){
  if(prior.payerUserId!==payerUserId||prior.amountRaw!==amountRaw)
   return deny('REQUEST_KEY_CONFLICT','This request key belongs to different payment details.',409);
  return {ok:true,created:false,request:visiblePaymentRequest(prior)};
 }
 // Freeze precisely one owner-verified Arc Mainnet receiving wallet.
 const snapshot=await freezeSnapshot(db,requesterUserId);
 const wallet=chooseRecipientWallet(snapshot.resolvedWallets,5042,
  snapshot.receivePreference as Record<string,unknown>);
 if(!wallet)return deny('REQUEST_RECEIVE_WALLET_UNVERIFIED',
  'Set exactly one verified Arc Mainnet receiving wallet before requesting USDC.',409);
 const requestId=newPaymentRequestId();
 const ref=paymentRequestRef(requestId);
 const clientRequestId=input.clientRequestId as string;
 const inserted=await db.transaction(async tx=>{
  const [created]=await tx.insert(paymentRequests).values({
   requestId,requesterUserId,payerUserId,clientRequestId,
   amountRaw,chainId:5042,expiresAt:new Date(Date.now()+REQUEST_TTL_MS),
   recipientWallet:getAddress(wallet.walletAddress).toLowerCase(),
   recipientWalletId:wallet.walletId,paymentRef:ref,status:'PENDING',
  }).onConflictDoNothing({target:[paymentRequests.requesterUserId,paymentRequests.clientRequestId]}).returning();
  if(created){
   await tx.insert(veyraNotifications).values({
    notificationId:newNotificationId(),ownerUserId:payerUserId,
    actorUserId:requesterUserId,kind:'PAYMENT_STATUS',
    eventRef:'payment-request:'+requestId+':new',
   }).onConflictDoNothing();
  }
  return created??null;
 });
 if(inserted)return {ok:true,created:true,request:visiblePaymentRequest(inserted)};
 const [existing]=await db.select().from(paymentRequests).where(and(
  eq(paymentRequests.requesterUserId,requesterUserId),
  eq(paymentRequests.clientRequestId,input.clientRequestId))).limit(1);
 if(!existing||existing.payerUserId!==payerUserId||existing.amountRaw!==amountRaw)
  return deny('REQUEST_KEY_CONFLICT','This request key belongs to different payment details.',409);
 return {ok:true,created:false,request:visiblePaymentRequest(existing)};
}
export async function listPeerPaymentRequests(db:DbClient,owner:string,peer:unknown){
 const friend=await requirePeer(db,owner,peer);
 const rows=await db.select().from(paymentRequests).where(or(
  and(eq(paymentRequests.requesterUserId,owner),eq(paymentRequests.payerUserId,friend)),
  and(eq(paymentRequests.requesterUserId,friend),eq(paymentRequests.payerUserId,owner)),
 )).orderBy(desc(paymentRequests.createdAt),desc(paymentRequests.requestId)).limit(50);
 const resolved=[];
 for(const row of rows)resolved.push(visiblePaymentRequest(await reconcileOneRequest(db,row)));
 return {ok:true,requests:resolved};
}
export async function reviewPaymentRequest(db:DbClient,owner:string,rawId:unknown){
 if(typeof rawId!=='string'||!PAYMENT_REQUEST_ID.test(rawId))
  return deny('INVALID_REQUEST_ID','Invalid payment request ID.');
 const [row]=await db.select().from(paymentRequests)
  .where(eq(paymentRequests.requestId,rawId)).limit(1);
 if(!row||row.payerUserId!==owner)return deny('REQUEST_NOT_FOUND','Payment request not found.',404);
 await requirePeer(db,owner,row.requesterUserId);
 const current=await reconcileOneRequest(db,row);
 if(current.status!=='PENDING'||current.expiresAt.getTime()<=Date.now())
  return deny('REQUEST_NOT_PENDING','This payment request is no longer payable.',409);
 return {ok:true,request:visiblePaymentRequest(current)};
}
export async function cancelPaymentRequest(db:DbClient,owner:string,rawId:unknown){
 if(typeof rawId!=='string'||!PAYMENT_REQUEST_ID.test(rawId))
  return deny('INVALID_REQUEST_ID','Invalid payment request ID.');
 const [row]=await db.select().from(paymentRequests)
  .where(eq(paymentRequests.requestId,rawId)).limit(1);
 if(!row||row.requesterUserId!==owner)
  return deny('REQUEST_NOT_FOUND','Payment request not found.',404);
 const current=await reconcileOneRequest(db,row);
 if(current.status==='PAID')return deny('REQUEST_ALREADY_PAID','Verified payment cannot be cancelled.',409);
 if(current.status==='EXPIRED')return {ok:true,request:visiblePaymentRequest(current)};
 if(current.claimId!==null)return deny('REQUEST_PAYMENT_IN_PROGRESS',
  'A wallet payment for this request is unresolved. Check the original attempt.',409);
 if(current.status==='CANCELLED')return {ok:true,request:visiblePaymentRequest(current)};
 const now=new Date();
 const [updated]=await db.update(paymentRequests).set({
  status:'CANCELLED',cancelledAt:now,updatedAt:now,
 }).where(and(eq(paymentRequests.requestId,rawId),eq(paymentRequests.status,'PENDING'),
  isNull(paymentRequests.claimId))).returning();
 if(!updated)return deny('REQUEST_STATE_CHANGED','Payment request changed. Refresh before retry.',409);
 await db.insert(veyraNotifications).values({
  notificationId:newNotificationId(),ownerUserId:row.payerUserId,
  actorUserId:owner,kind:'PAYMENT_STATUS',
  eventRef:'payment-request:'+rawId+':cancelled',
 }).onConflictDoNothing();
 return {ok:true,request:visiblePaymentRequest(updated)};
}

/** A claim is a reservation for exactly one frozen wallet attempt, not a
 * transferable permission. Same-attempt retry is idempotent; a different ID
 * or wallet never inherits the claim, even after expiry or a read timeout.
 * We intentionally do NOT expose a client-driven release endpoint: the
 * Settlement contract does not enforce reference uniqueness, and a browser
 * cannot prove that an unseen wallet transaction was never broadcast.
 */
export function samePaymentAttempt(row:Pick<Row,'claimId'|'claimWallet'>,
 attemptId:string,wallet:string):boolean{
 return row.claimId===attemptId&&row.claimWallet===wallet.toLowerCase();
}
function parseAttempt(input:{requestId:unknown;attemptId:unknown;walletAddress:unknown}){
 if(typeof input.requestId!=='string'||!PAYMENT_REQUEST_ID.test(input.requestId)||
  typeof input.attemptId!=='string'||!isValidClientIntentId(input.attemptId)||
  typeof input.walletAddress!=='string'||!/^0x[0-9a-fA-F]{40}$/.test(input.walletAddress))
  return deny('INVALID_PAYMENT_ATTEMPT','Invalid payment request ID, attempt ID or wallet.');
 return {requestId:input.requestId,attemptId:input.attemptId,
  wallet:getAddress(input.walletAddress).toLowerCase()};
}
/** Owner-only lookup. The caller supplies the local attempt ID; it is
 * NEVER leaked to a second device, other payer, payee or chat participant.
 * Missing claim is not proof of a failed chain transaction.
 */
export async function getPaymentRequestClaim(db:DbClient,payerUserId:string,
 input:{requestId:unknown;attemptId:unknown;walletAddress:unknown}){
 const {requestId,attemptId,wallet}=parseAttempt(input);
 const [row]=await db.select().from(paymentRequests)
  .where(and(eq(paymentRequests.requestId,requestId),
   eq(paymentRequests.payerUserId,payerUserId))).limit(1);
 if(!row)return deny('REQUEST_NOT_FOUND','Payment request not found.',404);
 await requirePeer(db,payerUserId,row.requesterUserId);
 const current=await reconcileOneRequest(db,row);
 return {ok:true,matches:samePaymentAttempt(current,attemptId,wallet),
  request:visiblePaymentRequest(current)};
}
export async function claimPaymentRequest(
 db:DbClient,payerUserId:string,
 input:{requestId:unknown;attemptId:unknown;walletAddress:unknown},
){
 const {requestId,attemptId,wallet}=parseAttempt(input);
 const {request}=await reviewPaymentRequest(db,payerUserId,requestId);
 const [existing]=await db.select().from(paymentRequests).where(and(
  eq(paymentRequests.requestId,requestId),
  eq(paymentRequests.payerUserId,payerUserId))).limit(1);
 if(!existing)return deny('REQUEST_NOT_FOUND','Payment request not found.',404);
 if(existing.claimId!==null&&!samePaymentAttempt(existing,attemptId,wallet))
  return deny('REQUEST_PAYMENT_IN_PROGRESS',
   'Another attempt has reserved this request. Recover the original attempt; do not sign twice.',409);
 // Both first-time and resumed claims require the wallet to STILL be
 // actively bound to the signed payer. Revocation cannot inherit a claim.
 const [binding]=await db.select({id:walletBindings.walletId}).from(walletBindings)
  .where(and(eq(walletBindings.veyraUserId,payerUserId),eq(walletBindings.chainId,5042),
   eq(walletBindings.walletAddress,wallet),eq(walletBindings.status,'ACTIVE'),
   isNull(walletBindings.revokedAt))).limit(1);
 if(!binding)return deny('PAYMENT_WALLET_NOT_BOUND',
  'Payer wallet is not actively bound to this signed Veyra ID on Arc.',403);
 if(existing.claimId!==null)return {ok:true,created:false,request:visiblePaymentRequest(existing)};
 const now=new Date();
 const [claimed]=await db.update(paymentRequests).set({
  claimId:attemptId,claimWallet:wallet,claimedAt:now,updatedAt:now,
 }).where(and(eq(paymentRequests.requestId,requestId),
  eq(paymentRequests.payerUserId,payerUserId),eq(paymentRequests.status,'PENDING'),
  isNull(paymentRequests.claimId),gt(paymentRequests.expiresAt,now))).returning();
 if(claimed)return {ok:true,created:true,request:visiblePaymentRequest(claimed)};
 // Race: if this exact attempt won another in-flight request, reply
 // idempotently. Otherwise fail closed; never take over someone else's claim.
 const [winner]=await db.select().from(paymentRequests).where(and(
  eq(paymentRequests.requestId,requestId),
  eq(paymentRequests.payerUserId,payerUserId))).limit(1);
 if(winner?.status==='PENDING'&&samePaymentAttempt(winner,attemptId,wallet))
  return {ok:true,created:false,request:visiblePaymentRequest(winner)};
 return deny('REQUEST_PAYMENT_IN_PROGRESS',
  'Request changed or another wallet attempt was already reserved. Do not sign again.',409);
}
