/** Passive in-page recovery for one Unified → Settlement Pay journey.
 * No signing, no transfer POST, no wallet prompt and no automatic resends.
 * The exact original Circle transfer and destination ERC20 receipt are
 * independently verified by gatewayMainnetReconcile before unlocking Pay.
 */
import {useEffect} from 'react';
import {useAccount,usePublicClient} from 'wagmi';
import {readPayFundingJourney} from './payFundingJourney';
import {readGatewayMainnetOperation} from './gatewayMainnetJournal';
import {reconcileGatewayMainnetOperation} from './gatewayMainnetReconcile';
import {fetchGatewayForwardingProof} from './gatewayMainnetProviderRead';

export function MainnetPayFundingRecoveryWorker(){
 const {address}=useAccount();
 const arc=usePublicClient({chainId:5042});
 const base=usePublicClient({chainId:8453});
 const ethereum=usePublicClient({chainId:1});
 useEffect(()=>{
  if(!address||!arc||!base||!ethereum)return;
  const owner=address;
  let live=true,checking=false;
  const network=(chainId:number)=>
   chainId===5042?arc:chainId===8453?base:chainId===1?ethereum:undefined;
  async function checkOriginal(){
   if(!live||checking||document.visibilityState!=='visible')return;
   const saved=readPayFundingJourney(owner);
   const op=readGatewayMainnetOperation(owner);
   if(saved.kind!=='active'||!op||op==='blocked'||op.payJourneyId!==saved.value.id)return;
   checking=true;
   try{
    await reconcileGatewayMainnetOperation(owner,{
     getTransaction:async(chainId,hash)=>{
      const c=network(chainId);if(!c)throw Error('Network unavailable.');
      return c.getTransaction({hash});
     },
     getTransactionReceipt:async(chainId,hash)=>{
      const c=network(chainId);if(!c)throw Error('Network unavailable.');
      return c.getTransactionReceipt({hash});
     },
     getCanonicalBlock:async(chainId,blockNumber)=>{
      const c=network(chainId);if(!c)throw Error('Network unavailable.');
      const b=await c.getBlock({blockNumber});
      if(b.hash===null||b.number===null)throw Error('Canonical block unavailable.');
      return {number:b.number,hash:b.hash,timestamp:b.timestamp};
     },
     getFinalizedBlock:async(chainId)=>{
      const c=network(chainId);if(!c)throw Error('Network unavailable.');
      const b=await c.getBlock({blockTag:'finalized'});
      if(b.hash===null||b.number===null)throw Error('Finalized head unavailable.');
      return {number:b.number,hash:b.hash,timestamp:b.timestamp};
     },
     getLatestBlockNumber:async(chainId)=>{
      const c=network(chainId);if(!c)throw Error('Network unavailable.');
      return c.getBlockNumber();
     },
     getForwardingStatus:fetchGatewayForwardingProof,
    });
   }catch{
    // Missing provider proof, timeout, RPC ambiguity or network failure:
    // retain the exact original journal lock; never restart a payment.
   }finally{checking=false;}
  }
  void checkOriginal();
  const onFocus=()=>{void checkOriginal();};
  const onVisible=()=>{if(document.visibilityState==='visible')void checkOriginal();};
  const interval=window.setInterval(()=>{void checkOriginal();},25000);
  window.addEventListener('focus',onFocus);
  document.addEventListener('visibilitychange',onVisible);
  return()=>{
   live=false;window.clearInterval(interval);
   window.removeEventListener('focus',onFocus);
   document.removeEventListener('visibilitychange',onVisible);
  };
 },[address,arc,base,ethereum]);
 return null;
}
