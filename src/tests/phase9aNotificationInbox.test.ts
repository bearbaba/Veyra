import { describe,expect,it } from 'vitest';
import { readFileSync } from 'node:fs';
import { NotificationInboxError,assertNotificationId,parseNotificationPagination } from '../../server/services/notificationInboxService';

describe('owner-private Veyra notification inbox input gates', () => {
  it('bounds pages',()=>{
    expect(parseNotificationPagination(undefined,undefined)).toEqual({limit:20,offset:0});
    expect(parseNotificationPagination('50','1000')).toEqual({limit:50,offset:1000});
  });
  it.each([['0','0'],['51','0'],['20','1001'],['1','-1'],['01','0'],['5','1.5'],[['20'],'0'],['999999999999999999','0']])(
    'rejects pagination outside limits (%s,%s)',(a,b)=>{
      expect(()=>parseNotificationPagination(a,b)).toThrow(NotificationInboxError);
    });
  it('rejects non-canonical and arbitrary inbox references',()=>{
    expect(assertNotificationId('ntf_123456789ABCDEFGJ')).toBe('ntf_123456789ABCDEFGJ');
    for(const input of ['ntf_','usr_123456789ABCDEFGJ','ntf_0','ntf_script<script>','ntf_123\n','ntf_1'.repeat(220),null]) {
      expect(()=>assertNotificationId(input)).toThrow(NotificationInboxError);
    }
  });
  it('only exposes owner-scoped read and list; client cannot create payment notices',()=>{
    const bff=readFileSync(new URL('../../server/bff.ts',import.meta.url),'utf8');
    const svc=readFileSync(new URL('../../server/services/notificationInboxService.ts',import.meta.url),'utf8');
    const migration=readFileSync(new URL('../../server/db/migrations/0014_phase9a_owner_notifications.sql',import.meta.url),'utf8');
    expect(bff).toContain("app.get('/api/notifications', IDENTITY_RATE");
    expect(bff).toContain("app.post('/api/notifications/read', IDENTITY_RATE");
    expect(bff).not.toContain("app.post('/api/notifications/create'");
    expect(svc).toContain('eq(veyraNotifications.ownerUserId,ownerUserId)');
    expect(migration).toContain('CREATE TRIGGER trg_friend_notification');
    expect(migration).toContain("ELSIF NEW.status = 'CONNECTED' THEN");
    expect(migration).not.toContain('TG_OP = \'UPDATE\'');
  });
});
