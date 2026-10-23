import {describe,expect,it,vi,afterEach} from 'vitest';
import {readFileSync} from 'node:fs';
import {beginXLink} from '../lib/api/identityApi';
import {STAGING_ALLOWED_PATHS} from '../../scripts/stagingBffAllowlist';

const read=(path:string)=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
afterEach(()=>vi.unstubAllGlobals());

describe('unified Veyra Testnet X OAuth remains explicitly gated',()=>{
 it('does not display actionable X linking or launch OAuth on an unconfigured site',()=>{
  const settings=read('components/pages/SettingsPage.tsx');
  expect(settings).toContain('X linking unavailable');
  expect(settings).toContain('a verified OAuth setup and consent flow');
  expect(settings).toContain('disabled aria-label="X linking is not available yet"');
  expect(settings).not.toContain('beginXLink(');
  expect(settings).not.toContain('window.location.assign');
  expect(STAGING_ALLOWED_PATHS).not.toContain('/api/auth/x/start');
  expect(STAGING_ALLOWED_PATHS).not.toContain('/api/auth/x/callback');
 });
 it('gives a human error, never a raw Unexpected token HTML parser exception',async()=>{
  vi.stubGlobal('fetch',vi.fn(()=>Promise.resolve({
   ok:true,status:200,headers:{get:()=> 'text/html'},
   json:()=>{throw new Error('Unexpected token <');},
  })));
  await expect(beginXLink()).rejects.toThrow('This Veyra service is not available');
 });
 it('rejects malformed JSON from an identity endpoint with actionable text',async()=>{
  vi.stubGlobal('fetch',vi.fn(()=>Promise.resolve({
   ok:true,status:200,headers:{get:()=> 'application/json'},
   json:()=>Promise.reject(new SyntaxError('Unexpected token <')),
  })));
  await expect(beginXLink()).rejects.toThrow('invalid response');
 });
});
