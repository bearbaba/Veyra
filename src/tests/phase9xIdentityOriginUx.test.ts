import {afterEach,describe,expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {probeIdentityOrigin} from '../lib/api/identityOriginProbe';
import {SocialHttpError} from '../features/social/UnifiedSocial';

const file=(name:string)=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
const reply=(status:number,value:unknown,type='application/json'):Response=>({
  ok: status>=200&&status<300,status,
  headers:{get:(key:string)=>key.toLowerCase()==='content-type'?type:null},
  json:()=>Promise.resolve(value),
}) as Response;
afterEach(()=>vi.unstubAllGlobals());

describe('Veyra one-page wallet and origin acceptance',()=>{
  it('returns origin_blocked for the exact 403 recorded in the real browser video',async()=>{
    const mocked=vi.fn((_url:string,_options?:RequestInit)=>Promise.resolve(reply(403,{ok:false,error:'ORIGIN_NOT_ALLOWED'})));
    vi.stubGlobal('fetch',mocked);
    expect(await probeIdentityOrigin()).toBe('origin_blocked');
    expect(mocked).toHaveBeenCalledOnce();
    expect(mocked.mock.calls[0]?.[0]).toBe('/api/identity/register/complete');
    const init=mocked.mock.calls[0]?.[1];
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe('{}');
    expect(init?.credentials).toBe('same-origin');
    expect(init?.cache).toBe('no-store');
    expect(init?.headers).not.toHaveProperty('Authorization');
    expect(init?.signal).toBeDefined();
  });
  it('only accepts the BFF exact 400 INVALID_REQUEST after its Origin guard',async()=>{
    for(const response of [
      reply(400,{error:'INVALID_REQUEST'}), // preflight is an unsigned, deliberately incomplete request
    ]){
      vi.stubGlobal('fetch',vi.fn(()=>Promise.resolve(response)));
      expect(await probeIdentityOrigin()).toBe('ready');
    }
    for(const response of [
      reply(200,{ok:true}), // health success is NOT an identity Origin check
      reply(200,{},'text/html'), // SPA fallback
      reply(403,{error:'AUTH_REQUIRED'}),
      reply(503,{error:'INTERNAL_SERVER_ERROR'}),
      reply(400,{error:'UNKNOWN_REQUEST'}),
    ]){
      vi.stubGlobal('fetch',vi.fn(()=>Promise.resolve(response)));
      expect(await probeIdentityOrigin()).toBe('offline');
    }
  });
  it('rejects network errors without signing or navigating away',async()=>{
    vi.stubGlobal('fetch',vi.fn(()=>Promise.reject(new Error('offline'))));
    expect(await probeIdentityOrigin()).toBe('offline');
    const social=file('features/social/UnifiedSocial.tsx');
    expect(social).toContain("if(identityOrigin!=='ready')");
    expect(social).toContain("setIdentityOrigin('origin_blocked')");
    expect(social).toContain('probeIdentityOrigin()');
    expect(file('lib/api/identityOriginProbe.ts')).toContain('AbortSignal.timeout(30000)');
    expect(social).not.toContain('window.location.assign');
    const err=new SocialHttpError(403,'ORIGIN_NOT_ALLOWED');
    expect(err.message).toContain('Preview URL is not authorized');
  });
  it('reuses one inline Veyra ID entry in Settings and Social; X requires a live BFF capability',()=>{
    const entry=file('components/identity/VeyraIdentityAccess.tsx');
    const settings=file('components/pages/SettingsPage.tsx');
    const social=file('components/pages/SocialPage.tsx');
    expect(entry).toContain('<ConnectKitButton/>');
    expect(entry).toContain('social.identityOrigin');
    expect(entry).toContain('No signature was requested.');
    expect(entry).toContain('Sign in to Veyra ID');
    expect(entry).toContain('switchChainAsync({chainId:5042002})');
    expect(settings).toContain('<VeyraIdentityAccess/>');
    expect(social).toContain('<VeyraIdentityAccess/>');
    expect(settings).toContain('getXLinkCapability()');
    expect(settings).toContain("disabled={xCapability!=='available'");
    expect(file('lib/api/identityApi.ts')).toContain("'POST'");
    expect(file('lib/api/identityApi.ts')).toContain('AbortSignal.timeout(12000)');
    expect(settings).not.toContain("setXError('Sign in through Social");
    expect(entry).not.toContain('window.location');
    expect(entry).not.toContain('eth_sendTransaction');
  });
  it('does not call BFF online when identity API is origin-denied',()=>{
    const banner=file('components/system/WebPreviewBanner.tsx');
    const runtime=file('components/system/RuntimeStatusCard.tsx');
    expect(banner).toContain("social.identityOrigin === 'origin_blocked'");
    expect(banner).toContain('Veyra ID blocked on this Preview');
    expect(banner).not.toContain("'BFF online'");
    expect(runtime).toContain('Backend rejected this Preview origin (403)');
  });
});
