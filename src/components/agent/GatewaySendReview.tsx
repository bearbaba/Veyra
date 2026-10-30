/**
 * Reviewed Circle Gateway Testnet quote and explicitly wallet-signed spend.
 * The Circle SDK performs forwarding; a submitted transfer remains unresolved
 * until independently verified on destination.
 */
import {useEffect,useState} from 'react';
import {useAccount,useSwitchChain} from 'wagmi';
import {formatUnits,isAddress,type EIP1193Provider} from 'viem';
import {
 GATEWAY_TESTNET_SOURCES,fetchGatewayTestnetBalances,
} from '../../core/gateway/gatewayBalances';
import {allocateGatewaySend,assertGatewayQuotedSpecMatches,type GatewayFeeQuote,type GatewayAllocation} from '../../core/gateway/gatewaySendPlan';
import {activeSignedIdentityToken} from '../../lib/api/liveIdentitySession';
import {useUnifiedSocial} from '../../features/social/UnifiedSocial';
import {IS_UI_ONLY_PREVIEW,VEYRA_ENV} from '../../lib/env';
import {gatewaySpendKey,readGatewaySpendCheckpoint,prepareGatewaySpendCheckpoint,submitGatewaySdkSpend,type GatewaySpendCheckpoint} from '../../core/gateway/gatewaySdkSpend';

type Review={
 owner:string;recipient:string;destinationChainId:number;
 amount:string;readAt:number;allocations:GatewayAllocation[];quotes:GatewayFeeQuote[];
};
const DECIMAL=/^\d{1,18}(?:\.\d{1,6})?$/;
function formatRaw(value:bigint){return formatUnits(value,6);}
async function quoteOne(owner:string,recipient:string,amount:string,sourceDomain:number,destinationDomain:number){
 const token=activeSignedIdentityToken();
 if(!token)throw Error('Sign in with your current Veyra ID to review Gateway spending.');
 const response=await fetch('/api/gateway/estimate',{
  method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},
  body:JSON.stringify({walletAddress:owner,recipientAddress:recipient,
   amount,sourceDomain,destinationDomain}),cache:'no-store',
 });
 if(!response.ok)throw Error(`Gateway source ${sourceDomain} fee estimate unavailable (HTTP ${response.status}). No transaction was signed.`);
 const json:unknown=await response.json();
 if(!json||typeof json!=='object'||Array.isArray(json))throw Error('Invalid Gateway estimate.');
 const b=json as Record<string,unknown>;
 if(b.ok!==true||b.sourceDomain!==sourceDomain||b.amount!==amount||
    typeof b.maxFee!=='string'||!/^(0|[1-9]\d*)$/.test(b.maxFee)||
    typeof b.maxBlockHeight!=='string'||!/^[1-9]\d*$/.test(b.maxBlockHeight)||
    typeof b.readAt!=='number'||Date.now()-b.readAt>30_000||b.readAt>Date.now()+5000)
  throw Error('Gateway quote could not be verified. No signature was requested.');
 // The server is a separate trust boundary. Verify every source/destination,
 // token, owner and recipient field again before retaining the quote.
 const maxFee=BigInt(b.maxFee),maxBlockHeight=BigInt(b.maxBlockHeight);
 const salt=assertGatewayQuotedSpecMatches({
   owner,recipient,amount,sourceDomain,destinationDomain,
 },b.spec,maxFee,maxBlockHeight);
 return {domain:sourceDomain,maxFee,maxBlockHeight,salt};
}

export function GatewaySendReview(){
 const {address,connector}=useAccount();
 const {switchChainAsync}=useSwitchChain();
 const social=useUnifiedSocial();
 const identity=social.session?.profile.veyraUserId??'';
 const identityReady=Boolean(identity&&social.identityOrigin==='ready'&&
  social.session?.walletKey===(address?.toLowerCase()??'')+':'+(connector?.uid??''));
 const [amount,setAmount]=useState('');
 const [recipient,setRecipient]=useState('');
 const [destinationChainId,setDestinationChainId]=useState<number>(GATEWAY_TESTNET_SOURCES[2].chainId);
 const [busy,setBusy]=useState(false);
 const [review,setReview]=useState<Review|null>(null);
 const [error,setError]=useState<string|null>(null);
 const [pending,setPending]=useState<GatewaySpendCheckpoint|null>(null);
 const [confirmFees,setConfirmFees]=useState(false);
 const canSign=VEYRA_ENV==='testnet'&&!IS_UI_ONLY_PREVIEW&&identityReady;
 useEffect(()=>{
  if(!address||!identity){setPending(null);return;}
  try{setPending(readGatewaySpendCheckpoint(localStorage,address,identity));}
  catch{setPending(null);}
 },[address,identity]);
 // A preview must expire even while the user leaves the page open. An old
 // provider fee or block height must never look valid after an idle period.
 useEffect(()=>{
  if(!review)return;
  const milliseconds=Math.max(0,review.readAt+30_000-Date.now());
  const timer=setTimeout(()=>setReview(prev=>prev?.readAt===review.readAt?null:prev),milliseconds);
  return ()=>clearTimeout(timer);
 },[review]);
 const owner=address?.toLowerCase()??'';
 const verified=review?.owner===owner&&review.recipient.toLowerCase()===recipient.toLowerCase()&&
  review.amount===amount&&review.destinationChainId===destinationChainId;
 async function onReview(){
  if(busy)return;
  setReview(null);setBusy(true);setError(null);
  try{
   if(!owner||!isAddress(owner)||!isAddress(recipient)||!DECIMAL.test(amount)||
      amount==='0')throw Error('Enter a valid EVM recipient and exact positive USDC amount.');
   const current=await fetchGatewayTestnetBalances(owner);
   const destination=GATEWAY_TESTNET_SOURCES.find(s=>s.chainId===destinationChainId);
   if(!destination)throw Error('Destination Testnet unsupported.');
   const sessionAtStart=activeSignedIdentityToken();
   if(!sessionAtStart)throw Error('Sign in again to review Gateway spending.');
   // First estimate the exact destination amount against each possible source
   // to choose available funds. Estimates cannot authorize a spend.
   const fundedSources=GATEWAY_TESTNET_SOURCES.filter(source=>
     current.sources.some(row=>row.domain===source.domain&&row.available>0n));
   if(fundedSources.length===0)
     throw Error('No verified Gateway USDC is available. Add funds before reviewing Send.');
   const sourceQuotes=await Promise.all(fundedSources.map(s=>
    quoteOne(owner,recipient,amount,s.domain,destination.domain)));
   const provisional=allocateGatewaySend({
    owner,recipient,destinationChainId,amount,snapshot:current,quotes:sourceQuotes,
   });
   // A multi-source plan splits the destination amount. Re-estimate each
   // actual partial amount; the first quote is NOT transferable to that amount.
   // Changed fee/expiry must never silently mutate what the user reviews.
   const exactQuotes=await Promise.all(provisional.map(p=>
    quoteOne(owner,recipient,formatRaw(p.value),p.domain,destination.domain)));
   const byDomain=new Map(exactQuotes.map(q=>[q.domain,q]));
   const exactAllocations=provisional.map(p=>({
     ...p,maxFee:byDomain.get(p.domain)?.maxFee??-1n,
   }));
   if(exactAllocations.some(p=>p.maxFee<0n||
      p.value+p.maxFee>(current.sources.find(s=>s.domain===p.domain)?.available??0n)))
     throw Error('Gateway fee changed after the split. Review the amount again.');
   if(activeSignedIdentityToken()!==sessionAtStart)
     throw Error('Your signed identity session changed. Review again.');
   // Prevent previously submitted requests from appearing as current reviews
   // after a wallet or amount change during asynchronous provider calls.
   setReview({owner,recipient,destinationChainId,amount,readAt:Date.now(),
     allocations:exactAllocations,quotes:exactQuotes});
  }catch(e){setError(e instanceof Error?e.message:'Gateway estimate unavailable.');}
  finally{setBusy(false);}
 }
 async function onConfirmAndSign(){
  if(busy||!verified||!review||!address||!identity||!connector)return;
  setBusy(true);setError(null);
  try{
   if(!canSign)throw Error('Sign in with Veyra ID on the authorized Testnet domain.');
   if(pending)throw Error('An earlier Unified Send remains unresolved. Inspect it first.');
   if(!confirmFees)throw Error('Confirm the selected network, recipient, and forwarder fees.');
   if(Date.now()-review.readAt>=30_000)
    throw Error('The Gateway quote expired. Review again.');
   if(review.allocations.length!==1)
    throw Error('This transfer uses multiple deposited source chains. Signing stays locked until the combined submission is supported.');
   const allocation=review.allocations[0];
   if(!connector)throw Error('Connect the signing wallet.');
   const session=activeSignedIdentityToken();
   if(!session)throw Error('Signed Veyra ID session required.');
   // This is an explicit user-initiated network change, not an auto-sign.
   await switchChainAsync({chainId:allocation.chainId});
   const raw=await connector.getProvider();
   if(!raw||typeof raw!=='object'||!('request' in raw)||
     typeof raw.request!=='function')
    throw Error('The connected wallet cannot sign Circle requests.');
   const provider=raw as EIP1193Provider;
   const actualChain=await provider.request({method:'eth_chainId'});
   if(typeof actualChain!=='string'||Number.parseInt(actualChain,16)!==allocation.chainId)
    throw Error('Wallet source network does not match the reviewed quote.');
   if(activeSignedIdentityToken()!==session)
    throw Error('Veyra signed session changed during network switch.');
   const checkpoint=prepareGatewaySpendCheckpoint({
    owner:address,identity,recipient:review.recipient,amount:review.amount,
    sourceChainId:allocation.chainId,destinationChainId:review.destinationChainId,
   });
   // The only money movement is via the user's on-screen wallet signature.
   // SDK results are not marked VERIFIED without chain receipt verification.
   const outcome=await submitGatewaySdkSpend({
    checkpoint,store:localStorage,provider,walletAddress:address,
    expectedSession:session,expectedChainId:allocation.chainId,
   });
   setPending(outcome);
   setReview(null);
  }catch(e){
   try{setPending(readGatewaySpendCheckpoint(localStorage,address,identity));}catch{/* no state fallback */}
   setError(e instanceof Error?e.message:'Unified Send outcome is unknown. Do not retry.');
  }finally{setBusy(false);}
 }
 return <div className="rounded-xl border p-3 space-y-3" style={{borderColor:'var(--border-strong)'}}
    aria-label="Review Circle Gateway Unified transfer">
   <p className="text-sm font-semibold" style={{color:'var(--ink)'}}>Review Unified Send</p>
   <p className="text-xs leading-5" style={{color:'var(--muted)'}}>
     Source: deposited Circle Gateway USDC, not wallet balances. A quote does not send or lock funds.
   </p>
   <label className="block text-xs" style={{color:'var(--muted)'}}>Destination network
    <select className="mt-1 w-full rounded-xl border p-2" value={destinationChainId}
     style={{background:'var(--surface)',color:'var(--ink)',borderColor:'var(--border)'}}
     onChange={e=>{setDestinationChainId(Number(e.target.value));setReview(null);}}>
     {GATEWAY_TESTNET_SOURCES.map(s=><option value={s.chainId} key={s.chainId}>{s.name}</option>)}
    </select>
   </label>
   <label className="block text-xs" style={{color:'var(--muted)'}}>Recipient wallet
    <input className="mt-1 w-full rounded-xl border p-2" value={recipient}
      placeholder="0x…" style={{background:'var(--surface)',color:'var(--ink)',borderColor:'var(--border)'}}
      onChange={e=>{setRecipient(e.target.value);setReview(null);}}/>
   </label>
   <label className="block text-xs" style={{color:'var(--muted)'}}>USDC amount
    <input className="mt-1 w-full rounded-xl border p-2" value={amount} inputMode="decimal"
      placeholder="0.00" style={{background:'var(--surface)',color:'var(--ink)',borderColor:'var(--border)'}}
      onChange={e=>{setAmount(e.target.value);setReview(null);}}/>
   </label>
   <button type="button" disabled={busy||!owner||Boolean(pending)} onClick={()=>void onReview()}
    className="rounded-xl border px-3 py-2 text-xs font-semibold disabled:opacity-40"
    style={{borderColor:'var(--border-strong)',color:'var(--ink)'}}>
    {busy?'Checking Gateway estimates…':'Review sources and fees'}
   </button>
   {error&&<p role="alert" className="text-xs" style={{color:'var(--warning)'}}>{error}</p>}
   {pending&&<div role="status" className="rounded-xl border p-3 text-xs space-y-1"
     style={{borderColor:'var(--warning)'}}>
     <p className="font-semibold">Unified Send pending verification — do not resend</p>
     <p>State: {pending.state.replace(/_/g,' ')}</p>
     <p>Source network: {GATEWAY_TESTNET_SOURCES.find(x=>x.chainId===pending.sourceChainId)?.name}</p>
     {pending.transferId&&<p>Circle transfer: {pending.transferId}</p>}
     {pending.txHash&&<p className="break-all">Transaction: {pending.txHash}</p>}
     <p>Pending transfer is saved for recovery. Submission is not destination settlement.</p>
   </div>}
   {verified&&review&&<div className="rounded-xl border p-3 space-y-2 text-xs"
      style={{borderColor:'var(--border)'}}>
     <p className="font-semibold" style={{color:'var(--ink)'}}>Quote preview · {review.amount} USDC</p>
     {review.allocations.map(allocation=><p key={allocation.domain} className="flex justify-between gap-2"
       style={{color:'var(--muted)'}}>
       <span>{GATEWAY_TESTNET_SOURCES.find(s=>s.domain===allocation.domain)?.name}</span>
       <span>{formatRaw(allocation.value)} USDC + max {formatRaw(allocation.maxFee)} USDC fee</span>
     </p>)}
     <p style={{color:'var(--muted)'}}>Circle Forwarding Service may deduct an additional fee from the recipient's USDC. Submission is not verified destination settlement.</p>
     <label className="flex items-start gap-2" style={{color:'var(--muted)'}}>
      <input type="checkbox" checked={confirmFees} onChange={e=>setConfirmFees(e.target.checked)}/>
      I confirm the source, recipient, amount and possible forwarder fees.
     </label>
     <button type="button"
      disabled={busy||!canSign||!confirmFees||Boolean(pending)||review.allocations.length!==1}
      onClick={()=>void onConfirmAndSign()}
      className="rounded-xl border px-3 py-2 text-xs font-semibold disabled:opacity-50"
      style={{borderColor:'var(--border-strong)',color:'var(--ink)'}}>
      {busy?'Waiting for wallet…':review.allocations.length!==1
       ?'Multi-source signing not available'
       :canSign?'Confirm and sign Unified Send':'Sign in on approved Testnet to send'}
     </button>
   </div>}
 </div>;
}
