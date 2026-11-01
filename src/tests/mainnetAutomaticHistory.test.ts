import {describe,it,expect,vi,afterEach} from 'vitest';
import {recordLocalOperation,readLocalOperations,operationKey} from '../mainnet/localOperations';
import {inspectRecordedOperation} from '../mainnet/inspectRecordedOperation';

const owner='0x1111111111111111111111111111111111111111';
const foreign='0x2222222222222222222222222222222222222222';
const hash='0x'+'a'.repeat(64);
function memoryStore(){
 const m=new Map<string,string>();
 return {getItem:(key:string)=>m.get(key)??null,
  setItem:(key:string,value:string)=>{m.set(key,value);},
  removeItem:(key:string)=>{m.delete(key);}};
}
function mockBrowser(){
 const localStorage=memoryStore();
 const dispatchEvent=vi.fn();
 vi.stubGlobal('window',{localStorage,dispatchEvent});
 vi.stubGlobal('Event',class {constructor(public type:string){}});
 return {localStorage,dispatchEvent};
}
afterEach(()=>vi.unstubAllGlobals());

describe('automatic, wallet-scoped Mainnet transaction history',()=>{
 it('saves original broadcast before the receipt, without calling a signer',()=>{
  const {dispatchEvent}=mockBrowser();
  const ok=recordLocalOperation({
   type:'Settlement',owner,hash,amount:'0.01',asset:'USDC',
   chainId:5042,status:'SUBMITTED',destination:foreign,
  });
  expect(ok).toBe(true);
  expect(readLocalOperations(owner)).toHaveLength(1);
  expect(readLocalOperations(owner)[0].status).toBe('SUBMITTED');
  expect(readLocalOperations(foreign)).toHaveLength(0);
  expect(dispatchEvent).toHaveBeenCalledTimes(1);
 });
 it('upgrades the same hash after independent verification, rather than duplicating it',()=>{
  mockBrowser();
  const input={type:'Pay' as const,owner,hash,amount:'0.01',asset:'USDC',chainId:5042,destination:foreign};
  recordLocalOperation({...input,status:'SUBMITTED'});
  recordLocalOperation({...input,status:'RECORDED'});
  expect(readLocalOperations(owner)).toHaveLength(1);
  expect(readLocalOperations(owner)[0].status).toBe('RECORDED');
 });
 it('accepts reverted status but does not treat local records as onchain proof',()=>{
  mockBrowser();
  recordLocalOperation({type:'Settlement',owner,hash,amount:'0.01',asset:'USDC',chainId:5042,status:'REVERTED'});
  expect(readLocalOperations(owner)[0].status).toBe('REVERTED');
 });
 it('ignores foreign entries and malformed transaction hashes',()=>{
  const {localStorage}=mockBrowser();
  localStorage.setItem(operationKey(owner),JSON.stringify([{
   type:'Pay',owner:foreign,hash,amount:'42',asset:'USDC',chainId:5042,status:'RECORDED',updatedAt:1,
  }]));
  expect(readLocalOperations(owner)).toHaveLength(0);
  expect(recordLocalOperation({type:'Pay',owner,hash:'fake',amount:'1',asset:'USDC',chainId:5042,status:'SUBMITTED'})).toBe(false);
 });
 it('never checks a transaction pointer belonging to another wallet',async()=>{
  const result=await inspectRecordedOperation({
   type:'Pay',owner:foreign,hash,amount:'0.01',asset:'USDC',chainId:5042,
   status:'RECORDED',updatedAt:1,destination:owner,
  },owner);
  expect(result.status).toBe('UNVERIFIED');
 });
});
