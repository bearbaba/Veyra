/**
 * Server-encrypted, wallet-session-bound messages for CONNECTED friends only.
 * Not E2EE: the BFF can decrypt. Never insert untrusted HTML or cryptocurrency
 * transfer claims into notifications. A message never authorizes a payment.
 */
import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {and,desc,eq,or} from 'drizzle-orm';
import type {DbClient} from '../db/client.js';
import {directMessages} from '../db/schema/directMessages.js';
import {veyraNotifications} from '../db/schema/notifications.js';
import {getConnectionStatus} from '../db/repositories/socialRepository.js';
import {newDirectMessageId,newNotificationId} from '../db/ids.js';

const USER=/^usr_[1-9A-HJ-NP-Za-km-z]{10,}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export class DirectMessageError extends Error{
  constructor(public readonly code:string,message:string,public readonly httpStatus=400){
    super(message);this.name='DirectMessageError';
  }
}
export function encryptionKey():Buffer|null{
  const value=process.env.VEYRA_CHAT_ENCRYPTION_KEY;
  return typeof value==='string'&&/^[0-9a-f]{64}$/i.test(value)?Buffer.from(value,'hex'):null;
}
function requireKey():Buffer{
  const key=encryptionKey();
  if(!key)throw new DirectMessageError('CHAT_NOT_CONFIGURED','Secure messages are not available yet.',503);
  return key;
}
export function encryptMessage(text:string,sender:string,recipient:string,id:string,key:Buffer){
  if(key.byteLength!==32)throw new DirectMessageError('CHAT_KEY_INVALID','Encryption key must be 32 bytes.',503);
  const iv=randomBytes(12);
  const cipher=createCipheriv('aes-256-gcm',key,iv);
  cipher.setAAD(Buffer.from([id,sender,recipient].join(':')));
  const ciphertext=Buffer.concat([cipher.update(text,'utf8'),cipher.final()]).toString('base64');
  return {ciphertext,iv:iv.toString('base64'),authTag:cipher.getAuthTag().toString('base64')};
}
export function decryptMessage(row:{messageId:string;senderUserId:string;recipientUserId:string;ciphertext:string;iv:string;authTag:string},key:Buffer){
  const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(row.iv,'base64'));
  decipher.setAAD(Buffer.from([row.messageId,row.senderUserId,row.recipientUserId].join(':')));
  decipher.setAuthTag(Buffer.from(row.authTag,'base64'));
  return Buffer.concat([decipher.update(Buffer.from(row.ciphertext,'base64')),decipher.final()]).toString('utf8');
}
function validPeer(owner:string,peer:unknown):asserts peer is string{
  if(typeof peer!=='string'||!USER.test(peer)||peer===owner)
    throw new DirectMessageError('INVALID_CHAT_PEER','Select a different verified Veyra friend.');
}
async function requireFriend(db:DbClient,owner:string,peer:string){
  if(await getConnectionStatus(db,owner,peer)!=='CONNECTED')
    throw new DirectMessageError('CHAT_FRIEND_REQUIRED','Only connected, unblocked friends can exchange messages.',403);
}
function bodyText(text:unknown):string{
  if(typeof text!=='string')throw new DirectMessageError('INVALID_MESSAGE','Enter a text message.');
  const value=text.trim();
  if(value.length===0||value.length>1000||Buffer.byteLength(value,'utf8')>3000||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))
    throw new DirectMessageError('INVALID_MESSAGE','Use 1–1000 visible characters; control characters are not allowed.');
  return value;
}
export function chatPage(limit:unknown,offset:unknown){
  const parse=(value:unknown,defaultValue:number)=>{
    if(value===undefined)return defaultValue;
    if(typeof value!=='string'||!/^(0|[1-9][0-9]*)$/.test(value))throw new DirectMessageError('INVALID_CHAT_PAGE','Invalid message page.');
    return Number(value);
  };
  const take=parse(limit,40),skip=parse(offset,0);
  if(!Number.isSafeInteger(take)||take<1||take>50||!Number.isSafeInteger(skip)||skip>500)
    throw new DirectMessageError('INVALID_CHAT_PAGE','Invalid message page.');
  return {limit:take,offset:skip};
}
export async function sendDirectMessage(db:DbClient,owner:string,peer:unknown,input:unknown,requestId:unknown){
  validPeer(owner,peer);
  const text=bodyText(input),key=requireKey();
  if(typeof requestId!=='string'||!UUID.test(requestId))
    throw new DirectMessageError('INVALID_MESSAGE_REQUEST','Valid client request ID required.');
  await requireFriend(db,owner,peer);
  const messageId=newDirectMessageId();
  const encrypted=encryptMessage(text,owner,peer,messageId,key);
  // A duplicate request reuses the same stored ID, preventing retry spam.
  const result=await db.transaction(async tx=>{
    const inserted=await tx.insert(directMessages).values({
      messageId,senderUserId:owner,recipientUserId:peer,clientRequestId:requestId,...encrypted,
    }).onConflictDoNothing({target:[directMessages.senderUserId,directMessages.clientRequestId]})
      .returning({messageId:directMessages.messageId});
    if(inserted.length){
      await tx.insert(veyraNotifications).values({
        notificationId:newNotificationId(),ownerUserId:peer,actorUserId:owner,kind:'MESSAGE',eventRef:messageId,
      });
      return {messageId,created:true};
    }
    const [previous]=await tx.select({messageId:directMessages.messageId,recipientUserId:directMessages.recipientUserId})
      .from(directMessages).where(and(eq(directMessages.senderUserId,owner),eq(directMessages.clientRequestId,requestId))).limit(1);
    if(!previous||previous.recipientUserId!==peer)
      throw new DirectMessageError('MESSAGE_REQUEST_CONFLICT','Message request ID belongs to a different conversation.',409);
    return {messageId:previous.messageId,created:false};
  });
  return {ok:true,...result};
}
export async function listDirectMessages(db:DbClient,owner:string,peer:unknown,page:{limit:number;offset:number}){
  validPeer(owner,peer);
  const key=requireKey();
  await requireFriend(db,owner,peer);
  const items=await db.select().from(directMessages)
    .where(or(and(eq(directMessages.senderUserId,owner),eq(directMessages.recipientUserId,peer)),
              and(eq(directMessages.senderUserId,peer),eq(directMessages.recipientUserId,owner))))
    .orderBy(desc(directMessages.createdAt),desc(directMessages.messageId))
    .limit(page.limit+1).offset(page.offset);
  return {ok:true,items:items.slice(0,page.limit).map(row=>({
    messageId:row.messageId,senderUserId:row.senderUserId,recipientUserId:row.recipientUserId,
    body:decryptMessage(row,key),createdAt:row.createdAt.toISOString(),
  })).reverse(),hasMore:items.length>page.limit,nextOffset:items.length>page.limit?page.offset+page.limit:null};
}
