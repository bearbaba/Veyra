import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {EMPTY_PAY_DRAFT,normalizePayDraft,payDraftKey,readPayDraft,writePayDraft} from '../mainnet/payDraft';
const A='0x1111111111111111111111111111111111111111';
const B='0x2222222222222222222222222222222222222222';
const C='0x3333333333333333333333333333333333333333';
const read=(p:string)=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
function storage(){
 const map=new Map<string,string>();
 return {getItem:(k:string)=>map.get(k)??null,setItem:(k:string,v:string)=>{map.set(k,v);},
  removeItem:(k:string)=>{map.delete(k);}};
}
describe('Human-first payment drafts (never an authorization or verified identity)',()=>{
 it('remembers recipient, amount and private note across method changes and reload',()=>{
  const store=storage(),draft={recipient:B,amount:'0.25',note:'coffee'};
  expect(writePayDraft(A,draft,store)).toBe(true);
  expect(readPayDraft(A,store)).toEqual(draft);
  expect(payDraftKey(A)).not.toBe(payDraftKey(C));
  expect(readPayDraft(C,store)).toEqual(EMPTY_PAY_DRAFT);
 });
 it('sanitizes malformed and long browser drafts without assuming address ownership',()=>{
  expect(normalizePayDraft({recipient:'@friend.veyra',amount:'1e22',note:'x'.repeat(500)}))
   .toEqual({recipient:'',amount:'',note:'x'.repeat(120)});
  expect(normalizePayDraft(null)).toEqual(EMPTY_PAY_DRAFT);
  expect(writePayDraft('invalid',{recipient:B,amount:'1',note:''},storage())).toBe(false);
 });
 it('cannot store new draft if session storage is unavailable',()=>{
  const broken={getItem:(_k:string)=>null,setItem:(_k:string,_v:string):void=>{throw Error('quota');}};
  expect(writePayDraft(A,{recipient:B,amount:'0.1',note:''},broken)).toBe(false);
 });
});
describe('Mainnet human-first navigation and transparent settlement',()=>{
 it('puts People on primary navigation and moves Swap/Bridge to More only for mainnet',()=>{
  const shell=read('components/layout/AppShell.tsx');
  expect(shell).toContain("{ id: 'social', label: 'People'");
  expect(shell).toContain("const SECONDARY_NAV: NavItem[] = VEYRA_ENV === 'mainnet'");
  expect(shell).toContain("{ id: 'convert', label: 'Swap'");
  expect(shell).toContain("{ id: 'bridge', label: 'Bridge'");
  expect(shell).toContain("const MOBILE_MORE_NAV = VEYRA_ENV === 'mainnet'");
 });
 it('keeps Pay, People and safe Receive available in the redesigned Mainnet Home',()=>{
  const home=read('components/pages/MainnetHomePage.tsx');
  expect(home).toContain("id:'send',label:'Pay'");
  expect(home).toContain("id:'people',label:'People'");
  expect(home).toContain("id:'swap',label:'Swap'");
  expect(home).toContain("id:'bridge',label:'Bridge'");
  expect(home).toContain("id:'activity',label:'Activity'");
  expect(home).toContain("onClick={()=>setReceive(v=>!v)} disabled={!address}");
  expect(home).toContain("onNavigate(id==='send'?'settlement'");
  expect(home).toContain("signedWallet&&social.identityOrigin==='ready'");
  expect(home).toContain("No transactions yet.");
  expect(home).toContain('{pending.length>0&&');
 });
 it('defaults to Settlement contract and retains wallet fallback as explicit method',()=>{
  const hub=read('components/pages/MainnetPayHub.tsx');
  expect(hub).toContain("initialMethod='contract'");
  expect(hub).toContain('Settlement method ·');
  expect(hub).toContain('{optionsOpen&&');
  expect(hub).toContain('No escrow or automatic refund');
  expect(hub).toContain('sharedDraft={draft}');
  expect(hub).toContain('onDraftChange={changeDraft}');
 });
 it('rechecks a contract review when the shared recipient or amount changes',()=>{
  const pay=read('components/pages/MainnetPayPage.tsx');
  const contract=read('components/pages/SettlementPage.tsx');
  const hub=read('components/pages/MainnetPayHub.tsx');
  expect(hub).toContain('onQueryEdit');
  expect(pay).toContain('reverifySelectedIdentity');
  expect(contract).toContain("if(step==='review'||step==='loading-fees'){setSnapshot(null);setStep('form');}");
  expect(contract).toContain('2 confirmations: approve this amount');
  expect(contract).toContain('no escrow, refund or purchase protection.');
 });
});
