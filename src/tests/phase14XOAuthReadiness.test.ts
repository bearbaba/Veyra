import {afterEach,describe,expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {getXLinkCapability} from '../lib/api/identityApi';
import {checkedXReturnOrigin,buildXLinkedReturnUrl,isConfiguredXOAuth} from '../../server/services/xOAuthService';

const read=(p:string)=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
const reply=(status:number,payload:unknown,type='application/json'):Response=>({
  ok:status>=200&&status<300,status,
  headers:{get:(key:string)=>key.toLowerCase()==='content-type'?type:null},
  json:()=>Promise.resolve(payload),
}) as Response;

afterEach(()=>vi.unstubAllGlobals());
describe('Phase 14 — X linking is opt-in, state-bound, and never creates another Veyra ID',()=>{
  it('keeps X disabled unless the exact BFF signals provider readiness',async()=>{
    const fetch=vi.fn(()=>Promise.resolve(reply(200,{ok:true,available:true})));
    vi.stubGlobal('fetch',fetch);
    expect(await getXLinkCapability()).toBe(true);
    expect(fetch).toHaveBeenCalledOnce();
    const [url,request]=fetch.mock.calls[0] as unknown as [string,RequestInit];
    expect(url).toBe('/api/auth/x/capability');
    expect(request.method).toBe('POST');
    expect(request.body).toBe('{}');
    expect(request.credentials).toBe('same-origin');
    expect(request.signal).toBeDefined();
  });
  it('never trusts stale backends, HTML fallbacks, 403, 503 or unverified JSON',async()=>{
    for(const response of [
      reply(404,{ok:false,error:'NOT_FOUND'}),reply(503,{ok:false,error:'UNAVAILABLE'}),
      reply(403,{ok:false,error:'ORIGIN_NOT_ALLOWED'}),reply(200,{available:true}),
      reply(200,{ok:true,available:'true'}),reply(200,{ok:true},'text/html'),
    ]){
      vi.stubGlobal('fetch',vi.fn(()=>Promise.resolve(response)));
      expect(await getXLinkCapability()).toBe(false);
    }
    vi.stubGlobal('fetch',vi.fn(()=>Promise.reject(new Error('Network blocked'))));
    expect(await getXLinkCapability()).toBe(false);
  });
  it('binds the OAuth callback to exactly one previously approved Testnet origin',()=>{
    const primary='https://veyra-unified-testnet.vercel.app';
    const v2='https://veyra-unified-testnet-v2.vercel.app';
    expect(checkedXReturnOrigin(v2,[primary,v2])).toBe(v2);
    expect(buildXLinkedReturnUrl(v2,[primary,v2])).toBe(v2+'/?x_linked=1');
    expect(()=>buildXLinkedReturnUrl('https://evil.example',[primary,v2])).toThrow();
    expect(isConfiguredXOAuth('id','https://evil.example/callback')).toBe(false);
    const bff=read('server/bff.ts');
    const service=read('server/services/xOAuthService.ts');
    const schema=read('server/db/schema/oauth.ts');
    const migration=read('server/db/migrations/0015_phase14_x_oauth_origin.sql');
    expect(bff).toContain("const appOrigin=checkedXReturnOrigin(req.header('origin')");
    expect(bff).toContain('buildXLinkedReturnUrl(completed.appOrigin');
    expect(service).toContain('appOrigin: input.appOrigin');
    expect(service).toContain('if(!candidate.appOrigin)');
    expect(schema).toContain("appOrigin: text('app_origin')");
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS "app_origin" text');
    expect(bff).not.toContain('const target = new URL(completed.returnPath, appOrigin)');
  });
  it('does not expose secrets or redirect the callback through a wildcard Vercel rewrite',()=>{
    const allowlist=read('scripts/stagingBffAllowlist.ts');
    const config=JSON.parse(read('vercel.json')) as {rewrites:{source:string,destination:string}[]};
    const sources=config.rewrites.map(x=>x.source);
    expect(sources).toContain('/api/auth/x/capability');
    expect(sources).toContain('/api/auth/x/start');
    expect(sources).not.toContain('/api/auth/x/callback');
    expect(sources).not.toContain('/api/:path*');
    expect(allowlist).toContain('STAGING_BFF_ORIGIN');
    expect(read('src/components/pages/SettingsPage.tsx')).toContain("disabled={xCapability!=='available'");
    expect(read('src/App.tsx')).toContain("searchParams.get('x_linked')"); // guarded UI navigation only
    expect(read('server/services/xOAuthService.ts')).toContain('signal:AbortSignal.timeout(PROVIDER_TIMEOUT_MS)');
  });
});
