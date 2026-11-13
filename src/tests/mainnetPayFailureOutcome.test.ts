import {describe,expect,it} from 'vitest';
import {classifyMainnetPayFailure} from '../mainnet/mainnetPayFailureOutcome';
import {readFileSync} from 'node:fs';
describe('M0 financial signing: error code is not proof of no transfer',()=>{
 it('releases a pre-wallet reservation only before any wallet request',()=>{
  expect(classifyMainnetPayFailure(false,new Error('Preflight failed'))).toBe('before-wallet');
  expect(classifyMainnetPayFailure(false,{code:4001})).toBe('before-wallet');
 });
 it('treats wallet rejection, action rejected and timeouts as uncertain once eth_sendTransaction started',()=>{
  for(const error of [{code:4001},{code:'ACTION_REJECTED'},new Error('RPC timed out'),
   {code:-32000,message:'Unknown transaction'},null]){
   expect(classifyMainnetPayFailure(true,error)).toBe('unknown-after-wallet');
  }
 });
 it('Pay preserves the submitted hash when a later local operation errors',()=>{
  const source=readFileSync(new URL('../components/pages/MainnetPayPage.tsx',import.meta.url),'utf8');
  expect(source).toContain('submittedHash=hash');
  expect(source).toContain("stage:submittedHash?'PENDING':'UNKNOWN'");
  expect(source).toContain("const outcome=classifyMainnetPayFailure(requested,e)");
  expect(source).not.toContain('if(!requested||rejected)');
  expect(source).toContain("__VEYRA_RELEASE_ENV__!=='production'");
 });
});
