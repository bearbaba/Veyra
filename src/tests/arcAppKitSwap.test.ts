import {describe,expect,it} from 'vitest';
import {keccak256,pad,stringToHex,type EIP1193Provider} from 'viem';
import {
 ARC_SWAP_TOKENS,ARC_SWAP_CHAIN_ID,arcSwapKey,arcSwapAmount,
 prepareArcSwapCheckpoint,readArcSwapCheckpoint,assertArcSwapWallet,
 verifyArcSwapReceipt,
} from '../core/swap/arcAppKitSwap';

const owner='0x1111111111111111111111111111111111111111';
const other='0x2222222222222222222222222222222222222222';
const identity='usr_VEYRA_TEST_ONLY';
const txHash='0x'+'ab'.repeat(32);
const event=keccak256(stringToHex('Transfer(address,address,uint256)'));
const log=(token:string,from:string,to:string,amount:bigint)=>({
 address:token,topics:[event,pad(from as `0x${string}`,{size:32}),
  pad(to as `0x${string}`,{size:32})],
 data:'0x'+amount.toString(16).padStart(64,'0'),
});
const checkpoint=()=>({...prepareArcSwapCheckpoint({
 owner,identity,from:'USDC',to:'EURC',amount:'2.5',minReceive:'2.00',
},123456),txHash});

describe('Arc App Kit Testnet Swap safety',()=>{
 it('rejects zero, malformed decimals and unsupported or same-asset swaps',()=>{
  expect(ARC_SWAP_CHAIN_ID).toBe(5042002);
  expect(arcSwapAmount('1.25')).toBe(1250000n);
  for(const x of ['0','-1','1e4','.5','1.0000001','2,2'])
   expect(()=>arcSwapAmount(x)).toThrow();
  expect(()=>prepareArcSwapCheckpoint({owner,identity,
   from:'USDC',to:'USDC',amount:'1',minReceive:'1'})).toThrow();
 });
 it('stores and reads only a matching wallet and Veyra ID pending state',()=>{
  const mem=new Map<string,string>();
  const store={getItem:(k:string)=>mem.get(k)??null};
  mem.set(arcSwapKey(owner,identity),JSON.stringify(checkpoint()));
  expect(readArcSwapCheckpoint(store,owner,identity)).toEqual(checkpoint());
  expect(readArcSwapCheckpoint(store,owner,'usr_OTHER')).toBeNull();
  expect(readArcSwapCheckpoint(store,other,identity)).toBeNull();
  mem.set(arcSwapKey(owner,identity),JSON.stringify({...checkpoint(),state:'VERIFIED'}));
  expect(readArcSwapCheckpoint(store,owner,identity)).toBeNull();
 });
 it('requires wallet address and correct Arc Testnet chain',async()=>{
  const provider=(account:string,chain:string)=>({
   request:({method}:{method:string})=>Promise.resolve(
    method==='eth_accounts'?[account]:method==='eth_chainId'?chain:null),
  }) as EIP1193Provider;
  await expect(assertArcSwapWallet(provider(owner,'0x4cef52'),owner))
   .resolves.toBeUndefined();
  await expect(assertArcSwapWallet(provider(other,'0x4cef52'),owner)).rejects.toThrow();
  await expect(assertArcSwapWallet(provider(owner,'0xaa36a7'),owner)).rejects.toThrow();
 });
 it('accepts only onchain input debit AND output receipt for reviewed wallet',()=>{
  const receipt={status:'success',transactionHash:txHash,logs:[
   log(ARC_SWAP_TOKENS.USDC,owner,other,2500000n),
   log(ARC_SWAP_TOKENS.EURC,other,owner,2150000n),
  ]};
  expect(verifyArcSwapReceipt(receipt,checkpoint())).toEqual({
   chainId:5042002,txHash,received:'2.15',token:'EURC',
  });
  expect(()=>verifyArcSwapReceipt({...receipt,status:'reverted'},checkpoint())).toThrow();
  expect(()=>verifyArcSwapReceipt({...receipt,logs:[receipt.logs[1]]},checkpoint())).toThrow();
  expect(()=>verifyArcSwapReceipt({...receipt,logs:[receipt.logs[0]]},checkpoint())).toThrow();
  expect(()=>verifyArcSwapReceipt({...receipt,logs:[
   receipt.logs[0],log(ARC_SWAP_TOKENS.EURC,other,owner,1999999n),
  ]},checkpoint())).toThrow();
  expect(()=>verifyArcSwapReceipt({...receipt,logs:[
   log(ARC_SWAP_TOKENS.USDC,other,owner,2500000n),receipt.logs[1],
  ]},checkpoint())).toThrow();
  expect(()=>verifyArcSwapReceipt({...receipt,logs:[
   log(ARC_SWAP_TOKENS.USDC,owner,other,2500001n),receipt.logs[1],
  ]},checkpoint())).toThrow();
 });
});
