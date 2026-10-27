import {afterEach,describe,expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {
  activeSignedIdentityToken,bindCurrentIdentityWallet,
  clearSignedIdentitySession,setSignedIdentitySession,
} from '../lib/api/liveIdentitySession';
import {loadActivityReceiptsRemote} from '../lib/api/activityReceiptApi';

const read=(p:string)=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
afterEach(()=>{clearSignedIdentitySession();bindCurrentIdentityWallet('');vi.unstubAllGlobals();});

describe('one signed Veyra wallet session across Settings, Activity, Bridge and Pay',()=>{
  it('never reuses a different wallet, network or connector session',()=>{
    bindCurrentIdentityWallet('0xa:5042002:metamask');
    setSignedIdentitySession('valid-token-A','0xa:5042002:metamask');
    expect(activeSignedIdentityToken()).toBe('valid-token-A');
    bindCurrentIdentityWallet('0xb:5042002:metamask');
    expect(activeSignedIdentityToken()).toBeNull();
    expect(()=>setSignedIdentitySession('old-valid-token-A','0xa:5042002:metamask')).toThrow();
    setSignedIdentitySession('valid-token-B','0xb:5042002:metamask');
    bindCurrentIdentityWallet('0xb:5042:metamask');
    expect(activeSignedIdentityToken()).toBeNull();
    bindCurrentIdentityWallet('0xb:5042002:rabby');
    expect(activeSignedIdentityToken()).toBeNull();
  });
  it('revokes bearer on logout',()=>{
    bindCurrentIdentityWallet('0xa:5042002:metamask');
    setSignedIdentitySession('valid-token-A','0xa:5042002:metamask');
    clearSignedIdentitySession();
    expect(activeSignedIdentityToken()).toBeNull();
  });
  it('loads durable Activity under this signed wallet, not browser storage',async()=>{
    bindCurrentIdentityWallet('0xa:5042002:metamask');
    setSignedIdentitySession('valid-token-A','0xa:5042002:metamask');
    const fake=vi.fn((_url:string,_options?:RequestInit)=>Promise.resolve({
      ok:true,status:200,json:()=>Promise.resolve({receipts:[]}),
    }));
    vi.stubGlobal('fetch',fake);
    vi.stubGlobal('sessionStorage',{getItem:()=>{throw new Error('Must not read old storage');}});
    expect(await loadActivityReceiptsRemote()).toEqual([]);
    expect(fake.mock.calls[0]?.[1]?.headers).toEqual({Authorization:'Bearer valid-token-A'});
    clearSignedIdentitySession();
    expect(await loadActivityReceiptsRemote()).toEqual([]);
    expect(fake).toHaveBeenCalledTimes(1);
  });
  it('removes duplicate Settings ID registration and binds API requests to signed Social',()=>{
    const social=read('features/social/UnifiedSocial.tsx');
    const settings=read('components/pages/SettingsPage.tsx');
    const identity=read('hooks/useVeyraIdentity.ts');
    const bridge=read('lib/api/bridgeRecoveryApi.ts');
    const api=read('lib/api/identityApi.ts');
    expect(social).toContain('bindCurrentIdentityWallet(walletKey)');
    expect(social).toContain('setSignedIdentitySession(data.sessionToken,key)');
    expect(identity).toContain('social.session?.profile');
    expect(settings).toContain('onOpenSocial');
    expect(settings).not.toContain('CreateVeyraIdModal');
    expect(bridge).toContain('activeSignedIdentityToken()');
    expect(api).toContain('activeSignedIdentityToken()');
    expect(api).not.toContain("sessionStorage.getItem('veyra:session-token')");
  });
});
