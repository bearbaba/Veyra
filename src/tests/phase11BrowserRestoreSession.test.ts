import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {issueBrowserRestoreCookie,verifyBrowserRestoreCookie,clearBrowserRestoreCookie} from '../../server/auth/browserRestoreSession';
const read=(path:string)=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const secret='x'.repeat(64);
const a='0x1111111111111111111111111111111111111111',b='0x2222222222222222222222222222222222222222';
const origin='https://veyra-unified-testnet.vercel.app',other='https://veyra-identity-friends-beta.vercel.app';
const user='usr_11111111111111111111';
const now=1793021800000;
describe('Secure browser restored identity after F5',()=>{
  it('issues a HttpOnly 12h cookie, separate from a bearer token',()=>{
    const cookie=issueBrowserRestoreCookie(user,a,origin,secret,now);
    expect(cookie).toContain('HttpOnly; Secure; SameSite=Strict; Max-Age=43200');
    expect(cookie).toContain('Path=/api/auth');
    expect(cookie).not.toContain(secret);
    expect(cookie).not.toContain(user);
    expect(verifyBrowserRestoreCookie(cookie,secret,origin,a,now+1000)?.sub).toBe(user);
  });
  it('rejects other wallet, origin, tampering and expired cookies',()=>{
    const cookie=issueBrowserRestoreCookie(user,a,origin,secret,now);
    expect(verifyBrowserRestoreCookie(cookie,secret,origin,b,now+1000)).toBeNull();
    expect(verifyBrowserRestoreCookie(cookie,secret,other,a,now+1000)).toBeNull();
    expect(verifyBrowserRestoreCookie(cookie,secret,origin,a,now+43200001)).toBeNull();
    expect(verifyBrowserRestoreCookie(cookie.replace(/[a-zA-Z]/,'q'),secret,origin,a,now+1000)).toBeNull();
    expect(verifyBrowserRestoreCookie('',secret,origin,a,now+1000)).toBeNull();
    expect(clearBrowserRestoreCookie()).toContain('Max-Age=0');
  });
  it('only restores against active DB wallet bindings, never trusts a stored handle',()=>{
    const bff=readFileSync(new URL('../../server/bff.ts',import.meta.url),'utf8');
    const social=read('features/social/UnifiedSocial.tsx');
    const api=read('lib/api/liveIdentitySession.ts');
    const home=read('components/pages/HomePage.tsx');
    expect(bff).toContain("app.post('/api/auth/session/restore'");
    expect(bff).toContain("wb.status='ACTIVE'");
    expect(bff).toContain('wb.revoked_at IS NULL');
    expect(bff).toContain("u.status='ACTIVE'");
    expect(bff).toContain("res.setHeader('Set-Cookie',clearBrowserRestoreCookie())");
    expect(social).toContain("'/api/auth/session/restore','POST',undefined,{walletAddress:address}");
    expect(social).toContain('if(!isConnected||!address||!connector');
    expect(social).toContain('const signOut=useCallback');
    expect(social).toContain("'/api/auth/session/logout'");
    expect(api).not.toContain('localStorage');
    expect(home).toContain('Sign-in required');
  });
  it('suppresses cookie restore during explicit logout and uses one awaited request',()=>{
    const social=read('features/social/UnifiedSocial.tsx');
    const settings=read('components/pages/SettingsPage.tsx');
    const friends=read('components/pages/SocialPage.tsx');
    expect(social).toContain('restoreSuppressedFor.current=current.current');
    expect(social).toContain('restoreSuppressedFor.current===walletKey');
    expect(social).toContain("await api('/api/auth/session/logout','POST')");
    expect(social).not.toContain("void api('/api/auth/session/logout','POST').catch");
    expect(settings).toContain('const serverLogout=await social.signOut()');
    expect(settings).not.toContain("fetch('/api/auth/session/logout'");
    expect(friends).toContain('onClick={()=>void social.signOut()}');
  });
  it('keeps only exact reviewed API rewrites',()=>{
    const stage=readFileSync(new URL('../../scripts/stagingBffAllowlist.ts',import.meta.url),'utf8');
    const vercel=JSON.parse(readFileSync(new URL('../../vercel.json',import.meta.url),'utf8')) as {rewrites:{source:string}[]};
    for(const path of ['/api/auth/session/restore','/api/auth/session/logout']){
      expect(stage).toContain('"'+path+'"');
      expect(vercel.rewrites.filter(x=>x.source===path)).toHaveLength(1);
    }
  });
});
