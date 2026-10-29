/**
 * Preview a real Circle Gateway multi-domain quote without authorizing a burn.
 * No bridge, swap, wallet send or signing fallback is permitted from this view.
 * A preview cannot be represented as a spendable quote or completed transfer.
 */
import {useState} from 'react';
import {useAccount} from 'wagmi';
import {formatUnits,isAddress} from 'viem';
import {
 GATEWAY_TESTNET_SOURCES,fetchGatewayTestnetBalances,
} from '../../core/gateway/gatewayBalances';
import {allocateGatewaySend,type GatewayFeeQuote,type GatewayAllocation} from '../../core/gateway/gatewaySendPlan';
import {activeSignedIdentityToken} from '../../lib/api/liveIdentitySession';

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
 return {domain:sourceDomain,maxFee:BigInt(b.maxFee),maxBlockHeight:BigInt(b.maxBlockHeight)};
}

export function GatewaySendReview(){
 const {address}=useAccount();
 const [amount,setAmount]=useState('');
 const [recipient,setRecipient]=useState('');
 const [destinationChainId,setDestinationChainId]=useState<number>(GATEWAY_TESTNET_SOURCES[2].chainId);
 const [busy,setBusy]=useState(false);
 const [review,setReview]=useState<Review|null>(null);
 const [error,setError]=useState<string|null>(null);
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
   const sourceQuotes=await Promise.all(GATEWAY_TESTNET_SOURCES.map(s=>
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
   <button type="button" disabled={busy||!owner} onClick={()=>void onReview()}
    className="rounded-xl border px-3 py-2 text-xs font-semibold disabled:opacity-40"
    style={{borderColor:'var(--border-strong)',color:'var(--ink)'}}>
    {busy?'Checking Gateway estimates…':'Review sources and fees'}
   </button>
   {error&&<p role="alert" className="text-xs" style={{color:'var(--warning)'}}>{error}</p>}
   {verified&&review&&<div className="rounded-xl border p-3 space-y-2 text-xs"
      style={{borderColor:'var(--border)'}}>
     <p className="font-semibold" style={{color:'var(--ink)'}}>Quote preview · {review.amount} USDC</p>
     {review.allocations.map(allocation=><p key={allocation.domain} className="flex justify-between gap-2"
       style={{color:'var(--muted)'}}>
       <span>{GATEWAY_TESTNET_SOURCES.find(s=>s.domain===allocation.domain)?.name}</span>
       <span>{formatRaw(allocation.value)} USDC + max {formatRaw(allocation.maxFee)} USDC fee</span>
     </p>)}
     <p style={{color:'var(--muted)'}}>The source allocations are informational until EIP-712 signing, Gateway attestation and destination mint are verified.</p>
     <button type="button" disabled className="rounded-xl border px-3 py-2 text-xs opacity-50"
      title="Signing is locked until the owner-bound burn/attestation/mint recovery pipeline passes signed Testnet E2E."
      style={{borderColor:'var(--border)',color:'var(--muted)'}}>Confirm & sign · locked pending E2E</button>
   </div>}
 </div>;
}
