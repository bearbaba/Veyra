import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {verifiedLocalPayMissingFromAccount,receiptSyncRetryDelayMs} from '../mainnet/receiptSyncCandidates';
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
  const source=readFileSync(new URL('../components/pages/MainnetActivityPage.tsx',import.meta.url),'utf8');
  expect(source).toContain('saveVerifiedMainnetPayReceipt(token,{hash:v.hash,note:v.note,');
  expect(source).toContain('snapshotId:v.recipientSnapshotId');
  expect(source).not.toContain('requestMainnetCanaryTransfer');
  expect(source).toContain('Retry receipt sync (no wallet signature)');
 });
});

describe('M0 recipient receipt sync is independent of financial transfer',()=>{
 it('bounds retry delay without tight polling or unbounded waiting',()=>{
  expect([1,2,3,4,5,6,50].map(receiptSyncRetryDelayMs))
   .toEqual([5000,10000,20000,40000,60000,60000,60000]);
  expect(receiptSyncRetryDelayMs(Number.NaN)).toBe(5000);
 });
 it('Pay retries the original verified hash without another wallet request',()=>{
  const pay=readFileSync(new URL('../components/pages/MainnetPayPage.tsx',import.meta.url),'utf8');
  const start=pay.indexOf('// After canonical chain verification, retry ONLY the original receipt POST.');
  const stop=pay.indexOf('function reset()',start);
  const recovery=pay.slice(start,stop);
  expect(start).toBeGreaterThan(0);
  expect(recovery).toContain('saveVerifiedMainnetPayReceipt(token,original)');
  expect(recovery).toContain('receiptSyncRetryDelayMs(++failures)');
  expect(recovery).toContain("window.addEventListener('online',retryOnReconnect)");
  expect(recovery).not.toContain('requestMainnetCanaryTransfer');
  expect(recovery).not.toContain('writeMainnetJournal');
  expect(pay).toContain('Money sent · syncing receipt. Do not send again.');
  expect(pay).toContain("disabled={journal.stage==='VERIFIED'&&receiptSync!=='saved'}");
 });
 it('Activity retries only independently verified original Pay and polls B account receipts',()=>{
  const activity=readFileSync(new URL('../components/pages/MainnetActivityPage.tsx',import.meta.url),'utf8');
  expect(activity).toContain("serverHistoryStatus==='checking')return");
  expect(activity).toContain('receiptSyncRetryDelayMs(failures)');
  expect(activity).toContain("window.setInterval(()=>void reload(),20000)");
  expect(activity).toContain('Money sent · syncing receipt with your Veyra account');
  expect(activity).not.toContain('requestMainnetCanaryTransfer');
 });
});
describe('Home keeps one human-facing wallet site and one verified history',()=>{
 it('shows server-verified account receipts without claiming local entries are verified',()=>{
  const source=readFileSync(new URL('../components/pages/MainnetHomePage.tsx',import.meta.url),'utf8');
  expect(source).toContain('listVerifiedMainnetPayReceipts');
  expect(source).toContain("social.session&&social.identityOrigin==='ready'");
  expect(source).toContain('knownHashes.has(x.hash.toLowerCase())');
  expect(source).toContain("Verified · {x.recipientLabel??'Arc Mainnet'}");
  expect(source).toContain('{receive&&<section');
  expect(source).not.toContain('Show wallet address');
 });
});
