import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {
  actionableFriendRequest,notificationActorName,notificationDescription,notificationTitle,
} from '../features/social/notificationPresentation';
import type {SocialFriend,SocialNotice} from '../features/social/UnifiedSocial';
const read=(path:string)=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const alice:SocialFriend={veyraUserId:'usr_123456789ABCDEFGJ',veyraHandle:'alice',state:'INCOMING_PENDING',updatedAt:''};
const bob:SocialFriend={veyraUserId:'usr_2222222222222222',veyraHandle:'bob',state:'CONNECTED',updatedAt:''};
const notice=(kind:string,actorUserId:string|null):SocialNotice=>({
  notificationId:'ntf_123456789ABCDEFGJ',kind,actorUserId,createdAt:'2026-10-27T00:00:00Z',readAt:null,
});
describe('Phase 13 owner-only Friends and real event presentation',()=>{
  it('only offers acceptance for a real pending incoming request, never for message or payment notifications',()=>{
    expect(actionableFriendRequest(notice('FRIEND_REQUEST',alice.veyraUserId),[alice,bob])).toEqual(alice);
    expect(actionableFriendRequest(notice('FRIEND_REQUEST',bob.veyraUserId),[alice,bob])).toBeNull();
    expect(actionableFriendRequest(notice('PAYMENT_RECEIVED',alice.veyraUserId),[alice,bob])).toBeNull();
    expect(actionableFriendRequest(notice('FRIEND_REQUEST',null),[alice,bob])).toBeNull();
  });
  it('uses server-provided friend identity only, does not invent an unverified display name',()=>{
    expect(notificationActorName(notice('FRIEND_REQUEST',alice.veyraUserId),[alice])).toBe('@alice.veyra');
    expect(notificationActorName(notice('SECURITY','usr_3333333333333333'),[alice])).toBeNull();
  });
  it('distinguishes incoming payment, security, and chat notices without claiming receipt verification on the client',()=>{
    expect(notificationTitle('PAYMENT_RECEIVED')).toBe('Payment received');
    expect(notificationTitle('SECURITY')).toBe('Security alert');
    expect(notificationTitle('MESSAGE')).toBe('New private message');
    expect(notificationDescription('PAYMENT_RECEIVED')).toContain('backend');
    expect(notificationTitle('UNKNOWN_EVENT')).toBe('Account activity');
    const schema=read('../server/db/schema/notifications.ts');
    expect(schema).toContain("'PAYMENT_RECEIVED'");
    const server=read('../server/bff.ts');
    expect(server).not.toContain("app.post('/api/notifications/create'");
  });
  it('paginates authenticated friends without reusing old wallet data or relaxing verified Pay',()=>{
    const social=read('features/social/UnifiedSocial.tsx');
    const page=read('components/pages/SocialPage.tsx');
    const pay=read('components/pages/PayPage.tsx');
    expect(social).toContain('friendRefreshEpoch.current++');
    expect(social).toContain("'/api/social/friends?limit=20&offset='+offset");
    expect(social).toContain('request!==friendRefreshEpoch.current');
    expect(social).toContain('page.nextOffset<=offset');
    expect(page).toContain('Load more friends');
    expect(page).toContain('Accept friend');
    expect(page).toContain('Pending invitations appear under Requests');
    expect(pay).toContain('preparePaymentRecipient(recipient, ARC_TESTNET_CHAIN_ID, sessionToken!)');
    expect(page).toContain('Search loaded friends');
    expect(page).toContain('Wants to connect');
    expect(pay).toContain('changeAmount(value)');
    expect(pay).toContain('social.loadMoreFriends()');
    expect(pay).toContain('More friends');
    expect(pay).toContain('prepareEpoch.current += 1');
    expect(pay).toContain('[address, sessionToken, chainId]');
    expect(page).toContain("const invited=friend.trim()");
    expect(page).toContain("if(ok)setFriend");
    expect(page).toContain("if(await social.respond(id,'ACCEPT'))await social.markRead(notificationId)");
    expect(page).toContain("social.loadMoreNotices()");
    expect(page).toContain('No unread events in loaded history.');
    expect(social).toContain("'/api/notifications?limit=20&offset='+offset");
    expect(social).toContain("page.nextOffset<=offset");
    expect(social).toContain('noticePageTicket.current===ticket');
    expect(social).toContain('return action(async(key,rev)=>');
    expect(social).toContain('accepted=unchanged(key,rev)');
    expect(social).toContain('Friend invitation sent.');
    expect(social).toContain('Friend request accepted.');
    expect(social).toContain('Friend request declined.');
    const bell=read('features/social/NotificationBell.tsx');
    expect(bell).toContain("if(await social.respond(id,'ACCEPT'))await social.markRead(notificationId)");
    const settings=read('components/pages/SettingsPage.tsx');
    expect(settings).toContain('approvedXAvatar');
    expect(settings).toContain('referrerPolicy="no-referrer"');
  });
});
