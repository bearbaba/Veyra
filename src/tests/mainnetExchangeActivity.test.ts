import {describe,expect,it,vi,afterEach} from 'vitest';
import {recordExchangeActivity,readExchangeActivities,exchangeActivityKey,
 type ExchangeActivity} from '../mainnet/exchangeActivity';
const owner='0x1111111111111111111111111111111111111111';
const other='0x2222222222222222222222222222222222222222';
const burn='0x'+'a'.repeat(64),mint='0x'+'b'.repeat(64);
function storage(){
 const m=new Map<string,string>();
 return {get length(){return m.size;},getItem:(k:string)=>m.get(k)??null,
  setItem:(k:string,v:string)=>{m.set(k,v);},key:(i:number)=>[...m.keys()][i]??null,
  map:m};
}
const entry:ExchangeActivity={owner,mode:'bridge',source:5042,destination:8453,
 tokenIn:'USDC',tokenOut:'USDC',amountIn:'1',minOut:'0.99',
 originalHash:burn,status:'SUBMITTED',createdAt:1730000000000};
afterEach(()=>vi.unstubAllGlobals());
describe('One Exchange activity groups verified source and destination',()=>{
 it('survives reload; owns one row even if there are two hashes',()=>{
  const s=storage();
  vi.stubGlobal('window',{dispatchEvent:()=>{}});
  expect(recordExchangeActivity(entry,s)).toBe(true);
  const result={...entry,status:'DESTINATION_VERIFIED' as const,destinationHash:mint,verifiedAt:1730000005000};
  expect(recordExchangeActivity(result,s)).toBe(true);
  expect(readExchangeActivities(owner,s)).toHaveLength(1);
  expect(readExchangeActivities(owner,s)[0]).toMatchObject({
   originalHash:burn,destinationHash:mint,status:'DESTINATION_VERIFIED'});
  expect(readExchangeActivities(other,s)).toEqual([]);
  expect(s.getItem(exchangeActivityKey(owner,burn))).toContain(mint);
 });
 it('rejects new destination rewrite or reverting already verified evidence',()=>{
  const s=storage();
  expect(recordExchangeActivity(entry,s)).toBe(true);
  const verified={...entry,status:'DESTINATION_VERIFIED' as const,destinationHash:mint};
  expect(recordExchangeActivity(verified,s)).toBe(true);
  expect(recordExchangeActivity(entry,s)).toBe(false);
  expect(recordExchangeActivity({...verified,amountIn:'3'},s)).toBe(false);
  expect(readExchangeActivities(owner,s)).toHaveLength(1);
 });
 it('cannot import another wallet record or malformed source hash',()=>{
  const s=storage();
  expect(recordExchangeActivity({...entry,originalHash:'bad'},s)).toBe(false);
  expect(recordExchangeActivity({...entry,owner:'not wallet'},s)).toBe(false);
  expect(readExchangeActivities(owner,s)).toEqual([]);
 });
});
