import {afterEach,describe,expect,it} from 'vitest';
import {randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {
  DirectMessageError,chatPage,decryptMessage,encryptionKey,encryptMessage,
} from '../../server/services/directMessageService';
const file=(path:string)=>readFileSync(new URL('../../'+path,import.meta.url),'utf8');
const before=process.env.VEYRA_CHAT_ENCRYPTION_KEY;
afterEach(()=>{
  if(before===undefined)delete process.env.VEYRA_CHAT_ENCRYPTION_KEY;
  else process.env.VEYRA_CHAT_ENCRYPTION_KEY=before;
});
describe('Phase 16: real friend Chat with encrypted storage, never fake E2EE',()=>{
  it('requires exactly one 256-bit server encryption key; missing or weak key disables Chat',()=>{
    delete process.env.VEYRA_CHAT_ENCRYPTION_KEY;
    expect(encryptionKey()).toBeNull();
    process.env.VEYRA_CHAT_ENCRYPTION_KEY='hello-world';
    expect(encryptionKey()).toBeNull();
    process.env.VEYRA_CHAT_ENCRYPTION_KEY=randomBytes(32).toString('hex');
    expect(encryptionKey()).toHaveLength(32);
  });
  it('authenticates the ciphertext to the message ID and both participants',()=>{
    const key=randomBytes(32),id='msg_someuniqueidentity123';
    const sender='usr_senderId12345678',recipient='usr_recipientId12345678';
    const plaintext='Private from one friend to another. This is not E2EE.';
    const encrypted=encryptMessage(plaintext,sender,recipient,id,key);
    expect(JSON.stringify(encrypted)).not.toContain(plaintext);
    const row={messageId:id,senderUserId:sender,recipientUserId:recipient,...encrypted};
    expect(decryptMessage(row,key)).toBe(plaintext);
    expect(()=>decryptMessage({...row,recipientUserId:'usr_modifiedaccount12345'},key)).toThrow();
    expect(()=>decryptMessage({...row,messageId:'msg_forgedID'},key)).toThrow();
    expect(()=>decryptMessage({...row,authTag:Buffer.alloc(16).toString('base64')},key)).toThrow();
    expect(()=>decryptMessage(row,randomBytes(32))).toThrow();
  });
  it('bounds pagination and never permits unlimited history extraction',()=>{
    expect(chatPage(undefined,undefined)).toEqual({limit:40,offset:0});
    expect(chatPage('50','500')).toEqual({limit:50,offset:500});
    for(const p of [['0','0'],['51','0'],['1','501'],['-1','0'],['2','9.4'],['2','NaN']]){
      expect(()=>chatPage(p[0],p[1])).toThrow(DirectMessageError);
    }
  });
  it('enforces explicit user auth, friendship and block status for each read and write',()=>{
    const bff=file('server/bff.ts'),svc=file('server/services/directMessageService.ts');
    const sql=file('server/db/migrations/0016_phase16_direct_messages.sql');
    const src=file('src/features/social/FriendChat.tsx');
    expect(bff).toContain("app.get('/api/social/chat'");
    expect(bff).toContain("app.post('/api/social/chat/send'");
    expect(bff).toContain('getAuthenticatedVeyraUserId(req)');
    expect(svc).toContain("getConnectionStatus(db,owner,peer)!=='CONNECTED'");
    expect(svc).toContain('await requireFriend(db,owner,peer);');
    expect(svc).toContain("onConflictDoNothing({target:[directMessages.senderUserId,directMessages.clientRequestId]})");
    expect(svc).toContain("kind:'MESSAGE'");
    expect(svc).toContain("decryptMessage(previous,key)!==text");
    expect(svc).toContain("'MESSAGE_REQUEST_CONFLICT'");
    const ci=file('scripts/ci-hosted-social-http.ts');
    expect(ci).toContain('outgoingChat.data.created,true');
    expect(ci).toContain('bobAfterChat.data.unreadCount,1');
    expect(ci).toContain('ciphertext,iv,auth_tag FROM veyra_direct_messages');
    expect(ci).toContain('Block must immediately revoke reading existing Chat history');
    expect(sql).toContain('UNIQUE(sender_user_id, client_request_id)');
    expect(sql).not.toContain('body_plaintext');
    expect(src).toContain('not end-to-end');
    expect(src).toContain('crypto.randomUUID()');
    expect(src).toContain('Only accepted friends can see this conversation.');
    expect(src).not.toContain('eth_sendTransaction');
  });
  it('chat capability is false when the server has no key, and never claims E2EE',()=>{
    const bff=file('server/bff.ts'),page=file('src/components/pages/SocialPage.tsx');
    expect(bff).toContain('available:Boolean(encryptionKey()),endToEndEncrypted:false');
    expect(page).toContain('setChatEnabled(false)');
    expect(page).toContain('response.ok');
    expect(page).toContain('/api/social/chat/capability');
  });
});
