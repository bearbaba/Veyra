/** Source/destination recovery is read-only: no wallet prompt, no resubmission.
 * On mount, focus and tab return, inspect the ORIGINAL transaction.
 */
import {useEffect,useRef,useState} from 'react';
import {useAccount,usePublicClient} from 'wagmi';
import {Clock3,ExternalLink} from 'lucide-react';
import {readGatewayMainnetHistory,readGatewayMainnetOperation,
 type GatewayMainnetReceipt,type GatewayMainnetOperation} from '@/mainnet/gatewayMainnetJournal';
import {reconcileGatewayMainnetOperation} from '@/mainnet/gatewayMainnetReconcile';
import {fetchGatewayForwardingProof} from '@/mainnet/gatewayMainnetProviderRead';
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
 const visibleLimit=useRef(100);
 const [hasOlder,setHasOlder]=useState(false);
 const lock=useRef(false);
 const checkRef=useRef<()=>Promise<void>>(()=>Promise.resolve());
 const owner=address?.toLowerCase()??'';
 const activeId=active&&active!=='blocked'?active.id:'';
 const refresh=()=>{
  if(!address){setActive(null);setHistory([]);setHasOlder(false);return;}
  setActive(readGatewayMainnetOperation(address));
  const limit=visibleLimit.current;
  const entries=readGatewayMainnetHistory(address,undefined,limit+1);
  setHistory(entries==='blocked'?'blocked':entries.slice(0,limit));
  setHasOlder(entries!=='blocked'&&entries.length>limit);
 };
 async function checkOriginal(){
  if(!address||!active||active==='blocked'||lock.current)return;
  lock.current=true;setChecking(true);setNotice('');
  try{
   const network=(id:number)=>id===5042?arc:id===8453?base:id===1?ethereum:undefined;
   const outcome=await reconcileGatewayMainnetOperation(address,{
    getTransaction:async(id,hash)=>{
     const client=network(id);if(!client)throw Error('Source RPC unavailable.');
     return client.getTransaction({hash});
    },
    getTransactionReceipt:async(id,hash)=>{
     const client=network(id);if(!client)throw Error('Receipt RPC unavailable.');
     return client.getTransactionReceipt({hash});
    },
    getCanonicalBlock:async(id,blockNumber)=>{
     const client=network(id);if(!client)throw Error('Canonical block RPC unavailable.');
     const block=await client.getBlock({blockNumber});
     if(block.hash===null||block.number===null)throw Error('Canonical block hash unavailable.');
     return {number:block.number,hash:block.hash,timestamp:block.timestamp};
    },
    getFinalizedBlock:async(id)=>{
     const client=network(id);if(!client)throw Error('Finalized chain head RPC unavailable.');
     const block=await client.getBlock({blockTag:'finalized'});
     if(block.hash===null||block.number===null)throw Error('Finalized block cannot be verified.');
     return {number:block.number,hash:block.hash,timestamp:block.timestamp};
    },
    getLatestBlockNumber:async(id)=>{
     const client=network(id);if(!client)throw Error('Latest chain height RPC unavailable.');
     return client.getBlockNumber();
    },
    // Circle's GET transfer and transferSpec endpoints are officially documented.
    // An individual deposit-credit-by-source-tx endpoint is NOT; deposit
    // remains SOURCE_CONFIRMED until a trustworthy identity-bound API exists.
    getForwardingStatus:fetchGatewayForwardingProof,
   });
   setNotice(outcome.reason);
   refresh();
  }catch(e){
   setNotice((e instanceof Error?e.message:'Read-only verification unavailable.')+
    ' Original transaction remains pending; no new signature requested.');
  }finally{lock.current=false;setChecking(false);}
 }
 checkRef.current=checkOriginal;
 useEffect(()=>{
  visibleLimit.current=100;
  refresh();
  const onFocus=()=>{refresh();if(document.visibilityState==='visible')void checkRef.current();};
  const onVisible=()=>{if(document.visibilityState==='visible')onFocus();};
  const onStorage=()=>refresh();
  window.addEventListener('focus',onFocus);
  window.addEventListener('storage',onStorage);
  window.addEventListener('veyra:gateway:mainnet',onStorage);
  document.addEventListener('visibilitychange',onVisible);
  return()=>{
   window.removeEventListener('focus',onFocus);
   window.removeEventListener('storage',onStorage);
   window.removeEventListener('veyra:gateway:mainnet',onStorage);
   document.removeEventListener('visibilitychange',onVisible);
  };
  // depends on the owner; checkRef always points to the latest callback.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[address]);
 // No manual TX verification: automatically check only the original operation.
 // Read-only, 45s cadence while open; the reconciliation lock prevents overlap.
 useEffect(()=>{
  if(!activeId)return;
  if(document.visibilityState==='visible')void checkRef.current();
  const timer=window.setInterval(()=>{
   if(document.visibilityState==='visible')void checkRef.current();
  },45000);
  return()=>window.clearInterval(timer);
 },[activeId]);
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
     {active.kind==='deposit'?'Unified deposit':'Unified transfer'} · Pending
    </p>
    <p className="mt-1 text-xs" style={{color:'var(--muted)'}}>
     {active.amount} USDC · {active.chainId===5042?'Arc':active.chainId===8453?'Base':'Ethereum'}
     {' · '}{active.status==='SOURCE_CONFIRMED'?'Deposit confirmed · credit pending':
      active.status==='UNKNOWN'?'Wallet outcome unknown':'Waiting for independent verification'}
    </p>
    <p role="status" className="mt-2 text-xs" style={{color:'var(--muted)'}}>
     {checking?'Checking the original transaction automatically…':
      'Veyra automatically verifies the original receipt while Activity is open and whenever you return.'}
     No transaction ID or manual verification is needed.
    </p>
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
  </p>:<div className="divide-y" style={{borderColor:'var(--border)'}}>
   {history.map(receipt=>{
    const finalizedDeposit=receipt.kind==='deposit'&&receipt.status==='SOURCE_FINALIZED';
    const legacyCredit=receipt.kind==='deposit'&&receipt.status==='VERIFIED'&&!receipt.gatewayCreditReference;
    const status=finalizedDeposit?'Deposit confirmed':legacyCredit?'Credit needs review':
     receipt.status==='VERIFIED'?'Verified':
     receipt.status==='REVERTED'?'Reverted':'Cancelled';
    return <article key={receipt.operationId} aria-label="Unified receipt"
     className="py-3 first:pt-0 last:pb-0">
     <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
      <div className="min-w-0">
       <p className="text-sm font-semibold" style={{color:'var(--ink)'}}>
        {receipt.kind==='deposit'?'Deposit to Unified':'Unified transfer'} · {receipt.amount} USDC
       </p>
       <p className="mt-1 text-[11px]" style={{color:'var(--muted)'}}>
        {new Date(receipt.verifiedAt).toLocaleString()} · {
         receipt.chainId===5042?'Arc':receipt.chainId===8453?'Base':'Ethereum'}
       </p>
      </div>
      <span className="inline-flex shrink-0 items-center gap-1.5 text-[11px] font-semibold"
       style={{color:finalizedDeposit?'var(--success)':
        receipt.status==='VERIFIED'&&!legacyCredit?'var(--success)':
        'var(--warning)'}}>
       <span className="size-1.5 rounded-full bg-current" aria-hidden="true"/>
       {status}
      </span>
     </div>
     {finalizedDeposit&&<p className="mt-2 max-w-[65ch] text-xs leading-5"
      style={{color:'var(--muted)'}}>
      Deposit confirmed onchain. Circle Available is read separately; this deposit's
      individual Gateway credit has not been attributed.
     </p>}
     {legacyCredit&&<p className="mt-2 text-xs" style={{color:'var(--muted)'}}>
      Historical balance evidence is not an individual Circle credit receipt.
     </p>}
     <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
      {receipt.sourceHash&&<a href={explorer(receipt.chainId)+receipt.sourceHash}
       target="_blank" rel="noreferrer"
       className="inline-flex items-center gap-1 font-semibold hover:underline"
       style={{color:'var(--accent)'}}>
       View source <ExternalLink className="size-3" aria-hidden="true"/>
      </a>}
      <details style={{color:'var(--muted)'}}>
       <summary className="cursor-pointer hover:underline">Receipt details</summary>
       <div className="mt-2 space-y-1.5 break-all text-[11px]">
        {receipt.sourceHash&&<p>Source transaction: {receipt.sourceHash}</p>}
        {receipt.destinationHash&&receipt.destinationChainId&&<a
         href={explorer(receipt.destinationChainId)+receipt.destinationHash}
         target="_blank" rel="noreferrer" className="block underline">
         Destination: {receipt.destinationHash}</a>}
        {receipt.gatewayCreditReference&&<p>Circle credit reference: {receipt.gatewayCreditReference}</p>}
        {receipt.received&&<p>Recipient received: {receipt.received} USDC</p>}
        <p>Recorded: {new Date(receipt.verifiedAt).toISOString()}</p>
       </div>
      </details>
     </div>
    </article>;
   })}
  </div>}
  {history!=='blocked'&&hasOlder&&<button type="button"
   className="veyra-btn-secondary min-h-10 w-full rounded-xl px-3 text-xs"
   onClick={()=>{if(!address)return;const next=Math.min(visibleLimit.current+100,9900);
    const entries=readGatewayMainnetHistory(address,undefined,next+1);
    if(entries==='blocked'){setHistory('blocked');setHasOlder(false);return;}
    setHistory(entries.slice(0,next));setHasOlder(entries.length>next);visibleLimit.current=next;}}>
   Load older
  </button>}
  <p className="text-xs leading-5" style={{color:'var(--muted)'}}>
   History on this device. Circle's current Available balance is read separately;
   a finalized source deposit does not, by itself, establish individual Gateway credit.
  </p>
 </section>;
}
