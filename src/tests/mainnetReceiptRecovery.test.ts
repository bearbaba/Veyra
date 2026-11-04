import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {verifiedLocalPayMissingFromAccount} from '../mainnet/receiptSyncCandidates';
import type {LocalOperation} from '../mainnet/localOperations';
const a='0x1111111111111111111111111111111111111111';
const b='0x2222222222222222222222222222222222222222';
const hash=(n:string)=>'0x'+n.repeat(64);
const entry=(h:string,values:Partial<LocalOperation>={}):LocalOperation=>({
 type:'Pay',hash:h,owner:a,amount:'0.5',asset:'USDC',chainId:5042,
 status:'RECORDED',updatedAt:100,...values,
});
const key=(v:LocalOperation)=>v.type+':'+v.chainId+':'+v.hash.toLowerCase();
describe('Receipt recovery never changes original financial signing',()=>{
 it('finds only verified Arc Mainnet Pay not already in account history',()=>{
  const records=[entry(hash('a')),entry(hash('b')),entry(hash('c'),{status:'SUBMITTED'}),
   entry(hash('d'),{type:'Settlement'}),entry(hash('e'),{chainId:8453}),
   entry(hash('f'),{owner:b})];
  const verified=Object.fromEntries(records.map(v=>[key(v),'VERIFIED']));
  const missing=verifiedLocalPayMissingFromAccount(records,verified,new Set([hash('a')]),a);
  expect(missing.map(v=>v.hash)).toEqual([hash('b')]);
  expect(verifiedLocalPayMissingFromAccount(records,verified,new Set(),b).map(v=>v.hash))
   .toEqual([hash('f')]);
 });
 it('does not upload unknown, reverted, provider-tracked or unverified storage claims',()=>{
  const v=entry(hash('a'));
  for(const status of ['UNKNOWN','PENDING','REVERTED','PROVIDER','UNVERIFIED']){
   expect(verifiedLocalPayMissingFromAccount([v],{[key(v)]:status},new Set(),a)).toEqual([]);
  }
  expect(verifiedLocalPayMissingFromAccount([v],{},new Set(),a)).toEqual([]);
  expect(verifiedLocalPayMissingFromAccount([v],{[key(v)]:'VERIFIED'},new Set(),a,0)).toEqual([]);
 });
 it('bounds automatic receipt retry batch without wallet requests',()=>{
  const records=['a','b','c','d','e'].map(n=>entry(hash(n)));
  const verified=Object.fromEntries(records.map(v=>[key(v),'VERIFIED']));
  expect(verifiedLocalPayMissingFromAccount(records,verified,new Set(),a)).toHaveLength(3);
  // Queue processing is exercised with actual mocks in mainnetReceiptOutboxBehavior.test.ts.
 });
});

describe('Home keeps one human-facing wallet site and one verified history',()=>{
 it('shows server-verified account receipts without claiming local entries are verified',()=>{
  const source=readFileSync(new URL('../components/pages/MainnetHomePage.tsx',import.meta.url),'utf8');
  expect(source).toContain('listVerifiedMainnetPayReceipts');
  expect(source).toContain("social.session&&social.identityOrigin==='ready'");
  expect(source).toContain('knownHashes.has(x.hash.toLowerCase())');
  expect(source).toContain("x.kind==='settlement'?'Contract Settlement':'Direct transfer'");
  expect(source).toContain('listVerifiedMainnetSettlementReceipts');
  expect(source).toContain('{receive&&<section');
  expect(source).not.toContain('Show wallet address');
 });
});
