import {describe,expect,it,vi} from 'vitest';
import {parseRecipientQuery,lookupMainnetRecipient,createRecipientSearchGuard} from '../mainnet/recipientLookup';
import type {PreparedRecipient} from '../lib/api/identityApi';
const sender='0x1111111111111111111111111111111111111111';
const receiver='0x2222222222222222222222222222222222222222';
const response:PreparedRecipient={
 kind:'VEYRA_IDENTITY',resolvedAddress:receiver,chainId:5042,
 snapshot:{snapshotId:'snp_ABCDEFGHJKLMNPQ',walletId:'wallet_001',
  veyraUserId:'usr_ABCDEFGHJKLMNPQ',veyraHandle:'bob',displayName:'Bob',
  avatarUrl:null,reviewToken:'server-only-review',expiresAt:'2099-01-01T00:00:00Z'},
};
describe('M0 People and Pay use the same fail-closed recipient resolver',()=>{
 it('distinguishes Veyra ID, X handle and raw wallet without guessing an account',()=>{
  expect(parseRecipientQuery(' @BOB.Veyra ')).toEqual({kind:'veyra',query:'@bob.veyra'});
  expect(parseRecipientQuery('https://x.com/Bob_123')).toEqual({
   kind:'x',handle:'bob_123',query:'x:bob_123'});
  expect(parseRecipientQuery('@Bob_123')).toMatchObject({kind:'x',handle:'bob_123'});
  expect(parseRecipientQuery(receiver)).toEqual({kind:'wallet',wallet:receiver});
  for(const invalid of ['bob','@bob.eth','0xabc','https://evil.example/bob','https://x.com/bob/status/1'])
   expect(()=>parseRecipientQuery(invalid)).toThrow();
 });
 it('linked X requires signed backend resolution and independent wallet verification',async()=>{
  const prepare=vi.fn(()=>Promise.resolve(response));
  const verify=vi.fn(()=>Promise.resolve());
  const result=await lookupMainnetRecipient('@bob',sender,'signed-session',{prepare,verify});
  expect(result).toMatchObject({kind:'veyra',person:{wallet:receiver,veyraUserId:'usr_ABCDEFGHJKLMNPQ'}});
  expect(prepare).toHaveBeenCalledWith('x:bob',5042,'signed-session');
  expect(verify).toHaveBeenCalledWith({snapshotId:'snp_ABCDEFGHJKLMNPQ',
   expectedWalletId:'wallet_001',expectedWalletAddress:receiver,expectedChainId:5042,
   reviewToken:'server-only-review'},'signed-session');
 });
 it('unlinked X gets an invitation rather than a fabricated recipient wallet',async()=>{
  const prepare=vi.fn(()=>Promise.reject(new Error('X_NOT_LINKED')));
  const verify=vi.fn();
  const result=await lookupMainnetRecipient('@bob',sender,'signed-session',{prepare,verify});
  expect(result).toMatchObject({kind:'x-unavailable',handle:'bob'});
  expect(result).not.toHaveProperty('wallet');
  expect(prepare).toHaveBeenCalledWith('x:bob',5042,'signed-session');
  expect(verify).not.toHaveBeenCalled();
 });
 it('raw wallet syntax is not mislabelled as Veyra identity',async()=>{
  const prepare=vi.fn(),verify=vi.fn();
  expect(await lookupMainnetRecipient(receiver,sender,undefined,{prepare,verify}))
   .toEqual({kind:'wallet',wallet:receiver});
  expect(prepare).not.toHaveBeenCalled();
 });
 it('requires signed session, chain 5042, server snapshot and independent verification',async()=>{
  const prepare=vi.fn(()=>Promise.resolve(response));
  const verify=vi.fn(()=>Promise.resolve());
  const result=await lookupMainnetRecipient('@bob.veyra',sender,'signed-session',{prepare,verify});
  expect(result).toMatchObject({kind:'veyra',person:{wallet:receiver,veyraHandle:'bob',owner:sender}});
  expect(prepare).toHaveBeenCalledWith('@bob.veyra',5042,'signed-session');
  expect(verify).toHaveBeenCalledWith({snapshotId:'snp_ABCDEFGHJKLMNPQ',
   expectedWalletId:'wallet_001',expectedWalletAddress:receiver,expectedChainId:5042,
   reviewToken:'server-only-review'},'signed-session');
  await expect(lookupMainnetRecipient('@bob.veyra',sender,undefined,{prepare,verify}))
   .rejects.toThrow('Sign in');
  expect(verify).toHaveBeenCalledTimes(1);
 });
 it('does not promote unauthenticated, wrong-network, expired or substituted wallet snapshots',async()=>{
  const verify=vi.fn(()=>Promise.resolve());
  for(const corrupted of [
   {...response,chainId:8453}, {...response,snapshot:null},
   {...response,resolvedAddress:'0xnotwallet'},
   {...response,snapshot:{...response.snapshot!,expiresAt:'2001-01-01T00:00:00Z'}},
   {...response,snapshot:{...response.snapshot!,veyraUserId:'unverified'}},
  ]){
   await expect(lookupMainnetRecipient('@bob.veyra',sender,'signed-session',
    {prepare:()=>Promise.resolve(corrupted),verify})).rejects.toThrow();
  }
  expect(verify).not.toHaveBeenCalled();
 });
 it('invalidates older async searches even when their response arrives last',()=>{
  const guard=createRecipientSearchGuard();
  const first=guard.start();
  const second=guard.start();
  expect(guard.isCurrent(first)).toBe(false);
  expect(guard.isCurrent(second)).toBe(true);
  guard.invalid();
  expect(guard.isCurrent(second)).toBe(false);
 });
});
