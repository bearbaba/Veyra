import {afterEach,describe,expect,it,vi} from 'vitest';
import {mainnetWalletLockName,MainnetWalletLockError,withMainnetWalletSigningLock}
 from '../mainnet/mainnetWalletSigningLock';
const a='0x1111111111111111111111111111111111111111';
const b='0x2222222222222222222222222222222222222222';
afterEach(()=>vi.unstubAllGlobals());
function mockBrowserLocks(){
 const active=new Set<string>(),events:string[]=[];
 vi.stubGlobal('navigator',{locks:{request:async <T>(name:string,
  _options:unknown,fn:(lock:{name:string}|null)=>Promise<T>):Promise<T>=>{
  if(active.has(name))return fn(null);
  active.add(name);events.push('acquire:'+name);
  try{return await fn({name});}finally{active.delete(name);events.push('release:'+name);}
 }}});
 return events;
}
describe('Mainnet financial operations are single-flight across browser tabs',()=>{
 it('rejects invalid wallet and browsers without a supported concurrency lock',async()=>{
  await expect(withMainnetWalletSigningLock('not wallet',()=>Promise.resolve(true)))
   .rejects.toMatchObject({code:'INVALID_WALLET'});
  vi.stubGlobal('navigator',{});
  await expect(withMainnetWalletSigningLock(a,()=>Promise.resolve(true)))
   .rejects.toMatchObject({code:'LOCK_UNAVAILABLE'});
 });
 it('serializes Pay and Exchange for one wallet even when each tab passes its own React guard',async()=>{
  const events=mockBrowserLocks();
  let release:()=>void=()=>{};
  const gate=new Promise<void>(resolve=>{release=resolve;});
  let entered=0;
  const pay=withMainnetWalletSigningLock(a,async()=>{
   entered++;await gate;return 'payment sent once';
  });
  await expect(withMainnetWalletSigningLock(a,()=>{entered++;return Promise.resolve('second signature requested');})).rejects.toMatchObject({code:'WALLET_BUSY'});
  expect(entered).toBe(1);
  release();
  expect(await pay).toBe('payment sent once');
  expect(events.filter(x=>x.startsWith('acquire:'))).toHaveLength(1);
  expect(await withMainnetWalletSigningLock(a,()=>Promise.resolve(true))).toBe(true);
 });
 it('permits independent wallets without leaking one wallet lock into another',async()=>{
  mockBrowserLocks();
  let release:()=>void=()=>{};
  const gate=new Promise<void>(resolve=>{release=resolve;});
  const first=withMainnetWalletSigningLock(a,async()=>{await gate;return 'A';});
  expect(await withMainnetWalletSigningLock(b,()=>Promise.resolve('B'))).toBe('B');
  release();expect(await first).toBe('A');
  expect(mainnetWalletLockName(a.toUpperCase().replace('0X','0x')))
   .toBe(mainnetWalletLockName(a));
 });
 it('releases the lock when the wallet rejects or the action throws',async()=>{
  mockBrowserLocks();
  await expect(withMainnetWalletSigningLock(a,()=>Promise.reject(new Error('wallet rejected'))))
   .rejects.toThrow('wallet rejected');
  expect(await withMainnetWalletSigningLock(a,()=>Promise.resolve('safe to review again'))).toBe('safe to review again');
  expect(new MainnetWalletLockError('WALLET_BUSY','busy').code).toBe('WALLET_BUSY');
 });
});
