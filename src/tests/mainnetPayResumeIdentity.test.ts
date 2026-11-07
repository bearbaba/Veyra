import {describe,it,expect} from 'vitest';
import {payRecipientNavigationKey,savePayRecipient,readPayRecipient,clearPayRecipient,matchesSavedPayRecipient}
 from '../mainnet/payRecipientNavigation';
import {readPaySource,writePaySource} from '../mainnet/paySourcePreference';
const a='0x1111111111111111111111111111111111111111',
 b='0x2222222222222222222222222222222222222222';
const item={version:1 as const,owner:a,handle:'alice',userId:'usr_123456789ABCDEFGJ',
 wallet:b,savedAt:Date.now()};
function memory(){
 const values=new Map<string,string>();
 return {setItem:(k:string,v:string)=>{values.set(k,v);},
  getItem:(k:string)=>values.get(k)??null,removeItem:(k:string)=>{values.delete(k);}};
}
describe('Pay person and Wallet/Unified preferences survive reload without granting signing authority',()=>{
 it('restores only the bookmark belonging to the same wallet',()=>{
  const s=memory();
  expect(savePayRecipient(item,s)).toBe(true);
  expect(readPayRecipient(a,s)).toEqual(item);
  expect(readPayRecipient(b,s)).toBeNull();
  expect(clearPayRecipient(a,s)).toBe(true);
  expect(readPayRecipient(a,s)).toBeNull();
 });
 it('rejects forged identity, wrong owner, malformed and expired bookmarks',()=>{
  const s=memory();
  for(const invalid of [
   {...item,wallet:'0xinvalid'},
   {...item,userId:'usr_invalid'}, {...item,handle:'bad !'},
   {...item,savedAt:Date.now()-8*24*60*60*1000},
  ])expect(savePayRecipient(invalid,s)).toBe(false);
  s.setItem(payRecipientNavigationKey(a),JSON.stringify({...item,owner:b}));
  expect(readPayRecipient(a,s)).toBeNull();
 });
 it('never promotes a changed recipient wallet, user ID or handle after reload',()=>{
  const person={veyraUserId:item.userId,veyraHandle:item.handle,wallet:item.wallet};
  expect(matchesSavedPayRecipient(item,person,b)).toBe(true);
  expect(matchesSavedPayRecipient(item,{...person,wallet:a},b)).toBe(false);
  expect(matchesSavedPayRecipient(item,{...person,veyraUserId:'usr_23456789ABCDEFGJK'},b)).toBe(false);
  expect(matchesSavedPayRecipient(item,{...person,veyraHandle:'another'},b)).toBe(false);
  expect(matchesSavedPayRecipient(item,person,a)).toBe(false);
 });
 it('keeps only cosmetic source selection and isolates every wallet',()=>{
  const s=memory();
  expect(readPaySource(a,s)).toBe('wallet');
  expect(writePaySource(a,'unified',s)).toBe(true);
  expect(readPaySource(a,s)).toBe('unified');
  expect(readPaySource(b,s)).toBe('wallet');
  expect(writePaySource(a,'wallet',s)).toBe(true);
  expect(readPaySource(a,s)).toBe('wallet');
 });
});
