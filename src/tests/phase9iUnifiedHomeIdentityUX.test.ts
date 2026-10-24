import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
const read=(p:string)=>readFileSync(new URL('../'+p,import.meta.url),'utf8');

describe('unified home uses the signed owner ID and honest backend status',()=>{
  it('does not offer a second registration path for a wallet already registered in Identity Beta',()=>{
    const home=read('components/pages/HomePage.tsx');
    expect(home).toContain('useUnifiedSocial()');
    expect(home).toContain('social.signIn()');
    expect(home).toContain('Sign in to Veyra ID');
    expect(home).toContain('social.ready');
    expect(home).toContain("onNavigate('social')");
    expect(home).not.toContain('CreateVeyraIdModal');
    expect(home).not.toContain('Create Veyra ID');
    expect(home).not.toContain('No Veyra ID yet');
    expect(home).toContain('Not signed in');
    expect(home).toContain('.veyra');
  });
  it('does not call offline BFF a UI-only build or treat HTML as a healthy BFF',()=>{
    const banner=read('components/system/WebPreviewBanner.tsx');
    expect(banner).toContain("response.headers.get('content-type')");
    expect(banner).toContain("body?.ok === true");
    expect(banner).toContain("setTimeout(() => controller?.abort(), 10000)");
    expect(banner).toContain("setTimeout(() => { void probe(); }, 4000)");
    expect(banner).toContain('Backend unavailable');
    expect(banner).not.toContain("'UI-only mode'");
  });
});
