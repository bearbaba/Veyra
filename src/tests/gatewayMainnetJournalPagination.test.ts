import {describe,it,expect} from 'vitest';
import {archiveGatewayMainnetReceipt,readGatewayMainnetHistory,
 readGatewayMainnetHistoryPage,readGatewayMainnetOperation,writeGatewayMainnetOperation,
 gatewayMainnetHistoryHeadKey,gatewayMainnetHistoryKey,
 type GatewayMainnetOperation,type GatewayMainnetReceipt} from '../mainnet/gatewayMainnetJournal';
const owner='0x1111111111111111111111111111111111111111';
const key=(n:number)=>n.toString(16).padStart(8,'0')+'-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const op=(n:number):GatewayMainnetOperation=>({
 version:1,id:key(n),owner,recipient:owner,kind:'deposit',chainId:8453,
 amount:'0.01',createdAt:Date.now(),status:'UNKNOWN',
});
const done=(n:number,verifiedAt=Date.now()):GatewayMainnetReceipt=>({
 version:1,operationId:key(n),owner,kind:'deposit',status:'CANCELLED_BEFORE_SOURCE',
 recipient:owner,chainId:8453,amount:'0.01',verifiedAt,
 rejectionMethod:'eth_signTypedData_v4',
});
function local(){
 const map=new Map<string,string>();
 return {map,getItem:(k:string)=>map.get(k)??null,
  setItem:(k:string,v:string)=>{map.set(k,v);},
  removeItem:(k:string)=>{map.delete(k);}};
}
describe('Gateway history archival remains durable and idempotent',()=>{
 it('archives 102 operations without a hard stop at 100, keeps earlier page',()=>{
  const storage=local();
  for(let i=0;i<102;i++){
   expect(writeGatewayMainnetOperation(op(i),storage)).toBe(true);
   expect(archiveGatewayMainnetReceipt(done(i),storage)).toBe(true);
  }
  expect(readGatewayMainnetOperation(owner,storage)).toBeNull();
  expect(storage.getItem(gatewayMainnetHistoryHeadKey(owner))).toBe('1');
  expect(readGatewayMainnetHistoryPage(owner,0,storage)).toHaveLength(100);
  expect(readGatewayMainnetHistoryPage(owner,1,storage)).toHaveLength(2);
  const latest=readGatewayMainnetHistory(owner,storage);
  if(latest==='blocked')throw Error('History corrupt');
  expect(latest).toHaveLength(100);
  expect(latest[0]?.operationId).toBe(key(101));
  expect(latest.find(x=>x.operationId===key(2))).toBeDefined();
  expect(readGatewayMainnetHistoryPage(owner,0,storage)).toContainEqual(expect.objectContaining({operationId:key(1)}));
 });
 it('recovers after receipt save succeeds but active checkpoint deletion fails',()=>{
  const storage=local();let failed=true;
  const unreliable={getItem:storage.getItem,setItem:storage.setItem,
   removeItem:(k:string)=>{if(failed){failed=false;return;}storage.removeItem(k);}};
  expect(writeGatewayMainnetOperation(op(1),unreliable)).toBe(true);
  expect(archiveGatewayMainnetReceipt(done(1,1000),unreliable)).toBe(false);
  expect(readGatewayMainnetOperation(owner,storage)).not.toBeNull();
  expect(archiveGatewayMainnetReceipt(done(1,2000),unreliable)).toBe(true);
  const history=readGatewayMainnetHistory(owner,storage);
  if(history==='blocked')throw Error('Invalid');
  expect(history).toHaveLength(1);
  expect(history[0]?.verifiedAt).toBe(1000);
  expect(readGatewayMainnetOperation(owner,storage)).toBeNull();
 });
 it('recovers when rollover-page write commits but head cursor write fails',()=>{
  const storage=local();
  for(let i=0;i<100;i++){
   writeGatewayMainnetOperation(op(i),storage);
   expect(archiveGatewayMainnetReceipt(done(i),storage)).toBe(true);
  }
  let failed=true;
  const unreliable={getItem:storage.getItem,
   setItem:(k:string,v:string)=>{
    if(k===gatewayMainnetHistoryHeadKey(owner)&&failed){failed=false;return;}
    storage.setItem(k,v);
   },removeItem:storage.removeItem};
  expect(writeGatewayMainnetOperation(op(100),unreliable)).toBe(true);
  expect(archiveGatewayMainnetReceipt(done(100,500),unreliable)).toBe(false);
  expect(readGatewayMainnetOperation(owner,unreliable)).not.toBeNull();
  expect(archiveGatewayMainnetReceipt(done(100,600),unreliable)).toBe(true);
  expect(storage.getItem(gatewayMainnetHistoryHeadKey(owner))).toBe('1');
  expect(readGatewayMainnetHistoryPage(owner,1,storage)).toHaveLength(1);
  expect(readGatewayMainnetOperation(owner,storage)).toBeNull();
 });
 it('rejects a different provider evidence for same operation even if verifiedAt matches',()=>{
  const storage=local();
  const first=done(5,300);
  writeGatewayMainnetOperation(op(5),storage);
  let firstFailure=true;
  const unreliable={getItem:storage.getItem,setItem:storage.setItem,
   removeItem:(k:string)=>{if(firstFailure){firstFailure=false;return;}storage.removeItem(k);}};
  expect(archiveGatewayMainnetReceipt(first,unreliable)).toBe(false);
  expect(archiveGatewayMainnetReceipt({...first,rejectionMethod:'eth_sendTransaction'},unreliable)).toBe(false);
  expect(readGatewayMainnetOperation(owner,unreliable)).not.toBeNull();
 });
 it('corrupted history never authorizes a new transaction',()=>{
  const storage=local();
  storage.setItem(gatewayMainnetHistoryKey(owner),'not-json');
  expect(readGatewayMainnetHistory(owner,storage)).toBe('blocked');
  writeGatewayMainnetOperation(op(1),storage);
  expect(archiveGatewayMainnetReceipt(done(1),storage)).toBe(false);
  expect(readGatewayMainnetOperation(owner,storage)).not.toBeNull();
 });
});
