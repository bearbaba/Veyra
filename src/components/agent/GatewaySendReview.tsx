/**
 * Reviewed Circle Gateway Testnet quote and explicitly wallet-signed spend.
 * The Circle SDK performs forwarding; a submitted transfer remains unresolved
 * until independently verified on destination.
 */
import {useEffect,useState} from 'react';
import {useAccount,useSwitchChain} from 'wagmi';
import {isAddress,parseUnits,type EIP1193Provider} from 'viem';
import {
 GATEWAY_TESTNET_SOURCES,fetchGatewayTestnetBalances,
} from '../../core/gateway/gatewayBalances';
import {activeSignedIdentityToken} from '../../lib/api/liveIdentitySession';
import {useUnifiedSocial} from '../../features/social/UnifiedSocial';
import {IS_UI_ONLY_PREVIEW,VEYRA_ENV} from '../../lib/env';
import {readGatewaySpendCheckpoint,prepareGatewaySpendCheckpoint,submitGatewaySdkSpend,estimateGatewaySdkFees,type GatewaySpendCheckpoint,type GatewaySdkFee} from '../../core/gateway/gatewaySdkSpend';

type Review={
 owner:string;recipient:string;destinationChainId:number;
 amount:string;readAt:number;sourceChainId:number;sdkFees:GatewaySdkFee[];
};
const DECIMAL=/^\d{1,18}(?:\.\d{1,6})?$/;
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
 const [forwardStatus,setForwardStatus]=useState<string|null>(null);
 const [forwardTxHash,setForwardTxHash]=useState<string|null>(null);
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
  setReview(null);setConfirmFees(false);setBusy(true);setError(null);
  try{
   if(!owner||!isAddress(owner)||!isAddress(recipient)||!DECIMAL.test(amount)||
      amount==='0')throw Error('Enter a valid EVM recipient and exact positive USDC amount.');
   const current=await fetchGatewayTestnetBalances(owner);
   const destination=GATEWAY_TESTNET_SOURCES.find(s=>s.chainId===destinationChainId);
   if(!destination)throw Error('Destination Testnet unsupported.');
   const sessionAtStart=activeSignedIdentityToken();
   if(!sessionAtStart)throw Error('Sign in again to review Gateway spending.');
   // Circle App Kit itself quotes the exact forwarding route. Do not require
   // the stale Render BFF low-level estimate endpoint for a browser-wallet send.
   // A single source must cover the amount; never fake a multi-source payout.
   const available=current.sources.filter(s=>s.available>=parseUnits(amount,6))
     .sort((a,b)=>a.available===b.available?a.domain-b.domain:
       a.available>b.available?-1:1);
   const source=available[0];
   if(!source){
    if(current.available>=parseUnits(amount,6))
     throw Error('Funds are spread across source chains. Multi-source signing is not yet available.');
    throw Error('Insufficient confirmed deposited USDC. Add funds first.');
   }
   if(!identityReady||!connector||!address||!identity)
    throw Error('Sign in with Veyra ID and connect your wallet to review forwarding fees.');
   await switchChainAsync({chainId:source.chainId});
   const raw:unknown=await connector.getProvider();
   if(!raw||typeof raw!=='object'||!('request' in raw)||
      typeof raw.request!=='function')
    throw Error('Your wallet provider cannot estimate Circle forwarding fees.');
   const checkpoint=prepareGatewaySpendCheckpoint({
    owner,identity,recipient,amount,sourceChainId:source.chainId,
    destinationChainId,
   });
   const sdkFees=await estimateGatewaySdkFees({
    checkpoint,provider:raw as EIP1193Provider,walletAddress:address,
    expectedSession:sessionAtStart,
   });
   if(activeSignedIdentityToken()!==sessionAtStart)
    throw Error('Your signed identity changed during fee review.');
   // Gateway protocol and source gas fees reduce deposited balance; the
   // forwarding fee is instead deducted from the recipient's minted USDC.
   const sourceFee=sdkFees.filter(f=>f.type==='provider'||f.type==='gasFee')
    .reduce((sum,fee)=>sum+parseUnits(
     fee.amount.startsWith('.')?'0'+fee.amount:fee.amount,6),0n);
   if(source.available<parseUnits(amount,6)+sourceFee)
    throw Error('Insufficient deposited USDC after source fees. Reduce the amount.');
   setReview({owner,recipient,destinationChainId,amount,readAt:Date.now(),
    sourceChainId:source.chainId,sdkFees});
  }catch(e){setError(e instanceof Error?e.message:'Gateway estimate unavailable.');}
  finally{setBusy(false);}
 }
 async function checkForwardingStatus(){
  if(!pending?.transferId||!address||!identity||busy)return;
  setBusy(true);setError(null);
  try{
   const token=activeSignedIdentityToken();
   if(!token||!identityReady)throw Error('Sign in to your existing Veyra ID first.');
   const query=new URLSearchParams({transferId:pending.transferId,walletAddress:address});
   const res=await fetch('/api/gateway/transfer-status?'+query.toString(),{
    headers:{Authorization:'Bearer '+token,Accept:'application/json'},
    credentials:'same-origin',cache:'no-store',
   });
   if(!res.ok)throw Error('Circle forwarding status unavailable. Do not resend.');
   const data:unknown=await res.json();
   if(!data||typeof data!=='object'||Array.isArray(data))
    throw Error('Invalid Circle status reply.');
   const result=data as Record<string,unknown>;
   if(result.ok!==true||result.transferId!==pending.transferId||
     result.settlementVerified!==false||typeof result.providerStatus!=='string')
    throw Error('Unverified Circle status. Do not resend.');
   setForwardStatus(result.providerStatus.slice(0,32));
   setForwardTxHash(typeof result.destinationTxHash==='string'&&
    /^0x[0-9a-fA-F]{64}$/.test(result.destinationTxHash)?result.destinationTxHash:null);
  }catch(e){setError(e instanceof Error?e.message:'Status unavailable.');}
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
   if(review.sdkFees.length===0)
    throw Error('Circle forwarding fees must be reviewed before signing.');
   const sourceChainId=review.sourceChainId;
   if(!connector)throw Error('Connect the signing wallet.');
   const session=activeSignedIdentityToken();
   if(!session)throw Error('Signed Veyra ID session required.');
   // This is an explicit user-initiated network change, not an auto-sign.
   await switchChainAsync({chainId:sourceChainId});
   if(Date.now()-review.readAt>=30_000)
    throw Error('Forwarding fees or the original quote expired during network switching. Review again.');
   const raw=await connector.getProvider();
   if(!raw||typeof raw!=='object'||!('request' in raw)||
     typeof raw.request!=='function')
    throw Error('The connected wallet cannot sign Circle requests.');
   const provider=raw as EIP1193Provider;
   const actualChain=await provider.request({method:'eth_chainId'});
   if(typeof actualChain!=='string'||Number.parseInt(actualChain,16)!==sourceChainId)
    throw Error('Wallet source network does not match the reviewed quote.');
   if(activeSignedIdentityToken()!==session)
    throw Error('Veyra signed session changed during network switch.');
   const checkpoint=prepareGatewaySpendCheckpoint({
    owner:address,identity,recipient:review.recipient,amount:review.amount,
    sourceChainId,destinationChainId:review.destinationChainId,
   });
   // The only money movement is via the user's on-screen wallet signature.
   // SDK results are not marked VERIFIED without chain receipt verification.
   const outcome=await submitGatewaySdkSpend({
    checkpoint,store:localStorage,provider,walletAddress:address,
    expectedSession:session,expectedChainId:sourceChainId,
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
     {forwardStatus&&<p>Circle status: {forwardStatus} (not yet independently verified)</p>}
     {forwardTxHash&&<p className="break-all">Reported destination tx: {forwardTxHash}</p>}
     {pending.transferId&&<button type="button" disabled={busy}
       onClick={()=>void checkForwardingStatus()}
       className="rounded-xl border px-3 py-2 disabled:opacity-50"
       style={{borderColor:'var(--border)'}}>Refresh transfer status</button>}
     <p>Pending transfer is saved for recovery. Submission is not destination settlement.</p>
   </div>}
   {verified&&review&&<div className="rounded-xl border p-3 space-y-2 text-xs"
      style={{borderColor:'var(--border)'}}>
     <p className="font-semibold" style={{color:'var(--ink)'}}>Quote preview · {review.amount} USDC</p>
     <p className="flex justify-between gap-2" style={{color:'var(--muted)'}}>
      <span>Deposited source: {GATEWAY_TESTNET_SOURCES.find(s=>s.chainId===review.sourceChainId)?.name}</span>
      <span>{review.amount} USDC</span>
     </p>
     {review.sdkFees.length>0&&<div className="rounded-lg border p-2 space-y-1"
       style={{borderColor:'var(--border)'}}>
       <p className="font-semibold">Estimated Circle SDK fees (USDC)</p>
       {review.sdkFees.map((fee,i)=><div key={fee.type+String(i)}
         className="flex justify-between gap-2" style={{color:'var(--muted)'}}>
         <span>{fee.type==='forwarder'?'Forwarding Service':fee.type==='gasFee'
           ?'Source gas':fee.type==='provider'?'Gateway protocol':'App fee'}</span>
         <span>{fee.amount} USDC</span>
       </div>)}
     </div>}
     <p style={{color:'var(--muted)'}}>Fees can vary with network conditions. Forwarding fees reduce USDC received; submission is not verified settlement.</p>
     <label className="flex items-start gap-2" style={{color:'var(--muted)'}}>
      <input type="checkbox" checked={confirmFees} onChange={e=>setConfirmFees(e.target.checked)}/>
      I confirm the source, recipient, amount and possible forwarder fees.
     </label>
     <button type="button"
      disabled={busy||!canSign||!confirmFees||Boolean(pending)||
       review.sdkFees.length===0}
      onClick={()=>void onConfirmAndSign()}
      className="rounded-xl border px-3 py-2 text-xs font-semibold disabled:opacity-50"
      style={{borderColor:'var(--border-strong)',color:'var(--ink)'}}>
      {busy?'Waiting for wallet…':canSign
       ?'Confirm and sign Unified Send':'Sign in on approved Testnet to send'}
     </button>
   </div>}
 </div>;
}
