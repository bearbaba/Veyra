import {afterEach,describe,expect,it,vi} from 'vitest';
import {MAINNET_ROUTES,routeLabel} from '@/mainnet/mainnetProduct';
import {readLocalOperations,recordLocalOperation,operationKey} from '@/mainnet/localOperations';

const OWNER='0x4C7cb73aC8F8999af21cfc9fF4cF2333a9508Dcb';
const OTHER='0xD6b8A3A5500000000000000000000000000C2aF';
const HASH_A='0x'+'a'.repeat(64);
const HASH_B='0x'+'b'.repeat(64);
function fakeStorage(){
 const records=new Map<string,string>();
 return {
  getItem:(key:string)=>records.get(key)??null,
  setItem:(key:string,value:string)=>{records.set(key,value);},
  removeItem:(key:string)=>{records.delete(key);},
 };
}
afterEach(()=>vi.unstubAllGlobals());
describe('Mainnet route catalogue used by Home and Agent',()=>{
 it('uses actual Mainnet labels, never hidden Testnet routes',()=>{
  for(const c of Object.values(MAINNET_ROUTES)){
   expect(c.network).not.toMatch(/sepolia|testnet|preview/i);
  }
  expect(MAINNET_ROUTES.pay.network).toContain('5042');
  expect(MAINNET_ROUTES.swap.readiness).toBe('live-quote');
  expect(MAINNET_ROUTES.bridge.readiness).toBe('live-quote');
  expect(MAINNET_ROUTES.gateway.readiness).toBe('backend-required');
  expect(MAINNET_ROUTES.identity.readiness).toBe('backend-required');
  expect(routeLabel('bridge')).toBe('Live quote required');
 });
});
describe('Wallet-scoped local operation index is never settlement proof',()=>{
 it('keeps records private to the connected wallet and deduplicates hash+route',()=>{
  vi.stubGlobal('window',{localStorage:fakeStorage()});
  expect(recordLocalOperation({type:'Pay',owner:OWNER,hash:HASH_A,amount:'0.01',
   asset:'USDC',chainId:5042,status:'SUBMITTED'})).toBe(true);
  expect(recordLocalOperation({type:'Pay',owner:OWNER,hash:HASH_A,amount:'0.01',
   asset:'USDC',chainId:5042,status:'RECORDED'})).toBe(true);
  expect(readLocalOperations(OWNER)).toHaveLength(1);
  expect(readLocalOperations(OWNER)[0].status).toBe('RECORDED');
  expect(readLocalOperations(OTHER)).toEqual([]);
 });
 it('does not mix in records forged for another owner',()=>{
  const storage=fakeStorage();
  vi.stubGlobal('window',{localStorage:storage});
  storage.setItem(operationKey(OWNER),JSON.stringify([
   {type:'Swap',hash:HASH_B,owner:OTHER.toLowerCase(),amount:'0.01',asset:'EURC',
     chainId:5042,status:'RECORDED',updatedAt:Date.now()},
  ]));
  expect(readLocalOperations(OWNER)).toEqual([]);
 });
 it('never upgrades a submitted or locally recorded result into onchain VERIFIED',()=>{
  vi.stubGlobal('window',{localStorage:fakeStorage()});
  recordLocalOperation({type:'Settlement',owner:OWNER,hash:HASH_B,amount:'0.01',
   asset:'USDC',chainId:5042,status:'RECORDED'});
  const entries=readLocalOperations(OWNER);
  expect(entries[0].status).toBe('RECORDED');
  expect(Object.keys(entries[0])).not.toContain('verified');
 });
 it('treats inaccessible browser storage as unknown rather than zero or success',()=>{
  vi.stubGlobal('window',{localStorage:{
   getItem:()=>{throw Error('blocked');},
   setItem:()=>{throw Error('blocked');},
  }});
  expect(readLocalOperations(OWNER)).toEqual([]);
  expect(recordLocalOperation({type:'Bridge',owner:OWNER,hash:HASH_B,amount:'0.01',
   asset:'USDC',chainId:8453,status:'SUBMITTED'})).toBe(false);
 });
});
