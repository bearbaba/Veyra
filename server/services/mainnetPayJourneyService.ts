/** Durable cross-device Pay-funding coordination, never financial authority.
 * A signed Veyra session is not enough to claim a wallet: the backend checks
 * the CURRENT Arc wallet binding. Exactly one unresolved funding journey
 * exists per owner wallet. Only a canonical server-indexed Settlement receipt
 * may mark it terminal. Client completion/hash/status fields are rejected.
 */
import {and,eq,gte,isNull,sql} from 'drizzle-orm';
import {getAddress,isAddress,keccak256,parseUnits,stringToHex} from 'viem';
import type {DbClient} from '../db/client.js';
import {mainnetPayJourneys} from '../db/schema/mainnetPayJourneys.js';
import {mainnetSettlementReceipts} from '../db/schema/mainnetSettlement.js';
import {paymentRequests} from '../db/schema/paymentRequests.js';
import {mainnetActiveBinding} from './mainnetPayReceiptService.js';
import {paymentRequestRef} from '../../src/mainnet/paymentRequestRef.js';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const USER=/^usr_[1-9A-HJ-NP-Za-km-z]{10,}$/;
const AMOUNT=/^(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,6})?$/;
const REQUEST=/^prq_[1-9A-HJ-NP-Za-km-z]{10,}$/;
export class PayJourneyError extends Error{
 constructor(public readonly code:string,public readonly httpStatus=409){
  super(code);this.name='PayJourneyError';
 }
}
const fail=(code:string,status=409):never=>{throw new PayJourneyError(code,status);};
export type PayJourneyLock={
 journeyId:string;gatewayOperationId:string;ownerWallet:string;
 payeeWallet:string;grossUsdc:string;requestId?:string;
};
const accepted=new Set(['journeyId','gatewayOperationId','ownerWallet','payeeWallet','grossUsdc','requestId']);
export function parsePayJourneyLock(input:unknown):PayJourneyLock{
 if(!input||typeof input!=='object'||Array.isArray(input))return fail('INVALID_JOURNEY',400);
 const r=input as Record<string,unknown>;
 if(Object.keys(r).some(k=>!accepted.has(k)))return fail('UNTRUSTED_JOURNEY_FIELD',400);
 if(typeof r.journeyId!=='string'||!UUID.test(r.journeyId)||
    typeof r.gatewayOperationId!=='string'||!UUID.test(r.gatewayOperationId)||
    typeof r.ownerWallet!=='string'||!isAddress(r.ownerWallet)||
    typeof r.payeeWallet!=='string'||!isAddress(r.payeeWallet)||
    typeof r.grossUsdc!=='string'||!AMOUNT.test(r.grossUsdc)||
    parseUnits(r.grossUsdc,6)<=0n||parseUnits(r.grossUsdc,6)>1000000000000n||
    (r.requestId!==undefined&&(typeof r.requestId!=='string'||!REQUEST.test(r.requestId))))
   return fail('INVALID_JOURNEY',400);
 return {journeyId:r.journeyId,gatewayOperationId:r.gatewayOperationId,
  ownerWallet:getAddress(r.ownerWallet),payeeWallet:getAddress(r.payeeWallet),
  grossUsdc:r.grossUsdc,...(typeof r.requestId==='string'?{requestId:r.requestId}:{})};
}
/** Each signed generic Pay uses a stable, distinct, nonzero bytes32 ref.
 * No new ref is ever allocated merely because the browser reloaded.
 */
export function genericPayFundingRef(journeyId:string){
 if(!UUID.test(journeyId))return fail('INVALID_JOURNEY',400);
 return keccak256(stringToHex('VEYRA_PAY_FUNDING_V1:'+journeyId));
}
type Row=typeof mainnetPayJourneys.$inferSelect;
export function visiblePayJourney(row:Row){
 return {journeyId:row.journeyId,ownerWallet:row.ownerWallet,
  payeeWallet:row.payeeWallet,amountRaw:row.amountRaw,
  paymentRef:row.paymentRef,requestId:row.requestId,
  gatewayOperationId:row.gatewayOperationId,
  status:row.verifiedTxHash?'SETTLEMENT_VERIFIED' as const:'RESERVED' as const,
  // This hash was independently indexed and checked onchain on the server;
  // the client never sent it to the journey lock API.
  verifiedTxHash:row.verifiedTxHash,
  createdAt:row.createdAt.toISOString(),updatedAt:row.updatedAt.toISOString()};
}
export function sameLockedJourney(row:Row,input:PayJourneyLock,
 ownerUserId:string,ref:string):boolean{
 return row.ownerUserId===ownerUserId&&row.journeyId===input.journeyId&&
  row.gatewayOperationId===input.gatewayOperationId&&
  row.ownerWallet.toLowerCase()===input.ownerWallet.toLowerCase()&&
  row.payeeWallet.toLowerCase()===input.payeeWallet.toLowerCase()&&
  row.amountRaw===parseUnits(input.grossUsdc,6).toString()&&
  (row.requestId??undefined)===input.requestId&&
  row.paymentRef.toLowerCase()===ref.toLowerCase();
}
async function reconcileServerReceipt(db:DbClient,row:Row):Promise<Row>{
 if(row.verifiedTxHash)return row;
 const receipts=await db.select().from(mainnetSettlementReceipts).where(and(
  eq(mainnetSettlementReceipts.senderUserId,row.ownerUserId),
  eq(mainnetSettlementReceipts.senderAddress,row.ownerWallet.toLowerCase()),
  eq(mainnetSettlementReceipts.recipientAddress,row.payeeWallet.toLowerCase()),
  eq(mainnetSettlementReceipts.paymentRef,row.paymentRef.toLowerCase()),
  eq(mainnetSettlementReceipts.amountRaw,row.amountRaw),
  gte(mainnetSettlementReceipts.paidAt,row.createdAt),
 )).limit(2);
 if(receipts.length!==1)return row;
 const receipt=receipts[0]!;
 if(row.requestId){
  const [request]=await db.select().from(paymentRequests)
   .where(eq(paymentRequests.requestId,row.requestId)).limit(1);
  if(!request||request.payerUserId!==row.ownerUserId||
    request.recipientWallet.toLowerCase()!==receipt.recipientAddress.toLowerCase()||
    request.amountRaw!==receipt.amountRaw||
    request.paymentRef.toLowerCase()!==receipt.paymentRef.toLowerCase()||
    receipt.paidAt.getTime()>request.expiresAt.getTime())return row;
 }
 const [updated]=await db.update(mainnetPayJourneys)
  .set({verifiedTxHash:receipt.txHash,verifiedAt:new Date(),updatedAt:new Date()})
  .where(and(eq(mainnetPayJourneys.journeyId,row.journeyId),
   isNull(mainnetPayJourneys.verifiedTxHash)))
  .returning();
 return updated??row;
}
export async function readOwnedPayJourney(db:DbClient,userId:string,ownerWallet:string){
 if(!USER.test(userId)||!isAddress(ownerWallet))return fail('INVALID_JOURNEY_OWNER',400);
 const rows=await db.select().from(mainnetPayJourneys).where(and(
  eq(mainnetPayJourneys.ownerUserId,userId),
  eq(mainnetPayJourneys.ownerWallet,getAddress(ownerWallet).toLowerCase()),
 )).orderBy(sql`created_at DESC`).limit(50);
 for(const row of rows){
  const latest=await reconcileServerReceipt(db,row);
  if(latest.verifiedTxHash===null)return visiblePayJourney(latest);
 }
 return null;
}
export async function lockOwnerPayJourney(
 db:DbClient,userId:string,payload:unknown,
){
 if(!USER.test(userId))return fail('AUTH_REQUIRED',401);
 const input=parsePayJourneyLock(payload);
 const owner=await mainnetActiveBinding(db,input.ownerWallet);
 if(owner?.userId!==userId)return fail('JOURNEY_WALLET_NOT_BOUND',403);
 const amountRaw=parseUnits(input.grossUsdc,6).toString();
 let ref=genericPayFundingRef(input.journeyId);
 if(input.requestId){
  const [request]=await db.select().from(paymentRequests)
   .where(eq(paymentRequests.requestId,input.requestId)).limit(1);
  if(!request||request.payerUserId!==userId||
     request.recipientWallet.toLowerCase()!==input.payeeWallet.toLowerCase()||
     request.amountRaw!==amountRaw||
     request.status!=='PENDING'||request.expiresAt.getTime()<=Date.now()||
     request.claimWallet&&request.claimWallet.toLowerCase()!==input.ownerWallet.toLowerCase())
   return fail('REQUEST_NOT_APPROVED_FOR_FUNDING',409);
  ref=paymentRequestRef(input.requestId);
  if(request.paymentRef.toLowerCase()!==ref.toLowerCase())
   return fail('REQUEST_REFERENCE_CHANGED',409);
 }
 const existing=await readOwnedPayJourney(db,userId,input.ownerWallet);
 if(existing?.status==='RESERVED'){
  // Read through the strong owner scope. Another device may inspect the old
  // journal but must not reserve a new operation.
  const [current]=await db.select().from(mainnetPayJourneys).where(and(
   eq(mainnetPayJourneys.journeyId,existing.journeyId),
   eq(mainnetPayJourneys.ownerUserId,userId))).limit(1);
  if(!current||!sameLockedJourney(current,input,userId,ref))
   return fail('ORIGINAL_PAYMENT_JOURNEY_UNRESOLVED',409);
  return visiblePayJourney(current);
 }
 // Partial unique indexes arbitrate two devices even when they race here.
 await db.insert(mainnetPayJourneys).values({
  journeyId:input.journeyId,gatewayOperationId:input.gatewayOperationId,
  ownerUserId:userId,ownerWallet:input.ownerWallet.toLowerCase(),
  payeeWallet:input.payeeWallet.toLowerCase(),amountRaw,paymentRef:ref.toLowerCase(),
  requestId:input.requestId??null,
 }).onConflictDoNothing();
 const [saved]=await db.select().from(mainnetPayJourneys).where(and(
  eq(mainnetPayJourneys.ownerUserId,userId),
  eq(mainnetPayJourneys.journeyId,input.journeyId))).limit(1);
 if(!saved||!sameLockedJourney(saved,input,userId,ref))
  return fail('ORIGINAL_PAYMENT_JOURNEY_UNRESOLVED',409);
 return visiblePayJourney(saved);
}
