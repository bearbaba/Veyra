import {describe,it,expect} from 'vitest';
import {readRequestNavigation,saveRequestNavigation,clearRequestNavigation} from '../mainnet/paymentRequestNavigation';
const owner='0x1111111111111111111111111111111111111111';
const ownerB='0x2222222222222222222222222222222222222222';
const payload={version:1 as const,owner,requestId:'prq_123456789ABCDEFGHJK',
 requesterHandle:'alice',requesterUserId:'usr_123456789ABCDEFGJ',
 payerUserId:'usr_23456789ABCDEFGJK',savedAt:Date.now()};
function store(){
 const m=new Map<string,string>();
 return {getItem:(k:string)=>m.get(k)??null,setItem:(k:string,v:string)=>{m.set(k,v);},
  removeItem:(k:string)=>{m.delete(k);}};
}
describe('Payment Request browser navigation is an untrusted hint',()=>{
 it('survives reload only for the selected wallet and can be cleared',()=>{
  const s=store();
  expect(saveRequestNavigation(payload,s)).toBe(true);
  expect(readRequestNavigation(owner,s)).toEqual(payload);
  expect(readRequestNavigation(ownerB,s)).toBeNull();
  expect(clearRequestNavigation(owner,s)).toBe(true);
  expect(readRequestNavigation(owner,s)).toBeNull();
 });
 it('rejects malformed identities, stale and future data',()=>{
  const s=store();
  expect(saveRequestNavigation({...payload,requesterHandle:'bad !'},s)).toBe(false);
  expect(saveRequestNavigation({...payload,savedAt:Date.now()-8*24*60*60*1000},s)).toBe(false);
  expect(saveRequestNavigation({...payload,savedAt:Date.now()+60000},s)).toBe(false);
  expect(saveRequestNavigation({...payload,requesterUserId:payload.payerUserId},s)).toBe(false);
 });
 it('a storage failure is never a successful recovery',()=>{
  const fail={getItem:(_:string)=>null,setItem:()=>{throw Error('quota');},
   removeItem:()=>{throw Error('quota');}};
  expect(saveRequestNavigation(payload,fail)).toBe(false);
  expect(readRequestNavigation(owner,fail)).toBeNull();
 });
});
