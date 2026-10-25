import {afterEach,describe,expect,it,vi} from 'vitest';
import {rememberVerifiedVeyraId,readLastVerifiedVeyraId} from '../lib/api/lastVerifiedVeyraId';
import {readFileSync} from 'node:fs';

const A='0x1111111111111111111111111111111111111111';
const B='0x2222222222222222222222222222222222222222';
const entries=new Map<string,string>();
afterEach(()=>{entries.clear();vi.unstubAllGlobals();vi.useRealTimers();});
function installStorage(){
  vi.stubGlobal('localStorage',{
    getItem:(key:string)=>entries.get(key)??null,
    setItem:(key:string,value:string)=>{entries.set(key,value);},
  });
}
describe('Veyra public display hint after one verified wallet sign-in',()=>{
  it('remembers only a public wallet-scoped handle, never a bearer or signing right',()=>{
    installStorage();vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-25T00:00:00Z'));
    rememberVerifiedVeyraId(A,'Gau123');
    expect(readLastVerifiedVeyraId(A)).toBe('gau123');
    expect(readLastVerifiedVeyraId(B)).toBeNull();
    const saved=Array.from(entries.values()).join('');
    expect(saved).not.toContain('sessionToken');
    expect(saved).not.toContain('signature');
    expect(saved).not.toContain('veyraUserId');
    expect(saved).toContain('gau123');
  });
  it('fails closed for expired, malformed, or other-wallet data',()=>{
    installStorage();vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-25T00:00:00Z'));
    rememberVerifiedVeyraId(A,'gau123');
    vi.setSystemTime(new Date('2026-12-25T00:00:00Z'));
    expect(readLastVerifiedVeyraId(A)).toBeNull();
    for(const key of entries.keys())entries.set(key,'{tampered');
    expect(readLastVerifiedVeyraId(A)).toBeNull();
  });
  it('keeps private authorization on the real verified Social session',()=>{
    const file=(p:string)=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
    const identity=file('hooks/useVeyraIdentity.ts');
    const social=file('features/social/UnifiedSocial.tsx');
    const access=file('components/identity/VeyraIdentityAccess.tsx');
    const pay=file('components/pages/PayPage.tsx');
    expect(identity).toContain('lastUsedHandle');
    expect(identity).toContain('social.session?.profile');
    expect(social).toContain('rememberVerifiedVeyraId(w.account,profile.veyraHandle)');
    expect(access).toContain('Sign-in required');
    expect(access).toContain('one identity signature is still required');
    expect(pay).toContain('!sessionToken');
    expect(file('components/pages/SettingsPage.tsx')).toContain('ready={Boolean(profile)}');
  });
});
