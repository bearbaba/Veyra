import {readFileSync} from 'node:fs';
import {describe,it,expect,vi,afterEach} from 'vitest';
import {assertMainnetSigningAllowed,assertMainnetCanarySigningAllowed,assertMainnetContractCanarySigningAllowed,canSignMainnetCanary} from '../mainnet/releaseGates';
import {buildMainnetPayPlan,reconcileMainnetCanary} from '../mainnet/arcMainnetPay';
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
  expect(canSignMainnetCanary('0x4C7cb73aC8F8999af21cfc9fF4cF2333a9508Dcb',10_000n)).toBe(true);
  expect(canSignMainnetCanary('0x4C7cb73aC8F8999af21cfc9fF4cF2333a9508Dcb',10_001n)).toBe(false);
  expect(canSignMainnetCanary('0x1111111111111111111111111111111111111111',10_000n)).toBe(false);
  expect(()=>assertMainnetCanarySigningAllowed('0x4C7cb73aC8F8999af21cfc9fF4cF2333a9508Dcb',10_000n,false,true)).not.toThrow();
  expect(()=>assertMainnetCanarySigningAllowed('0x1111111111111111111111111111111111111111',10_000n,false,true)).toThrow('authorized canary wallet');
  expect(()=>assertMainnetCanarySigningAllowed('0x4C7cb73aC8F8999af21cfc9fF4cF2333a9508Dcb',10_000n,true,true)).toThrow('read-only recovery mode');
  // In-app contract payment canary is owner-only and <=0.01 USDC,
  // checked again on both approval and pay() signature paths.
  const owner='0x4C7cb73aC8F8999af21cfc9fF4cF2333a9508Dcb';
  expect(()=>assertMainnetContractCanarySigningAllowed(owner,10_000n,'pay',false)).not.toThrow();
  expect(()=>assertMainnetContractCanarySigningAllowed(owner,10_001n,'pay',false)).toThrow('0.01 USDC');
  expect(()=>assertMainnetContractCanarySigningAllowed(from,10_000n,'pay',false)).toThrow('authorized canary wallet');
  expect(()=>assertMainnetContractCanarySigningAllowed(owner,10_000n,'escrow',false)).toThrow('escrow signing is not enabled');
  expect(()=>assertMainnetContractCanarySigningAllowed(owner,10_000n,'pay',true)).toThrow('read-only recovery');
  const settlementSource=readFileSync(new URL('../components/pages/SettlementPage.tsx',import.meta.url),'utf8');
  expect(settlementSource.match(/assertMainnetContractCanarySigningAllowed\(address,snapshot\.amountParsed,snapshot\.mode\)/g)).toHaveLength(2);
  // Deployment and Circle routes remain closed under the normal M0 pilot.

  const deploy=readFileSync(new URL('../components/pages/MainnetSettlementDeploy.tsx',import.meta.url),'utf8');
  expect(deploy).toContain('assertMainnetSigningAllowed();');
  expect(deploy).toContain('!MAINNET_CANARY_ONLY && !MAINNET_EMERGENCY_READ_ONLY');
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
 it('fails closed if Arc RPC times out while inspecting an original hash',async()=>{
  const plan=buildMainnetPayPlan(from,to,'0.1');
  vi.stubGlobal('fetch',vi.fn(()=>{throw new Error('RPC_TIMEOUT_INJECTED');}));
  await expect(reconcileMainnetCanary(plan,'0x'+'b'.repeat(64)))
    .rejects.toThrow('Arc Mainnet RPC request failed. Do not retry');
  // No wallet signing or journal deletion is attempted by reconciliation.
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
