import {describe,expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {reverifySettlementRecipient} from '../mainnet/reverifySettlementRecipient';
import type {VerifiedMainnetRecipient} from '../mainnet/verifiedRecipient';
const owner='0x1111111111111111111111111111111111111111';
const wallet='0x2222222222222222222222222222222222222222';
const original:VerifiedMainnetRecipient={
 owner,wallet,walletId:'wallet_1',veyraUserId:'usr_ABCDEFGHJKLMNPQ',veyraHandle:'alice',
 displayName:'Alice',snapshotId:'snp_original',reviewToken:'original_token',
 expiresAt:'2031-01-01T00:00:00Z',
};
const prepared={
 kind:'VEYRA_IDENTITY' as const,chainId:5042,resolvedAddress:wallet,
 snapshot:{walletId:original.walletId,veyraUserId:original.veyraUserId,
  veyraHandle:original.veyraHandle,displayName:original.displayName,avatarUrl:null,
  snapshotId:'snp_renewed',reviewToken:'renewed_token',expiresAt:'2031-01-01T00:00:00Z'},
};
function deps(override:Partial<typeof prepared>={}){
 return {prepare:vi.fn().mockResolvedValue({...prepared,...override}),
  verify:vi.fn().mockResolvedValue(undefined)};
}
const args={original,owner,recipient:wallet,sessionToken:'signed-session',sessionWalletBound:true};
describe('Settlement replaces the Mainnet Pay surface without losing identity proof',()=>{
 it('re-verifies exactly the same Veyra ID and receiving wallet before contract signing',async()=>{
  const api=deps();
  const verified=await reverifySettlementRecipient(args,api);
  expect(verified).toMatchObject({wallet,veyraUserId:original.veyraUserId,snapshotId:'snp_renewed'});
  expect(api.prepare).toHaveBeenCalledWith('@alice.veyra',5042,'signed-session');
  expect(api.verify).toHaveBeenCalledWith({
   snapshotId:'snp_renewed',expectedWalletId:original.walletId,
   expectedWalletAddress:wallet,expectedChainId:5042,reviewToken:'renewed_token',
  },'signed-session');
 });
 it('fails closed if chosen identity switches receiving wallet, user or chain',async()=>{
  const wrongWallet=deps({resolvedAddress:'0x3333333333333333333333333333333333333333'});
  await expect(reverifySettlementRecipient(args,wrongWallet)).rejects.toThrow(/changed/i);
  expect(wrongWallet.verify).not.toHaveBeenCalled();
  const wrongUser=deps({snapshot:{...prepared.snapshot,veyraUserId:'usr_ABCDEFGHJKLMNPX'}});
  await expect(reverifySettlementRecipient(args,wrongUser)).rejects.toThrow(/changed/i);
  const wrongChain=deps({chainId:8453});
  await expect(reverifySettlementRecipient(args,wrongChain)).rejects.toThrow(/no longer resolvable/i);
 });
 it('does not use a stale signed identity from a different connected wallet',async()=>{
  const api=deps();
  await expect(reverifySettlementRecipient({...args,sessionWalletBound:false},api))
   .rejects.toThrow(/Sign in again/i);
  await expect(reverifySettlementRecipient({...args,recipient:'0x3333333333333333333333333333333333333333'},api))
   .rejects.toThrow(/differs/i);
  expect(api.prepare).not.toHaveBeenCalled();
 });
 it('plain wallet routing is never misrepresented as a verified Veyra ID',async()=>{
  const api=deps();
  expect(await reverifySettlementRecipient({...args,original:null},api)).toBe(null);
  expect(api.prepare).not.toHaveBeenCalled();
  expect(api.verify).not.toHaveBeenCalled();
 });
 it('renders one Settlement Mainnet entry with compatibility alias and keeps legacy receipt histories',()=>{
  const read=(p:string)=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
  const shell=read('components/layout/AppShell.tsx');
  const app=read('App.tsx');
  const hub=read('components/pages/MainnetPayHub.tsx');
  const settlement=read('components/pages/SettlementPage.tsx');
  const activity=read('components/pages/MainnetActivityPage.tsx');
  expect(shell).toContain("{ id: 'settlement', label: 'Settlement'");
  expect(shell).toContain("['home', 'settlement', 'social', 'activity']");
  expect(app).toContain("next==='pay'?'settlement':next");
  expect(app).toContain('<MainnetPayHub initialMethod="wallet"');
  expect(hub).toContain("initialMethod='wallet'");
  expect(hub).toContain("setMethod('contract')");
  expect(hub).toContain('onWalletMode={activateWalletMethod}');
  expect(hub).toContain('verifiedRecipient={selectedVerified}');
  expect(settlement).toContain('await reverifySettlementRecipient');
  expect(settlement).toContain('withMainnetWalletSigningLock(address,performSettle)');
  expect(settlement).toContain("if(__VEYRA_RELEASE_ENV__!=='production')");
  expect(activity).toContain("v.type==='Pay'||v.type==='Settlement'");
 });
});
