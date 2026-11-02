import {afterEach,describe,expect,it,vi} from 'vitest';
import {encodeAbiParameters,encodeEventTopics,parseAbi,type Hex} from 'viem';
import {
 readSettlementIntent,writeSettlementIntent,clearSettlementIntent,settlementUnresolved,
 settlementIntentKey,type SettlementIntent,
} from '../mainnet/settlementJournal';
import {matchCctpLinkedMessages,assertCctpBridgeLinked} from '../mainnet/verifyCctpBridgeLink';
import {CCTP_V2_MAINNET} from '../config/mainnetCatalog';

const owner='0x1111111111111111111111111111111111111111';
const recipient='0x2222222222222222222222222222222222222222';
const burnHash='0x'+'a'.repeat(64);
const mintHash='0x'+'b'.repeat(64);
const sourceDomain=26;
const destDomain=6;
function storage(){
 const values=new Map<string,string>();
 return {
  getItem:(key:string)=>values.get(key)??null,
  setItem:(key:string,value:string)=>{values.set(key,value);},
  removeItem:(key:string)=>{values.delete(key);},
 };
}
const intent: SettlementIntent={
 owner,recipient,amount:'0.1',ref:'0x'+'f'.repeat(64),
 phase:'PAYMENT',stage:'AWAITING_WALLET',hash:null,createdAt:123456789,
};
afterEach(()=>vi.unstubAllGlobals());
describe('Mainnet signed-wallet intent recovery',()=>{
 it('blocks repeating a signature request before a hash can be returned',()=>{
  const store=storage();
  const stub=vi.fn();
  vi.stubGlobal('window',{dispatchEvent:stub});
  vi.stubGlobal('Event',class {constructor(public type:string){}});
  expect(writeSettlementIntent(intent,store)).toBe(true);
  expect(settlementUnresolved(readSettlementIntent(owner,store))).toBe(true);
  expect(stub).toHaveBeenCalledTimes(1);
  expect(readSettlementIntent(recipient,store).kind).toBe('empty');
 });
 it('keeps unknown results locked after reload rather than inventing failure',()=>{
  const store=storage();
  expect(writeSettlementIntent({...intent,stage:'UNKNOWN'},store)).toBe(true);
  const saved=readSettlementIntent(owner,store);
  expect(saved.kind).toBe('active');
  expect(settlementUnresolved(saved)).toBe(true);
 });
 it('accepts a pending original hash, never equating it with a verified receipt',()=>{
  const store=storage();
  expect(writeSettlementIntent({...intent,hash:burnHash,stage:'PENDING'},store)).toBe(true);
  const saved=readSettlementIntent(owner,store);
  expect(settlementUnresolved(saved)).toBe(true);
  expect(saved.kind==='active'&&saved.value.hash).toBe(burnHash);
  expect(writeSettlementIntent({...intent,hash:burnHash,stage:'VERIFIED'},store)).toBe(true);
  expect(settlementUnresolved(readSettlementIntent(owner,store))).toBe(false);
  expect(clearSettlementIntent(owner,store)).toBe(true);
  expect(readSettlementIntent(owner,store).kind).toBe('empty');
 });
 it('rejects malformed / forged owner, hash and impossible stage transitions',()=>{
  const store=storage();
  store.setItem(settlementIntentKey(owner),JSON.stringify({...intent,owner:recipient}));
  expect(readSettlementIntent(owner,store).kind).toBe('blocked');
  store.setItem(settlementIntentKey(owner),JSON.stringify({...intent,stage:'PENDING',hash:null}));
  expect(readSettlementIntent(owner,store).kind).toBe('blocked');
  expect(writeSettlementIntent({...intent,stage:'VERIFIED',hash:null},store)).toBe(false);
 });
});
const events=parseAbi([
 'event MessageSent(bytes message)',
 'event MessageReceived(address indexed caller,uint32 sourceDomain,bytes32 indexed nonce,bytes32 sender,uint32 indexed finalityThresholdExecuted,bytes messageBody)',
]);
const u32=(n:number)=>n.toString(16).padStart(8,'0');
const nonce='0x'+'3'.repeat(64);
const sender='0x'+'4'.repeat(64);
const recipient32='0x'+'0'.repeat(24)+recipient.slice(2);
const body='0x'+'6'.repeat(64);
const buildMessage=(n:string)=>'0x'+u32(1)+u32(sourceDomain)+u32(destDomain)+
 n.slice(2)+sender.slice(2)+recipient32.slice(2)+'0'.repeat(64)+u32(2000)+u32(2000)+body.slice(2);
const signedMessage=buildMessage(nonce);
const originalMessage=buildMessage('0x'+'0'.repeat(64));
const sentEvent={
 address:CCTP_V2_MAINNET.messageTransmitterV2,
 topics:encodeEventTopics({abi:events,eventName:'MessageSent'}),
 data:encodeAbiParameters([{type:'bytes'}],[originalMessage as Hex]),
};
function received(n:string){
 return {
  address:CCTP_V2_MAINNET.messageTransmitterV2,
  topics:encodeEventTopics({abi:events,eventName:'MessageReceived',
   args:{caller:owner as Hex,nonce:n as Hex,finalityThresholdExecuted:2000}}),
  data:encodeAbiParameters([{type:'uint32'},{type:'bytes32'},{type:'bytes'}],
   [sourceDomain,sender as Hex,body as Hex]),
 };
}
const burn={logs:[sentEvent]};
const mint={logs:[received(nonce)]};
describe('CCTP V2 independently linked burn and mint receipts',()=>{
 it('matches the canonical source message and destination nonce/body',()=>{
  expect(matchCctpLinkedMessages(sourceDomain,destDomain,burn,mint,signedMessage,nonce)).toBe(true);
 });
 it('rejects a legitimate but UNRELATED destination receive nonce',()=>{
  const other={logs:[received('0x'+'9'.repeat(64))]};
  expect(matchCctpLinkedMessages(sourceDomain,destDomain,burn,other,signedMessage,nonce)).toBe(false);
 });
 it('rejects a valid destination event when the source burn is unrelated',()=>{
  expect(matchCctpLinkedMessages(sourceDomain,destDomain,{logs:[]},mint,signedMessage,nonce)).toBe(false);
 });
 it('rejects wrong domains, sender, message body, and attested nonce',()=>{
  expect(matchCctpLinkedMessages(6,26,burn,mint,signedMessage,nonce)).toBe(false);
  expect(matchCctpLinkedMessages(sourceDomain,destDomain,burn,mint,signedMessage,'0x'+'9'.repeat(64))).toBe(false);
  const differentBody={logs:[{
   ...received(nonce),data:encodeAbiParameters([{type:'uint32'},{type:'bytes32'},{type:'bytes'}],
    [sourceDomain,sender as Hex,'0x'+'f'.repeat(64) as Hex]),
  }]};
  expect(matchCctpLinkedMessages(sourceDomain,destDomain,burn,differentBody,signedMessage,nonce)).toBe(false);
 });
 it('requires Circle Iris to map the exact original burn to its destination',async()=>{
  const fetchMock=vi.fn((_url:unknown)=>({ok:true,json:()=>({
   messages:[{status:'complete',eventNonce:nonce,message:signedMessage,
    sourceTxHash:burnHash,destinationMintTxHash:mintHash}],
  })}));
  vi.stubGlobal('fetch',fetchMock);
  await expect(assertCctpBridgeLinked(5042,8453,burnHash,mintHash,burn,mint)).resolves.toBeUndefined();
  expect(fetchMock.mock.calls[0][0]).toContain('/v2/messages/26?transactionHash='+burnHash);
  await expect(assertCctpBridgeLinked(5042,8453,burnHash,'0x'+'c'.repeat(64),burn,mint)).rejects.toThrow('could not be linked');
 });
});
