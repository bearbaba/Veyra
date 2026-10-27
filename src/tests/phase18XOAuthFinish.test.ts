import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { assertXPendingLinkOwner, hashOAuthState } from '../../server/services/xOAuthService';

const read=(p:string)=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
const owner='usr_original', origin='https://veyra-unified-testnet-v2.vercel.app';
const valid=()=>({
  veyraUserId:owner,appOrigin:origin,consumedAt:new Date(),linkedAt:null,
  expiresAt:new Date(Date.now()+120000),pendingProfile:{xAccountId:'123456',xHandle:'example'},
});

describe('Phase 18 — signed, same-browser X link confirmation',()=>{
  it('accepts only the initiating owner, origin and unexpired pending provider proof',()=>{
    expect(()=>assertXPendingLinkOwner(valid(),owner,origin)).not.toThrow();
    expect(()=>assertXPendingLinkOwner(valid(),'usr_other',origin)).toThrow();
    expect(()=>assertXPendingLinkOwner(valid(),owner,'https://evil.example')).toThrow();
    expect(()=>assertXPendingLinkOwner({...valid(),consumedAt:null},owner,origin)).toThrow();
    expect(()=>assertXPendingLinkOwner({...valid(),linkedAt:new Date()},owner,origin)).toThrow();
    expect(()=>assertXPendingLinkOwner({...valid(),pendingProfile:null},owner,origin)).toThrow();
    expect(()=>assertXPendingLinkOwner({...valid(),expiresAt:new Date(0)},owner,origin)).toThrow();
  });
  it('never stores the raw OAuth state and finishes only with a signed ID session',()=>{
    expect(hashOAuthState('mock-secret')).not.toContain('mock-secret');
    const svc=read('server/services/xOAuthService.ts'),bff=read('server/bff.ts');
    expect(svc).not.toContain('await linkXIdentityFromOAuth(db, row.veyraUserId, xProfile)');
    expect(svc).toContain('pendingProfile: xProfile');
    expect(svc).toContain('eq(oauthLinkStates.veyraUserId, input.veyraUserId)');
    expect(svc).toContain('eq(oauthLinkStates.appOrigin, input.appOrigin)');
    expect(svc).toContain('isNotNull(oauthLinkStates.consumedAt)');
    expect(bff).toContain("app.post('/api/auth/x/finish'");
    expect(bff).toContain('getAuthenticatedVeyraUserId(req)');
    expect(read('src/components/pages/SettingsPage.tsx')).toContain('window.sessionStorage.setItem(X_PENDING_KEY');
    expect(read('src/lib/api/identityApi.ts')).toContain("'/api/auth/x/finish'");
    expect(read('server/db/migrations/0018_phase18_x_oauth_confirmation.sql')).toContain('ADD COLUMN IF NOT EXISTS "pending_profile"');
  });
  it('forwards only exact approved routes, never the provider callback',()=>{
    const routes=JSON.parse(read('vercel.json')).rewrites.map((x:{source:string})=>x.source);
    expect(routes).toContain('/api/auth/x/finish');
    expect(routes).not.toContain('/api/auth/x/callback');
    expect(read('scripts/stagingBffAllowlist.ts')).toContain('"/api/auth/x/finish"');
  });
});
