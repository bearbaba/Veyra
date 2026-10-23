import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
import {resolveTrustedLoginOrigin} from '../../server/services/walletLoginService';
const primary='https://veyra-identity-friends-beta.vercel.app';
const secondary='https://veyra-unified-testnet.vercel.app';
const env={
 VEYRA_ENV:'testnet',VEYRA_APP_ORIGIN:primary,
 VEYRA_TESTNET_ADDITIONAL_ORIGIN:secondary,
} as NodeJS.ProcessEnv;
describe('multi-site EIP-712 login origin pinned to exact hosted Testnet apps',()=>{
 it('preserves old Identity Beta login and safely opts into approved Unified Testnet origin',()=>{
   expect(resolveTrustedLoginOrigin(undefined,undefined,env)).toBe(primary);
   expect(resolveTrustedLoginOrigin(primary,primary,env)).toBe(primary);
   expect(resolveTrustedLoginOrigin(secondary,secondary,env)).toBe(secondary);
   expect(resolveTrustedLoginOrigin(secondary,undefined,env)).toBe(secondary);
 });
 it('blocks cross-origin claimed vs observed mismatch before signature issuance and completion',()=>{
   expect(()=>resolveTrustedLoginOrigin(secondary,primary,env)).toThrow('LOGIN_ORIGIN_MISMATCH');
   expect(()=>resolveTrustedLoginOrigin(primary,secondary,env)).toThrow('LOGIN_ORIGIN_MISMATCH');
 });
 it('forbids wildcard, lookalike host, trailing slash, http, and unauthorized Vercel preview hosts',()=>{
   for(const invalid of [
     '*','http://veyra-unified-testnet.vercel.app',secondary+'/',
     'https://veyra-unified-testnet.vercel.app.evil.com',
     'https://veyra-unified-testnet-preview-1.vercel.app',
     'https://attacker.example',null,41
   ]) expect(()=>resolveTrustedLoginOrigin(invalid,undefined,env)).toThrow('LOGIN_ORIGIN_NOT_ALLOWED');
 });
 it('is Testnet only, never Mainnet',()=>{
   expect(()=>resolveTrustedLoginOrigin(secondary,undefined,{...env,VEYRA_ENV:'mainnet'})).toThrow('TESTNET_ONLY');
 });
 it('will not accept malformed deployment configuration as alternate origin',()=>{
   expect(()=>resolveTrustedLoginOrigin(secondary,undefined,{...env,VEYRA_TESTNET_ADDITIONAL_ORIGIN:'*'})).toThrow('LOGIN_NOT_CONFIGURED');
   expect(()=>resolveTrustedLoginOrigin(secondary,undefined,{...env,VEYRA_TESTNET_ADDITIONAL_ORIGIN:undefined})).toThrow('LOGIN_ORIGIN_NOT_ALLOWED');
 });
 it('retains an origin-bound pending login across challenge completion, never rebinds signatures',()=>{
   const source=readFileSync(new URL('../../server/services/walletLoginService.ts',import.meta.url),'utf8');
   expect(source).toContain('app_origin, issued_at, expires_at');
   expect(source).toContain('record.appOrigin !== origin');
   expect(source).toContain('origin,');
   expect(source).toContain('recoverTypedDataAddress');
   expect(source).toContain("status = 'CONSUMED'");
 });
});

