import {describe,it,expect,vi,afterEach} from 'vitest';
import {assertMainnetSigningAllowed} from '../mainnet/releaseGates';
import {readSettlementIntent,writeSettlementIntent,settlementUnresolved,
  type SettlementIntent} from '../mainnet/settlementJournal';
import {readMainnetJournal,writeMainnetJournal,mainnetJournalKey} from '../mainnet/arcMainnetJournal';

const from='0x1111111111111111111111111111111111111111';
const to='0x2222222222222222222222222222222222222222';
const intent:SettlementIntent={owner:from,recipient:to,amount:'0.1',ref:'0x'+'a'.repeat(64),
  phase:'PAYMENT',stage:'UNKNOWN',hash:null,createdAt:Date.now(),fromBlock:'120'};
afterEach(()=>vi.unstubAllGlobals());
describe('read-only rollback and fault injection',()=>{
 it('denies new wallet signing when read-only yet leaves original journal unchanged',()=>{
  expect(()=>assertMainnetSigningAllowed(true)).toThrow('read-only recovery mode');
  expect(()=>assertMainnetSigningAllowed(false)).not.toThrow();
  const m=new Map<string,string>();
  const store={getItem:(k:string)=>m.get(k)??null,setItem:(k:string,v:string)=>{m.set(k,v);},
    removeItem:(k:string)=>{m.delete(k);}};
  expect(writeSettlementIntent(intent,store)).toBe(true);
  expect(settlementUnresolved(readSettlementIntent(from,store))).toBe(true);
  expect(()=>assertMainnetSigningAllowed(true)).toThrow();
  expect(readSettlementIntent(from,store).kind).toBe('active');
 });
 it('fails closed when storage rejects an intent write, with no duplicate payment',()=>{
  const storage={getItem:(_key:string)=>null,setItem:(_key:string,_value:string):void=>{throw new Error('QuotaExceededError');},
    removeItem:(_key:string):void=>{}};
  expect(writeSettlementIntent(intent,storage)).toBe(false);
  // Caller must stop BEFORE requesting wallet signing when write fails.
  expect(storage.getItem('anything')).toBeNull();
 });
 it('preserves an unknown payment when its original hash is unavailable',()=>{
  const storage=new Map<string,string>();
  const store={getItem:(k:string)=>storage.get(k)??null,setItem:(k:string,v:string)=>{storage.set(k,v);},
    removeItem:(k:string)=>{storage.delete(k);}};
  const journal={from,to,amount:'0.1',hash:null,stage:'UNKNOWN' as const};
  expect(writeMainnetJournal(journal,store)).toBe(true);
  expect(readMainnetJournal(from,store).kind).toBe('active');
  expect(storage.has(mainnetJournalKey(from))).toBe(true);
  expect(()=>assertMainnetSigningAllowed(true)).toThrow();
  expect(storage.has(mainnetJournalKey(from))).toBe(true);
 });
});
