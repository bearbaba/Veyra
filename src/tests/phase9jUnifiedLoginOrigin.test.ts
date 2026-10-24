import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
const read=(name:string)=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
describe('unified Testnet wallet login uses exact browser origin in both challenge and completion',()=>{
 it('binds challenge and completion to the same current browser site, not a hardcoded Identity Beta',()=>{
  const app=read('features/social/UnifiedSocial.tsx');
  expect(app).toContain('const appOrigin=window.location.origin');
  expect(app).toContain('walletAddress:w.account,chainId:5042002,appOrigin');
  expect(app).toContain('challengeId:c.challengeId,signature,appOrigin');
  expect(app).toContain("signReviewedIdentity(w.provider,c,'login',w.account,window.location.origin)");
  expect(app).not.toContain("location.origin='");
 });
 it('never changes verifier to accept arbitrary origin or skips independent wallet ownership verification',()=>{
  const verifier=read('identity-beta/protocol.ts');
  expect(verifier).toContain('message.appOrigin !== origin');
  expect(verifier).toContain('assertBrowserSignedIdentityOwner(');
  expect(verifier).toContain('Unexpected login origin or purpose. Signature cancelled.');
 });
});
