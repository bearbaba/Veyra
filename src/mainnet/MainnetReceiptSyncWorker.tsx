/** Background-in-app sync of already verified Mainnet USDC receipts; never requests a wallet signature. */
import {useEffect,useRef} from 'react';
import {useAccount} from 'wagmi';
import {useUnifiedSocial} from '@/features/social/UnifiedSocial';
import {classifyReceiptSyncError,MainnetReceiptSyncError,saveVerifiedMainnetPayReceipt,
 type MainnetPayServerReceipt} from '@/lib/api/mainnetPayReceipts';
import {receiptSyncRetryDelayMs} from './receiptSyncCandidates';
import {readReceiptOutbox,updateReceiptOutbox,type ReceiptOutboxItem} from './receiptOutbox';

type OutboxStorage=Pick<Storage,'getItem'|'setItem'|'removeItem'|'key'|'length'>;
export type ReceiptTickResult='empty'|'synced'|'retry'|'sign-in'|'review'|'blocked'|'wrong-account';
export async function syncReceiptOutboxOnce(args:{
 owner:string;userId:string;token:string;storage:OutboxStorage;
 submit:(token:string,payload:{hash:string;note?:string;snapshotId?:string},signal:AbortSignal)=>Promise<MainnetPayServerReceipt>;
 signal:AbortSignal;now?:number;skipSignIn?:boolean;
}):Promise<ReceiptTickResult>{
 const {owner,userId,token,storage,submit,signal}=args;
 if(signal.aborted||!token||!userId)return 'sign-in';
 const queue=readReceiptOutbox(owner,storage);
 if(queue.kind==='blocked')return 'blocked';
 const now=args.now??Date.now();
 // A signed-out or switched account must not consume someone else's queued metadata.
 const candidates=queue.items.filter(v=>v.senderUserId===undefined||v.senderUserId===userId);
 if(!candidates.length)return queue.items.length?'wrong-account':'empty';
 const item=candidates.find(v=>v.status!=='review'&&v.nextAttemptAt<=now&&
   (v.status!=='sign-in'||!args.skipSignIn));
 if(!item)return 'empty';
 try{
  const receipt=await submit(token,{hash:item.hash,note:item.note,
   ...(item.snapshotId?{snapshotId:item.snapshotId}:{})},signal);
  if(signal.aborted)return 'empty';
  if(receipt.txHash.toLowerCase()!==item.hash.toLowerCase()||receipt.chainId!==5042||
     receipt.senderAddress.toLowerCase()!==owner.toLowerCase()||receipt.direction!=='sent')
   throw new MainnetReceiptSyncError('review',200,'RECEIPT_OWNER_MISMATCH');
  const removed=updateReceiptOutbox(owner,item.hash,storage,()=>null);
  if(removed)try{window.dispatchEvent(new Event('veyra:mainnet:server-receipt'));}catch{/* no UI */ }
  return removed?'synced':'blocked';
 }catch(e){
  if(signal.aborted)return 'empty';
  const failure=classifyReceiptSyncError(e);
  const attempts=item.attempts+1;
  const status=failure==='sign-in'?'sign-in':failure==='review'?'review':'pending';
  const code=e instanceof MainnetReceiptSyncError?e.code:
   failure==='retry'?'BACKEND_TEMPORARILY_UNAVAILABLE':'RECEIPT_REQUIRES_REVIEW';
  updateReceiptOutbox(owner,item.hash,storage,(latest:ReceiptOutboxItem)=>({
   ...latest,attempts,status,problem:code.slice(0,70),
   nextAttemptAt:status==='pending'?now+receiptSyncRetryDelayMs(attempts):0,
  }));
  return failure;
 }
}
export function MainnetReceiptSyncWorker(){
 const {address,connector}=useAccount();
 const social=useUnifiedSocial();
 const token=social.session?.token;
 const userId=social.session?.profile.veyraUserId;
 const walletKey=(address?.toLowerCase()??'')+':'+(connector?.uid??'');
 const currentRequest=useRef(false);
 useEffect(()=>{
  if(!address||!token||!userId||social.identityOrigin!=='ready'||
     social.session?.walletKey!==walletKey)return;
  const owner=address;
  const controller=new AbortController();
  let active=true,authBlocked=false;
  let running=false;
  async function tick(){
   if(!active||running||currentRequest.current||authBlocked)return;
   running=true;currentRequest.current=true;
   try{
    const result=await syncReceiptOutboxOnce({
     owner,userId:userId!,token:token!,storage:window.localStorage,
     signal:controller.signal,skipSignIn:authBlocked,
     submit:(session,payload,signal)=>saveVerifiedMainnetPayReceipt(session,payload,signal),
    });
    if(active&&result==='sign-in')authBlocked=true;
   }catch{/* Storage blocked or offline; do not create a financial action. */}
   finally{running=false;currentRequest.current=false;}
  }
  void tick();
  const interval=window.setInterval(()=>void tick(),10000);
  const resume=()=>void tick();
  window.addEventListener('online',resume);
  window.addEventListener('focus',resume);
  window.addEventListener('veyra:mainnet:outbox',resume);
  const storageChanged=(ev:StorageEvent)=>{
   if(ev.key?.startsWith('veyra:arc-mainnet-5042-receipt-outbox:v1:'+owner.toLowerCase()+':'))
    void tick();
  };
  window.addEventListener('storage',storageChanged);
  return()=>{
   active=false;controller.abort();window.clearInterval(interval);
   window.removeEventListener('online',resume);
   window.removeEventListener('focus',resume);
   window.removeEventListener('veyra:mainnet:outbox',resume);
   window.removeEventListener('storage',storageChanged);
  };
 },[address,token,userId,walletKey,social.identityOrigin,social.session?.walletKey]);
 return null;
}
