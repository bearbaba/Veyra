import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
import {validStoredExchangeRecovery,withFreshVerification,type StoredExchangeRecord} from '../mainnet/recoveryTrust';

const OWNER='0x1111111111111111111111111111111111111111';
const OTHER='0x2222222222222222222222222222222222222';
const HASH_A='0x'+'ab'.repeat(32),HASH_B='0x'+'cd'.repeat(32);
const swap={owner:OWNER,mode:'swap' as const,status:'VERIFIED' as const,source:5042,destination:5042,
 fromToken:'USDC',toToken:'EURC',amount:'2.000001',minimum:'1.900001',hash:HASH_A,intentId:'11111111-1111-4111-8111-111111111111'};
const bridge={owner:OWNER,mode:'bridge' as const,status:'VERIFIED' as const,source:5042,destination:8453,
 fromToken:'USDC',toToken:'USDC',amount:'2',minimum:'1.98',burnHash:HASH_A,mintHash:HASH_B};

describe('untrusted saved Exchange outcomes are always re-verified',()=>{
 it('downgrades even fully populated historical VERIFIED Swap/Bridge before rendering',()=>{
  for(const record of [swap,bridge]){
   const downgraded:StoredExchangeRecord=withFreshVerification(record);
   expect(downgraded.status).toBe('PENDING');
   expect(downgraded.downgradedFrom).toBe('VERIFIED');
   expect(downgraded).toMatchObject({...record,status:'PENDING'});
   expect(record.status).toBe('VERIFIED');
   expect(downgraded).not.toBe(record);
  }
 });
 it('also locks cached REVERTED records until chain recheck; localStorage is not failure proof',()=>{
  const stored={...swap,status:'REVERTED' as const};
  expect(withFreshVerification(stored)).toMatchObject({status:'PENDING',downgradedFrom:'REVERTED',hash:HASH_A});
 });
 it('preserves UNKNOWN/PENDING and does not silently upgrade or strip evidence',()=>{
  for(const status of ['UNKNOWN','PENDING'] as const){
   const stored={...bridge,status,extraEvidence:{readAt:123,original:HASH_A}};
   expect(withFreshVerification(stored)).toBe(stored);
  }
 });
 it('is idempotent after downgrade: a re-render cannot make a cached record VERIFIED',()=>{
  const downgraded=withFreshVerification(bridge);
  expect(withFreshVerification(downgraded)).toBe(downgraded);
 });
});

describe('local metadata is not authorization to read arbitrary chains or trust arbitrary tokens',()=>{
 it('accepts only the actual reviewed Swap and Bridge routes for this wallet',()=>{
  expect(validStoredExchangeRecovery(swap,OWNER,'swap')).toBe(true);
  expect(validStoredExchangeRecovery({...swap,fromToken:'EURC',toToken:'USDC'},OWNER,'swap')).toBe(true);
  expect(validStoredExchangeRecovery(bridge,OWNER,'bridge')).toBe(true);
  expect(validStoredExchangeRecovery({...bridge,source:8453,destination:5042},OWNER,'bridge')).toBe(true);
 });
 it('blocks wrong owner, wallet, chain, mode or token without losing the stored record',()=>{
  for(const broken of [
   {...swap,owner:OTHER},{...swap,source:8453},{...swap,destination:8453},
   {...swap,toToken:'USDC'},{...swap,fromToken:'BAD'},{...swap,mode:'bridge'},
  ])expect(validStoredExchangeRecovery(broken,OWNER,'swap')).toBe(false);
  for(const broken of [
   {...bridge,source:5042,destination:5042},{...bridge,toToken:'EURC'},
   {...bridge,source:137},{...bridge,owner:OTHER},
  ])expect(validStoredExchangeRecovery(broken,OWNER,'bridge')).toBe(false);
  expect(validStoredExchangeRecovery(swap,OTHER,'swap')).toBe(false);
 });
 it('rejects corrupt, too-small, non-finite, over-precision, zero and unbounded amounts',()=>{
  for(const amount of ['0','-1','Infinity','NaN','1e6','1.0000001','100.000001','9999999999','',5,null]){
   expect(validStoredExchangeRecovery({...swap,amount},OWNER,'swap')).toBe(false);
  }
  for(const minimum of ['0','-1','1.0000001','Infinity',null]){
   expect(validStoredExchangeRecovery({...bridge,minimum},OWNER,'bridge')).toBe(false);
  }
 });
 it('rejects fake/malformed hashes and malformed intent IDs, even if status looks verified',()=>{
  for(const change of [
   {hash:'0xdeadbeef'},{burnHash:'0xdeadbeef'},{mintHash:''},
   {intentId:'something wrong'},{status:'SUCCESS'},{downgradedFrom:'SUCCESS'},
  ]){
   expect(validStoredExchangeRecovery({...swap,...change},OWNER,'swap')).toBe(false);
  }
  expect(validStoredExchangeRecovery(null,OWNER,'swap')).toBe(false);
  expect(validStoredExchangeRecovery([],OWNER,'swap')).toBe(false);
 });
});
describe('onchain recovery path does not authorize another financial request',()=>{
 const circle=readFileSync(new URL('../components/pages/MainnetCirclePage.tsx',import.meta.url),'utf8');
 it('uses read-only source and destination receipts plus Circle linked-message verification',()=>{
  expect(circle).toContain('getTransactionReceipt({hash:sourceHash as Hash})');
  expect(circle).toContain('getTransactionReceipt({hash:hash as Hash})');
  expect(circle).toContain('getTransaction({hash:hash as Hash})');
  expect(circle).toContain('assertCctpBridgeLinked(');
  expect(circle).toContain('transferSum(receipt,receivedToken,address)');
 });
 it('gates result persistence on the current wallet/mode after awaited reads',()=>{
  expect(circle).toContain('verificationScopeRef.current=mode+\':\'+owner');
  expect(circle).toContain('assertSameScope();');
  expect(circle.split('assertSameScope();').length-1).toBeGreaterThanOrEqual(7);
  expect(circle).toContain("verificationScopeRef.current='unmounted'");
 });
 it('bounds background checks and preserves manual read-only recheck',()=>{
  expect(circle).toContain('autoCheckBudget.current.attempts>=4');
  expect(circle).toContain('autoCheckBudget.current.attempts++');
  expect(circle).toContain('Verify destination onchain');
  expect(circle).toContain("if(localStorage.getItem(key(mode,address)))throw Error('Previous operation must be resolved first.')");
  expect(circle).toContain("const otherMode:Mode=mode==='swap'?'bridge':'swap'");
  expect(circle).toContain('localStorage.getItem(key(otherMode,address))');
 });
 it('offers read-only original source recovery without weakening the duplicate lock',()=>{
  expect(circle).toContain('Recover original source transaction');
  expect(circle).toContain('async function recoverSourceHash()');
  expect(circle).toContain('sourceClient.getTransactionReceipt({hash:candidate as Hash})');
  expect(circle).toContain('tx.from.toLowerCase()!==owner');
  expect(circle).toContain('CCTP_V2_MAINNET.tokenMessengerV2.toLowerCase()');
  expect(circle).toContain("const next:Recovery={...current,status:'PENDING',burnHash:candidate}");
  expect(circle).toContain("if(!current||current.intentId!==recovery.intentId||current.burnHash)");
  expect(circle).toContain("if(localStorage.getItem(key(mode,address)))throw Error('Previous operation must be resolved first.')");
 });
 it('rejects wrong-network source hashes without treating Gateway deposits as Bridge burns',()=>{
  expect(circle).toContain("await otherClient.getTransactionReceipt({hash:candidate as Hash})");
  expect(circle).toContain("'This transaction is on '+label(recovery.source===BASE?ARC:BASE)");
  expect(circle).toContain("Use its original source burn hash, not a Gateway deposit.");
  expect(circle).toContain("if(verificationScopeRef.current!==scope)throw Error('Wallet changed during recovery.')");
  expect(circle).toContain("setManualSource(e.target.value.trim());setError('')");
 });
 it('does not present a missing Bridge hash as evidence of a transaction or a failed transfer',()=>{
  expect(circle).toContain('Bridge request saved · no source proof');
  expect(circle).toContain('Unverified request');
  expect(circle).toContain('No Bridge source transaction has been verified.');
  expect(circle).toContain('Check an existing Bridge source transaction');
  expect(circle).toContain('Do not use your Arc Gateway deposit hash.');
  expect(circle).toContain("if(localStorage.getItem(key(mode,address)))throw Error('Previous operation must be resolved first.')");
 });
 it('never displays cached terminal outcomes as proof on Activity or Home',()=>{
  const activity=readFileSync(new URL('../components/pages/MainnetActivityPage.tsx',import.meta.url),'utf8');
  const home=readFileSync(new URL('../components/pages/MainnetHomePage.tsx',import.meta.url),'utf8');
  expect(activity).toContain('reopen Exchange to recheck onchain');
  expect(home).toContain('recheck onchain');
 });
});
