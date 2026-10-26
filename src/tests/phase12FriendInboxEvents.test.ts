import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {newNotificationId} from '../../server/db/ids';
const repo=readFileSync(new URL('../../server/db/repositories/socialRepository.ts',import.meta.url),'utf8');
const routes=readFileSync(new URL('../../server/bff.ts',import.meta.url),'utf8');
describe('Server-owned friendship notifications',()=>{
 it('generates ids accepted by owner notification inbox',()=>{
  expect(newNotificationId()).toMatch(/^ntf_[1-9A-HJ-NP-Za-km-z]{10,}$/);
  expect(newNotificationId()).not.toBe(newNotificationId());
 });
 it('persists genuine invite and acceptance events in the same transaction as friendship change',()=>{
  expect(repo).toContain('await db.transaction(async tx=>{');
  expect(repo).toContain("kind:'FRIEND_REQUEST',eventRef:connectionId");
  expect(repo).toContain("kind:'FRIEND_ACCEPTED',eventRef:connectionId");
  expect(repo).toContain('ownerUserId:targetUserId');
  expect(repo).toContain('ownerUserId:pending.initiatorUserId');
  expect(repo).toContain('actorUserId:acceptorUserId');
 });
 it('does not let the browser fabricate notification events or money receipts',()=>{
  expect(routes).toContain("app.get('/api/notifications'");
  expect(routes).toContain("app.post('/api/notifications/read'");
  expect(routes).not.toContain("app.post('/api/notifications/create'");
  expect(repo).not.toContain("kind:'PAYMENT_RECEIVED'");
 });
});
