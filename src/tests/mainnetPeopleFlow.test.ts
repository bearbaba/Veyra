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
 it('People and Pay use one server-backed search and keep Friends optional',()=>{
  const people=src('components/pages/MainnetPeoplePage.tsx');
  const hub=src('components/pages/MainnetPayHub.tsx');
  const shared=src('components/identity/MainnetRecipientSearch.tsx');
  expect(people).toContain('<MainnetRecipientSearch');
  const picker=src('components/pages/MainnetPayRecipientPicker.tsx');
  expect(hub).toContain('<MainnetPayRecipientPicker');
  expect(picker).toContain('lookupMainnetRecipient');
  expect(picker).toContain("found.person.veyraUserId!==expectedId");
  expect(picker).toContain("filter(f=>f.state==='CONNECTED')");
  expect(picker).toContain('aria-expanded={searchOpen}');
  expect(shared).toContain('lookupMainnetRecipient');
  expect(people).toContain('Saved wallet contacts · Details');
  expect(people).toContain('aria-expanded={findOpen}');
  // Shared verified search now returns a pinned recipient instead of a repeated query string.
  expect(people).toContain('onSelection={select}');
  expect(people).toContain('lookupMainnetRecipient');
  expect(people).toContain('verifiedRecipient');
  expect(people).toContain("social.invite('@'+selected.veyraHandle+'.veyra')");
  expect(people).toContain('social.respond(userId,decision)');
  expect(people).toContain('Friend invitations');
  expect(people).toContain('social.friendsHasMore');
  expect(people).toContain('social.loadMoreFriends()');
  expect(people).toContain('disabled={social.loadingMoreFriends}');
  expect(hub).toContain('onWalletChange={changeWalletRecipient}');
  expect(picker).toContain("useState<'wallet'|'people'>");
  expect(picker).toContain("onClick={()=>changeTab('wallet')}");
  expect(picker).toContain("onClick={()=>changeTab('people')}");
  expect(hub).toContain("recipient:'',amount:''");
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
describe('Human-first Home cannot treat browser records as server receipts',()=>{
 it('distinguishes on-device history from canonical verified receipts',()=>{
  const home=src('components/pages/MainnetHomePage.tsx');
  expect(home).toContain('Saved on this device · Open Activity for verification');
  expect(home).not.toContain('Recorded · Activity auto-verifies receipts');
  expect(home).toContain('listVerifiedMainnetPayReceipts');
  expect(home).toContain('knownHashes');
  expect(home).toContain('remote:');
 });
});
describe('Circle CCTP bridge preview: enforce onchain maximum fee',()=>{
 const quote=(amount='10',fee='0.1')=>({
  amount,token:'USDC',gasFees:[],fees:[
   {type:'forwarder',amount:fee,token:'USDC'},
   {type:'provider',amount:'0',token:'USDC'},
  ],
 });
 it('fails closed on fee-only payloads without the SDK amount, token and gas scope',()=>{
  expect(()=>readBridgeQuoteAmounts({fees:[{type:'forwarder',amount:'0.1',token:'USDC'}]},'10'))
   .toThrow('fee-capped USDC quote');
 });
 it('locks a fee cap to the reviewed amount with exact six-decimal math',()=>{
  expect(readBridgeQuoteAmounts(quote(),'10')).toEqual({
   minimum:'9.9',expected:'9.9',maxFee:'0.1'});
  expect(readBridgeQuoteAmounts(quote('0.1','0.0025'),'0.1')).toEqual({
   minimum:'0.0975',expected:'0.0975',maxFee:'0.0025'});
 });
 it('rejects a mutated quoted amount, unknown currencies or unresolved provider fees',()=>{
  expect(()=>readBridgeQuoteAmounts(quote('11'),'10')).toThrow();
  expect(()=>readBridgeQuoteAmounts({...quote(),token:'WETH'},'10')).toThrow();
  expect(()=>readBridgeQuoteAmounts({...quote(),fees:[{type:'forwarder',amount:null,token:'USDC'}]},'10')).toThrow();
  expect(()=>readBridgeQuoteAmounts({...quote(),fees:[{type:'forwarder',amount:'0.1',token:'ETH'}]},'10')).toThrow();
  expect(()=>readBridgeQuoteAmounts(quote('10','10'),'10')).toThrow('fees exceed');
  expect(()=>readBridgeQuoteAmounts({...quote(),gasFees:[{error:'no gas quote'}]},'10')).toThrow();
  expect(()=>readBridgeQuoteAmounts({...quote(),warnings:[{code:'SPEED_DOWNGRADED'}]},'10')).toThrow();
 });
});
