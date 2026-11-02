import {describe,it,expect,afterEach,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {validVerifiedRecipient,isSameVerifiedPaymentReceiver,type VerifiedMainnetRecipient} from '../mainnet/verifiedRecipient';
import {readBridgeQuoteAmounts} from '../mainnet/bridgeQuoteGuard';
import {readLocalOperations,recordLocalOperation} from '../mainnet/localOperations';
const src=(p:string)=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const a='0x1111111111111111111111111111111111111111';
const b='0x2222222222222222222222222222222222222222';
const v:VerifiedMainnetRecipient={owner:a,wallet:b,walletId:'wallet_22',veyraUserId:'usr_ABCDEFGHJKLMNPQ',
 veyraHandle:'alice',displayName:'Alice',snapshotId:'snap1',reviewToken:'review-proof',expiresAt:'2035-01-01T00:00:00Z'};
afterEach(()=>vi.unstubAllGlobals());
describe('Server-verifiable Veyra ID send safety',()=>{
 it('requires bound sender, receiving wallet and unexpired server snapshot',()=>{
  expect(validVerifiedRecipient(v,a,b,Date.parse('2034-01-01'))).toBe(true);
  expect(validVerifiedRecipient(v,a,'0x3333333333333333333333333333333333333333',Date.parse('2034-01-01'))).toBe(false);
  expect(validVerifiedRecipient(v,a,b,Date.parse('2036-01-01'))).toBe(false);
  expect(validVerifiedRecipient({...v,veyraUserId:'fake'},a,b,Date.parse('2034-01-01'))).toBe(false);
 });
 it('refreshes an expired ID only for the exact same person and receiving wallet',()=>{
  const next={...v,snapshotId:'snp_ABCDEFGHJKLMNPQ',reviewToken:'new-review-token',expiresAt:'2036-01-01T00:00:00Z'};
  expect(isSameVerifiedPaymentReceiver(v,next)).toBe(true);
  expect(isSameVerifiedPaymentReceiver(v,{...next,wallet:a})).toBe(false);
  expect(isSameVerifiedPaymentReceiver(v,{...next,walletId:'wlt_DIFFERENT'})).toBe(false);
  expect(isSameVerifiedPaymentReceiver(v,{...next,veyraUserId:'usr_OTHERPERSONABCDE'})).toBe(false);
 });
 it('runs server recipient verification before journal write and wallet request',()=>{
  const pay=src('components/pages/MainnetPayPage.tsx');
  const start=pay.indexOf('async function send()');
  const verify=pay.indexOf('const renewed=await reverifySelectedIdentity(review.plan)',start);
  const journal=pay.indexOf('writeMainnetJournal(initial',start);
  const send=pay.indexOf('requestMainnetCanaryTransfer',start);
  expect(verify).toBeGreaterThan(start);
  expect(journal).toBeGreaterThan(verify);
  expect(send).toBeGreaterThan(journal);
 });
 it('never treats an unauthenticated local contact as a signed Veyra ID',()=>{
  const people=src('components/pages/MainnetPeoplePage.tsx');
  expect(people).toContain("data.kind!=='VEYRA_IDENTITY'");
  expect(people).toContain('social.identityOrigin');
  expect(people).toContain('verifyPaymentRecipient');
  expect(people).toContain('Local wallet contacts (not verified Veyra IDs)');
  expect(people).toContain("social.invite('@'+selected.veyraHandle+'.veyra')");
  expect(people).toContain("social.respond(userId,decision)");
  expect(people).toContain('Friend invitations');
  expect(people).toContain('searchEpoch.current++');
  expect(people).toContain('if(epoch===searchEpoch.current)setSelected(verified)');
  expect(people).toContain('disabled={!x.veyraHandle}');
  // A slow lookup must not replace a newer recipient or leave the spinner stuck.
  expect(people).toContain('if(epoch===searchEpoch.current)setBusy(false)');
  expect(people).toContain('searchEpoch.current++;setBusy(false);setName(e.target.value)');
  // Friend pagination must be available without a reload or a second website.
  expect(people).toContain('social.friendsHasMore');
  expect(people).toContain('social.loadMoreFriends()');
  expect(people).toContain('disabled={social.loadingMoreFriends}');
 });
 it('keeps a note and reviewed label with the original browser receipt after status update',()=>{
  const map=new Map<string,string>();
  vi.stubGlobal('window',{localStorage:{getItem:(k:string)=>map.get(k)??null,
   setItem:(k:string,v:string)=>{map.set(k,v);}},dispatchEvent:()=>{}});
  const hash='0x'+'f'.repeat(64);
  expect(recordLocalOperation({type:'Pay',hash,owner:a,amount:'0.12',asset:'USDC',
   chainId:5042,destination:b,status:'SUBMITTED',note:'Dinner',recipientLabel:'@alice.veyra'})).toBe(true);
  expect(recordLocalOperation({type:'Pay',hash,owner:a,amount:'0.12',asset:'USDC',
   chainId:5042,destination:b,status:'RECORDED'})).toBe(true);
  const history=readLocalOperations(a);
  expect(history).toHaveLength(1);
  expect(history[0].note).toBe('Dinner');
  expect(history[0].recipientLabel).toBe('@alice.veyra');
  expect(history[0].submittedAt).toBeGreaterThan(0);
 });
});
describe('CCTP quote cannot invent the guaranteed minimum',()=>{
 it('rejects provider responses with only estimated fees',()=>{
  expect(()=>readBridgeQuoteAmounts({fees:[{type:'forwarder',amount:'0.1',token:'USDC'}]},'10'))
   .toThrow('guaranteed destination minimum');
 });
 it('uses only an explicit provider floor no higher than quoted expected output',()=>{
  expect(readBridgeQuoteAmounts({minimumReceived:{amount:'9.9'},estimatedOutput:{amount:'10'}},'10'))
   .toEqual({minimum:'9.9',expected:'10'});
  expect(()=>readBridgeQuoteAmounts({minimumReceived:'10.1',estimatedOutput:'10.1'},'10')).toThrow();
 });
});
