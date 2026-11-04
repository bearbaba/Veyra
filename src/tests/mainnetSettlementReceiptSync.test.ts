import {describe,expect,it,vi} from 'vitest';
import {parseSettlementReceiptRequest,visibleSettlementReceipt}
 from '../../server/services/mainnetSettlementReceiptService';
import {validSettlementServerReceipt}
 from '../lib/api/mainnetSettlementReceipts';
import {syncVerifiedSettlementOnce}
 from '../mainnet/MainnetSettlementReceiptSyncWorker';
import type {LocalOperation} from '../mainnet/localOperations';
const sender='0x1111111111111111111111111111111111111111';
const recipient='0x2222222222222222222222222222222222222222';
const hash='0x'+'a'.repeat(64),ref='0x'+'b'.repeat(64),paymentId='0x'+'c'.repeat(64);
const sent='usr_ABCDEFGHJKLMNPQ',received='usr_ABCDEFGHJKLMNPX';
const now=new Date('2026-11-04T01:00:00.000Z');
function contractRow(){
 return {
  txHash:hash,chainId:5042,contractAddress:'0xfbec434fc2190f1887578b7a59b527d1b4acbe98',
  paymentId,paymentRef:ref,
  senderAddress:sender,recipientAddress:recipient,
  senderUserId:sent,recipientUserId:received,
  recipientSnapshotId:null,recipientLabel:'@bob.veyra',
  amountRaw:'100000',netAmountRaw:'99000',protocolFeeRaw:'1000',
  networkFeeWei:'1000000000000',blockNumber:100,paidAt:now,
  senderPrivateNote:'private sender only',createdAt:now,verifiedAt:now,
 };
}
const sendTx:LocalOperation={type:'Settlement',owner:sender,hash,amount:'0.1',asset:'USDC',
 chainId:5042,status:'RECORDED',updatedAt:Date.now(),
 destination:recipient,note:'private sender only'};
describe('Mainnet contract Settlement sender/receiver indexing and privacy',()=>{
 it('accepts only original hash and bounded optional sender metadata',()=>{
  expect(parseSettlementReceiptRequest({hash,note:'coffee'})).toMatchObject({hash,note:'coffee'});
  expect(()=>parseSettlementReceiptRequest({hash:'not-a-hash'})).toThrow('INVALID_SETTLEMENT_HASH');
  expect(()=>parseSettlementReceiptRequest({hash,note:'x'.repeat(121)})).toThrow('INVALID_PRIVATE_NOTE');
 });
 it('sender sees gross cost; recipient sees net; recipient cannot view sender-private note',()=>{
  const row=contractRow();
  const senderView=visibleSettlementReceipt(row,sent);
  const recipientView=visibleSettlementReceipt(row,received);
  expect(senderView).toMatchObject({kind:'settlement',direction:'sent',amountRaw:'100000',
   netAmountRaw:'99000',protocolFeeRaw:'1000',privateNote:'private sender only'});
  expect(recipientView).toMatchObject({direction:'received',amountRaw:'100000',
   netAmountRaw:'99000',protocolFeeRaw:'1000'});
  expect('privateNote' in recipientView).toBe(false);
  expect(validSettlementServerReceipt(recipientView)).toBe(true);
  expect(validSettlementServerReceipt({...recipientView,netAmountRaw:'20000'})).toBe(false);
  expect(validSettlementServerReceipt({...recipientView,privateNote:'leaked'})).toBe(false);
 });
 it('keeps legacy unbound sender notes on this device, never uploads them by guess',async()=>{
  const spy=vi.fn().mockResolvedValue(visibleSettlementReceipt(contractRow(),sent));
  const attempted=new Map<string,number>();
  const controller=new AbortController();
  const result=await syncVerifiedSettlementOnce({
   owner:sender,userId:sent,token:'signed-token',now:1000,
   signal:controller.signal,entries:[sendTx],attempted,
   submit:spy,
  });
  expect(result).toBe('synced');
  expect(spy).toHaveBeenCalledWith('signed-token',{hash},controller.signal);
  expect(spy.mock.calls[0]?.[1]).not.toHaveProperty('note');
  expect(await syncVerifiedSettlementOnce({
   owner:sender,userId:sent,token:'signed-token',now:1001,
   signal:controller.signal,entries:[sendTx],attempted,submit:spy,
  })).toBe('empty');
  expect(spy).toHaveBeenCalledTimes(1);
 });
 it('syncs the private note and identity snapshot only when the original signing user ID matches',async()=>{
  const api=vi.fn().mockResolvedValue(visibleSettlementReceipt(contractRow(),sent));
  const bound={...sendTx,senderUserId:sent,recipientSnapshotId:'snp_ABCDEFGHJKLMNPQ'};
  const controller=new AbortController();
  expect(await syncVerifiedSettlementOnce({
   owner:sender,userId:sent,token:'token',now:2000,signal:controller.signal,
   entries:[bound],attempted:new Map(),submit:api,
  })).toBe('synced');
  expect(api).toHaveBeenCalledWith('token',{
   hash,note:'private sender only',snapshotId:'snp_ABCDEFGHJKLMNPQ'},controller.signal);
  api.mockClear();
  const changedUser={...bound,senderUserId:received};
  expect(await syncVerifiedSettlementOnce({
   owner:sender,userId:sent,token:'token',now:2000,signal:controller.signal,
   entries:[changedUser],attempted:new Map(),submit:api,
  })).toBe('synced');
  expect(api).toHaveBeenCalledWith('token',{hash},controller.signal);
 });
 it('never upgrades a mismatched owner or an unverified browser operation',async()=>{
  const spy=vi.fn().mockResolvedValue({
   ...visibleSettlementReceipt(contractRow(),sent),senderUserId:received});
  expect(await syncVerifiedSettlementOnce({
   owner:sender,userId:sent,token:'signed-token',now:1000,
   signal:new AbortController().signal,
   entries:[{...sendTx,status:'SUBMITTED'},sendTx],attempted:new Map(),submit:spy,
  })).toBe('wrong-account');
  expect(await syncVerifiedSettlementOnce({
   owner:sender,userId:sent,token:'signed-token',now:1000,
   signal:new AbortController().signal,
   entries:[{...sendTx,status:'SUBMITTED'}],attempted:new Map(),submit:spy,
  })).toBe('empty');
 });
});
