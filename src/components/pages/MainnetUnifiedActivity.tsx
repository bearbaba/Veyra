/** Read-only Gateway reconciliation and preserved owner-scoped operation receipts.
 * Recheck never asks for signatures and never broadcasts another transaction.
 */
import {useEffect,useRef,useState} from 'react';
import {useAccount,usePublicClient} from 'wagmi';
import {Clock3,ExternalLink,RefreshCw} from 'lucide-react';
import {readGatewayMainnetHistory,readGatewayMainnetOperation,
 type GatewayMainnetReceipt,type GatewayMainnetOperation} from '@/mainnet/gatewayMainnetJournal';
import {reconcileGatewayMainnetOperation} from '@/mainnet/gatewayMainnetReconcile';
import {fetchGatewayMainnetBalances} from '@/mainnet/gatewayMainnetBalances';

const explorer=(chainId:number)=>chainId===1?'https://etherscan.io/tx/':
 chainId===8453?'https://basescan.org/tx/':'https://explorer.arc.io/tx/';
export function MainnetUnifiedActivity(){
 const {address}=useAccount();
 const arc=usePublicClient({chainId:5042}),base=usePublicClient({chainId:8453}),
  ethereum=usePublicClient({chainId:1});
 const [active,setActive]=useState<GatewayMainnetOperation|null|'blocked'>(null);
 const [history,setHistory]=useState<GatewayMainnetReceipt[]|'blocked'>([]);
 const [checking,setChecking]=useState(false);
 const [notice,setNotice]=useState('');
 const lock=useRef(false);
 const owner=address?.toLowerCase()??'';
 const refresh=()=>{
  if(!address){setActive(null);setHistory([]);return;}
  setActive(readGatewayMainnetOperation(address));
  setHistory(readGatewayMainnetHistory(address));
 };
 useEffect(()=>{
  refresh();
  window.addEventListener('focus',refresh);
  window.addEventListener('storage',refresh);
  window.addEventListener('veyra:gateway:mainnet',refresh);
  return()=>{window.removeEventListener('focus',refresh);
   window.removeEventListener('storage',refresh);
   window.removeEventListener('veyra:gateway:mainnet',refresh);};
  // only owner-bound observers; no dependency on render-generated refresh function
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[address]);
 async function checkOriginal(){
  if(!address||!active||active==='blocked'||lock.current)return;
  lock.current=true;setChecking(true);setNotice('');
  try{
   const network=(id:number)=>id===5042?arc:id===8453?base:id===1?ethereum:undefined;
   const outcome=await reconcileGatewayMainnetOperation(address,{
    getTransaction:async(id,hash)=>{
     const client=network(id);
     if(!client)throw Error('Original source RPC is unavailable.');
     return client.getTransaction({hash});
    },
    getTransactionReceipt:async(id,hash)=>{
     const client=network(id);
     if(!client)throw Error('Original transaction network is unavailable.');
     return client.getTransactionReceipt({hash});
    },
    getConfirmedBalances:fetchGatewayMainnetBalances,
    getForwardingStatus:async(transferId)=>{
     const response=await fetch('https://gateway-api.circle.com/v1/transfer/'+
      encodeURIComponent(transferId),{
      method:'GET',headers:{Accept:'application/json'},
      cache:'no-store',signal:AbortSignal.timeout(12000),
     });
     if(!response.ok)throw Error('Circle Gateway forwarding status is unavailable. Original transfer remains locked.');
     const payload:unknown=await response.json();return payload;
    },
   });
   setNotice(outcome.reason);
   refresh();
  }catch(error){
   setNotice((error instanceof Error?error.message:'Recovery network unavailable.')+
    ' Original transfer remains locked; do not sign again.');
  }finally{lock.current=false;setChecking(false);}
 }
 if(!active&&(history==='blocked'||history.length===0))return null;
 return <section aria-label="Unified operation history" className="veyra-card space-y-3 p-4">
  <div className="flex flex-wrap items-center justify-between gap-2">
   <h2 className="text-sm font-bold" style={{color:'var(--ink)'}}>Unified Activity</h2>
   <span className="text-xs" style={{color:'var(--muted)'}}>Saved on this device</span>
  </div>
  {active&&<div className="rounded-xl border p-3" style={{borderColor:'var(--border)'}}>
   {active==='blocked'?<p role="alert" className="text-sm" style={{color:'var(--warning)'}}>
    Previous Unified checkpoint is unreadable. No new signature is permitted.
   </p>:<>
    <p className="flex items-center gap-2 text-sm font-semibold" style={{color:'var(--ink)'}}>
     <Clock3 className="size-4" style={{color:'var(--warning)'}}/>
     {active.kind==='deposit'?'Unified deposit':'Unified transfer'} · Unverified
    </p>
    <p className="mt-1 text-xs" style={{color:'var(--muted)'}}>
     {active.amount} USDC · {active.chainId===5042?'Arc':active.chainId===8453?'Base':'Ethereum'}
     {' · '}{active.status==='UNKNOWN'?'Wallet outcome unknown':'Waiting for independent verification'}
    </p>
    <button type="button" disabled={checking} onClick={()=>void checkOriginal()}
     className="veyra-btn-secondary mt-3 inline-flex min-h-10 items-center gap-2 rounded-xl px-3 text-xs disabled:opacity-50">
     <RefreshCw className={'size-4 '+(checking?'animate-spin':'')}/>
     {checking?'Checking original…':'Recheck original · no signature'}
    </button>
    <details className="mt-3 text-xs" style={{color:'var(--muted)'}}>
     <summary className="cursor-pointer">Details · original request</summary>
     <div className="mt-2 space-y-1 break-all">
      <p>Owner: {owner}</p><p>Recipient: {active.recipient}</p>
      {active.sourceHash&&<a className="inline-flex items-center gap-1 underline"
       href={explorer(active.chainId)+active.sourceHash} rel="noreferrer" target="_blank">
       <ExternalLink className="size-3"/>Source transaction {active.sourceHash}</a>}
      {active.transferId&&<p>Circle transfer reference: {active.transferId}</p>}
     </div>
    </details>
   </>}
  </div>}
  {notice&&<p role="status" className="text-xs" style={{color:'var(--muted)'}}>{notice}</p>}
  {history==='blocked'?<p role="alert" className="text-xs" style={{color:'var(--warning)'}}>
   Unified history is unreadable. Signing remains blocked until safely recovered.
  </p>:history.map(receipt=><div key={receipt.operationId} className="rounded-xl border p-3"
   style={{borderColor:'var(--border)',color:'var(--ink)'}}>
   <p className="text-sm font-semibold">
    {receipt.kind==='deposit'?'Unified deposit':'Unified transfer'} · {receipt.status==='VERIFIED'?'Verified':'Reverted'}
   </p>
   <p className="mt-1 text-xs" style={{color:'var(--muted)'}}>
    {receipt.amount} USDC · {new Date(receipt.verifiedAt).toLocaleString()}
   </p>
   <details className="mt-2 text-xs" style={{color:'var(--muted)'}}>
    <summary className="cursor-pointer">Verified evidence</summary>
    <div className="mt-2 space-y-1 break-all">
     {receipt.sourceHash&&<a href={explorer(receipt.chainId)+receipt.sourceHash} target="_blank"
      rel="noreferrer" className="block underline">Source: {receipt.sourceHash}</a>}
     {receipt.destinationHash&&receipt.destinationChainId&&<a href={explorer(receipt.destinationChainId)+receipt.destinationHash}
      target="_blank" rel="noreferrer" className="block underline">Destination: {receipt.destinationHash}</a>}
     {receipt.gatewayConfirmedAfter&&<p>Gateway confirmed credit: {receipt.gatewayConfirmedAfter} USDC</p>}
     {receipt.received&&<p>Recipient received: {receipt.received} USDC</p>}
     <p>Verified at: {new Date(receipt.verifiedAt).toISOString()}</p>
    </div>
   </details>
  </div>)}
  <p className="text-xs leading-5" style={{color:'var(--muted)'}}>
   This browser history does not sync across devices. Circle SDK submission and source approval are not destination settlement. Recheck never resends funds.
  </p>
 </section>;
}
