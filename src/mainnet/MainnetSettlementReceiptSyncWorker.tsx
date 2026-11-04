/** Read-only account sync for already onchain-verified contract payments.
 * Never reconstructs or resubmits wallet requests. Never auto-uploads notes
 * or mutable contact labels from an old device/user after wallet rotation.
 */
import {useEffect,useRef} from 'react';
import {useAccount} from 'wagmi';
import {useUnifiedSocial} from '@/features/social/UnifiedSocial';
import {isMainnetSessionForWallet} from './signedWalletReceiptScope';
import {readLocalOperations,type LocalOperation} from './localOperations';
import {MainnetReceiptSyncError} from '@/lib/api/mainnetPayReceipts';
import {saveVerifiedMainnetSettlementReceipt,
 type MainnetSettlementServerReceipt} from '@/lib/api/mainnetSettlementReceipts';

const INTERVAL_MS=25_000,RETRY_MS=5*60_000;
export type SettlementSyncOutcome='empty'|'synced'|'retry'|'sign-in'|'wrong-account';
export async function syncVerifiedSettlementOnce(args:{
 owner:string;userId:string;token:string;now:number;signal:AbortSignal;
 entries:readonly LocalOperation[];attempted:Map<string,number>;
 submit:(token:string,payload:{hash:string},signal:AbortSignal)=>Promise<MainnetSettlementServerReceipt>;
}):Promise<SettlementSyncOutcome>{
 const {owner,token,userId,now,signal,entries,attempted,submit}=args;
 if(signal.aborted||!token||!userId)return 'sign-in';
 const pending=entries.filter(v=>v.type==='Settlement'&&v.chainId===5042&&
  v.owner.toLowerCase()===owner.toLowerCase()&&v.status==='RECORDED'&&
  (attempted.get(v.hash.toLowerCase())??0)<=now);
 const item=pending[0];
 if(!item)return 'empty';
 const hash=item.hash.toLowerCase();
 attempted.set(hash,now+RETRY_MS);
 try{
  // The server independently checks original calldata, Settlement event,
  // canonical block/finality and both token Transfer logs.
  const receipt=await submit(token,{hash},signal);
  if(signal.aborted)return 'empty';
  if(receipt.kind!=='settlement'||receipt.txHash.toLowerCase()!==hash||
   receipt.senderAddress.toLowerCase()!==owner.toLowerCase()||
   receipt.senderUserId!==userId||receipt.direction!=='sent')
   return 'wrong-account';
  attempted.set(hash,Number.MAX_SAFE_INTEGER);
  try{window.dispatchEvent(new Event('veyra:mainnet:server-receipt'));}catch{/* no display */ }
  return 'synced';
 }catch(e){
  if(signal.aborted)return 'empty';
  if(e instanceof MainnetReceiptSyncError&&e.failure==='sign-in')return 'sign-in';
  if(e instanceof MainnetReceiptSyncError&&e.failure==='review')
   attempted.set(hash,Number.MAX_SAFE_INTEGER);
  return 'retry';
 }
}
export function MainnetSettlementReceiptSyncWorker(){
 const {address,connector}=useAccount();
 const social=useUnifiedSocial();
 const token=social.session?.token;
 const userId=social.session?.profile.veyraUserId;
 const signed=isMainnetSessionForWallet(social.session,address,connector?.uid)&&
  social.identityOrigin==='ready';
 const current=useRef(false);
 useEffect(()=>{
  if(!address||!signed||!token||!userId)return;
  const owner=address,controller=new AbortController();
  const attempted=new Map<string,number>();
  let live=true,authBlocked=false;
  async function tick(){
   if(!live||current.current||authBlocked)return;
   current.current=true;
   try{
    const result=await syncVerifiedSettlementOnce({
     owner,userId:userId!,token:token!,now:Date.now(),signal:controller.signal,
     entries:readLocalOperations(owner),attempted,
     submit:(session,payload,signal)=>saveVerifiedMainnetSettlementReceipt(session,payload,signal),
    });
    if(result==='sign-in')authBlocked=true;
   }catch{/* Database unready, offline or local storage inaccessible; no financial action. */}
   finally{current.current=false;}
  }
  void tick();
  const interval=window.setInterval(()=>void tick(),INTERVAL_MS);
  const resume=()=>void tick();
  window.addEventListener('online',resume);
  window.addEventListener('focus',resume);
  window.addEventListener('veyra:mainnet:operation',resume);
  return()=>{
   live=false;controller.abort();window.clearInterval(interval);
   window.removeEventListener('online',resume);
   window.removeEventListener('focus',resume);
   window.removeEventListener('veyra:mainnet:operation',resume);
  };
 },[address,connector?.uid,token,userId,signed]);
 return null;
}
