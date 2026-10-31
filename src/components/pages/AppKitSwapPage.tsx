/**
 * Arc Testnet permissionless Circle App Kit Swap.
 * Single owner-reviewed route; only a real onchain receipt earns VERIFIED.
 * Does not use StableFX, custody a private key, or change Mainnet.
 */
import {useEffect,useRef,useState} from 'react';
import {AppKit} from '@circle-fin/app-kit';
import {createViemAdapterFromProvider} from '@circle-fin/adapter-viem-v2';
import {useAccount,usePublicClient,useSwitchChain} from 'wagmi';
import {parseUnits,type EIP1193Provider,type Hash} from 'viem';
import {useUnifiedSocial} from '../../features/social/UnifiedSocial';
import {activeSignedIdentityToken} from '../../lib/api/liveIdentitySession';
import {IS_UI_ONLY_PREVIEW,VEYRA_ENV} from '../../lib/env';
import {
 ARC_SWAP_CHAIN_ID,ARC_SWAP_TOKENS,
 arcSwapKey,arcSwapAmount,assertArcSwapWallet,assertArcSwapSession,
 readArcSwapCheckpoint,prepareArcSwapCheckpoint,verifyArcSwapReceipt,
 type ArcSwapAsset,type ArcSwapCheckpoint,type ArcSwapReceipt,
} from '../../core/swap/arcAppKitSwap';
import type {IntentCandidate} from '../../core/intent/intentSchema';

const kit=new AppKit();
const TTL=30_000;
type Quote={owner:string;identity:string;from:ArcSwapAsset;to:ArcSwapAsset;
 amount:string;readAt:number;minReceive:string;estimated:string;fees:string[]};
const swapParams=(adapter:Awaited<ReturnType<typeof createViemAdapterFromProvider>>,
 from:ArcSwapAsset,to:ArcSwapAsset,amount:string)=>({
 from:{adapter,chain:'Arc_Testnet' as const},
 tokenIn:from,tokenOut:to,amountIn:amount,
 config:{slippageBps:100},
});
const ERC20_BALANCE_ABI=[{type:'function',name:'balanceOf',stateMutability:'view',
 inputs:[{name:'owner',type:'address'}],outputs:[{name:'balance',type:'uint256'}]}] as const;

export function AppKitSwapPage({embedded=false,initialIntent=null}:{
 embedded?:boolean;initialIntent?:IntentCandidate|null;
}={}){
 const {address,connector}=useAccount();
 const {switchChainAsync}=useSwitchChain();
 const arc=usePublicClient({chainId:ARC_SWAP_CHAIN_ID});
 const social=useUnifiedSocial();
 const identity=social.session?.profile.veyraUserId??'';
 const identityReady=Boolean(identity&&social.identityOrigin==='ready'&&
  social.session?.walletKey===(address?.toLowerCase()??'')+':'+(connector?.uid??''));
 const originalFrom=initialIntent?.tokenRaw?.raw.trim().toUpperCase();
 const originalTo=initialIntent?.targetTokenRaw?.raw.trim().toUpperCase();
 const validIntent=!initialIntent||((originalFrom==='USDC'&&originalTo==='EURC')||
  (originalFrom==='EURC'&&originalTo==='USDC'));
 const [from,setFrom]=useState<ArcSwapAsset>(originalFrom==='EURC'?'EURC':'USDC');
 const to:ArcSwapAsset=from==='USDC'?'EURC':'USDC';
 const [amount,setAmount]=useState(initialIntent?.amountRaw?.raw.trim()??'');
 const [quote,setQuote]=useState<Quote|null>(null);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState<string|null>(null);
 const [pending,setPending]=useState<ArcSwapCheckpoint|null>(null);
 const [verified,setVerified]=useState<ArcSwapReceipt|null>(null);
 const [hashInput,setHashInput]=useState('');
 const inFlight=useRef(false);
 const signingAllowed=VEYRA_ENV==='testnet'&&!IS_UI_ONLY_PREVIEW&&identityReady;
 const owner=address?.toLowerCase()??'';
 useEffect(()=>{
  setQuote(null);setVerified(null);setHashInput('');setError(null);
  if(!address||!identity){setPending(null);return;}
  setPending(readArcSwapCheckpoint(localStorage,address,identity));
 },[address,identity]);
 useEffect(()=>{
  if(!quote)return;
  const timer=setTimeout(()=>setQuote(x=>x?.readAt===quote.readAt?null:x),
    Math.max(0,quote.readAt+TTL-Date.now()));
  return ()=>clearTimeout(timer);
 },[quote]);
 async function currentProvider():Promise<EIP1193Provider>{
  if(!connector||!address)throw Error('Connect your Veyra wallet.');
  await switchChainAsync({chainId:ARC_SWAP_CHAIN_ID});
  const value:unknown=await connector.getProvider();
  if(!value||typeof value!=='object'||!('request' in value)||
    typeof value.request!=='function')throw Error('Browser wallet is unavailable.');
  const provider=value as EIP1193Provider;
  await assertArcSwapWallet(provider,address);
  return provider;
 }
 async function review(){
  if(inFlight.current)return;
  inFlight.current=true;setBusy(true);setError(null);setQuote(null);
  try{
   if(!validIntent)throw Error('Unsupported Agent Swap pair. Review USDC and EURC.');
   if(!signingAllowed||!address||!identity)
    throw Error('Sign in to Veyra ID on the approved Testnet website.');
   if(pending||localStorage.getItem(arcSwapKey(address,identity)))
    throw Error('A previous Swap must be reconciled before requesting another.');
   arcSwapAmount(amount);
   const session=activeSignedIdentityToken();
   if(!session)throw Error('Signed Veyra ID session required.');
   const provider=await currentProvider();
   const adapter=await createViemAdapterFromProvider({provider});
   await assertArcSwapWallet(provider,address);assertArcSwapSession(session);
   if(!arc||await arc.getChainId()!==ARC_SWAP_CHAIN_ID)
    throw Error('Arc Testnet read-only RPC is unavailable.');
   const balance=await arc.readContract({address:ARC_SWAP_TOKENS[from],
    abi:ERC20_BALANCE_ABI,functionName:'balanceOf',args:[address]});
   if(balance<parseUnits(amount,6))
    throw Error('Insufficient wallet token balance (separate from Gateway Unified Balance).');
   const estimate=await kit.estimateSwap(swapParams(adapter,from,to,amount));
   const minimum=String(estimate.stopLimit.amount);
   const expected=String(estimate.estimatedOutput.amount);
   if(!/^\d{1,18}(?:\.\d{1,6})?$/.test(minimum)||
      !/^\d{1,18}(?:\.\d{1,6})?$/.test(expected)||
      arcSwapAmount(minimum)>arcSwapAmount(expected))
    throw Error('Circle returned an invalid minimum-output estimate.');
   const fees=(estimate.fees??[]).map(f=>f.type+': '+f.amount+' '+f.token);
   await assertArcSwapWallet(provider,address);assertArcSwapSession(session);
   setQuote({owner:address.toLowerCase(),identity,from,to,amount,
    minReceive:minimum,estimated:expected,fees,readAt:Date.now()});
  }catch(e){setError(e instanceof Error?e.message:'Circle Swap quote unavailable.');}
  finally{setBusy(false);inFlight.current=false;}
 }
 async function confirm(){
  if(inFlight.current||!quote||!address||!identity)return;
  inFlight.current=true;setBusy(true);setError(null);
  try{
   if(!signingAllowed||quote.owner!==owner||quote.identity!==identity||
      quote.from!==from||quote.to!==to||quote.amount!==amount||
      Date.now()-quote.readAt>=TTL)
    throw Error('Swap review expired or wallet/pair changed. Get a new quote.');
   if(localStorage.getItem(arcSwapKey(address,identity)))
    throw Error('An unresolved Swap already exists. Verify it before retrying.');
   const session=activeSignedIdentityToken();
   if(!session)throw Error('Signed Veyra ID required.');
   const provider=await currentProvider();
   const adapter=await createViemAdapterFromProvider({provider});
   await assertArcSwapWallet(provider,address);assertArcSwapSession(session);
   const params=swapParams(adapter,from,to,amount);
   const refreshed=await kit.estimateSwap(params);
   if(String(refreshed.stopLimit.amount)!==quote.minReceive)
    throw Error('Swap minimum output changed. Review the new quote before signing.');
   if(Date.now()-quote.readAt>=TTL)
    throw Error('Swap quote expired. Review again.');
   await assertArcSwapWallet(provider,address);assertArcSwapSession(session);
   const checkpoint=prepareArcSwapCheckpoint({owner:address,identity,
    from,to,amount,minReceive:quote.minReceive});
   const key=arcSwapKey(address,identity);
   // Persist BEFORE the SDK can request a wallet signature. An SDK timeout
   // after a broadcast is NOT proof of failure and must block blind retry.
   localStorage.setItem(key,JSON.stringify(checkpoint));
   setPending(checkpoint);setQuote(null);
   const result=await kit.swap(params);
   const txHash=typeof result.txHash==='string'&&/^0x[0-9a-fA-F]{64}$/.test(result.txHash)
    ?result.txHash:undefined;
   const updated:ArcSwapCheckpoint={...checkpoint,state:'SUBMITTED_UNVERIFIED',
    ...(txHash?{txHash}:{})};
   localStorage.setItem(key,JSON.stringify(updated));setPending(updated);
  }catch(e){
   if(address&&identity)setPending(readArcSwapCheckpoint(localStorage,address,identity));
   setError(e instanceof Error?e.message:'Swap outcome unknown. Do not resend.');
  }finally{setBusy(false);inFlight.current=false;}
 }
 async function verify(){
  if(inFlight.current||!pending||!arc)return;
  inFlight.current=true;setBusy(true);setError(null);
  try{
   if(!signingAllowed||!address||!identity||pending.owner!==owner||
      pending.identity!==identity||await arc.getChainId()!==ARC_SWAP_CHAIN_ID)
    throw Error('Swap owner, identity or verified Arc RPC is unavailable.');
   const hash=pending.txHash||( /^0x[0-9a-fA-F]{64}$/.test(hashInput)?hashInput:undefined);
   if(!hash)throw Error('Find the transaction hash in your wallet first. Never resend blindly.');
   const stored=readArcSwapCheckpoint(localStorage,address,identity);
   if(!stored||stored.owner!==owner||stored.identity!==identity)
    throw Error('Pending Swap record changed. Stop and inspect Activity.');
   const receipt=await arc.getTransactionReceipt({hash:hash as Hash});
   const withHash={...stored,txHash:hash};
   const key=arcSwapKey(address,identity);
   // An onchain REVERT is terminal; other failures stay locked.
   if(receipt.status==='reverted'){
    localStorage.setItem(key+':reverted:'+hash,JSON.stringify({owner,identity,
     txHash:hash,review:withHash,status:'REVERTED',at:Date.now()}));
    localStorage.removeItem(key);setPending(null);
    setError('Arc confirmed this Swap transaction reverted. You may review a fresh quote.');
    return;
   }
   const proof=verifyArcSwapReceipt(receipt,withHash);
   localStorage.setItem(key+':verified:'+hash,JSON.stringify({
    ...proof,owner,identity,amount:stored.amount,from:stored.from,
    minReceive:stored.minReceive,verifiedAt:Date.now(),
   }));
   localStorage.removeItem(key);setPending(null);setVerified(proof);
  }catch(e){setError(e instanceof Error?e.message:'Swap receipt unverified. Do not resend.');}
  finally{setBusy(false);inFlight.current=false;}
 }
 if(VEYRA_ENV==='mainnet'||IS_UI_ONLY_PREVIEW)
  return <div role="status" className="rounded-2xl border p-5"
   style={{borderColor:'var(--border)',color:'var(--muted)'}}>
   Wallet Swap signing is available only on an authorized Veyra Testnet release.
  </div>;
 return <div className={embedded?'w-full space-y-4':'mx-auto max-w-md px-4 py-8 space-y-4'}
  aria-label="Circle App Kit Testnet Swap">
  <div>
   <h1 className="display text-2xl font-semibold" style={{color:'var(--ink)'}}>Swap</h1>
   <p className="text-xs" style={{color:'var(--muted)'}}>
    Arc Testnet · Circle App Kit · Wallet USDC ↔ EURC (not Gateway funds)
   </p>
  </div>
  <div className="rounded-2xl border p-4 space-y-3"
   style={{borderColor:'var(--border-strong)',background:'var(--surface)'}}>
   <label className="block text-xs" style={{color:'var(--muted)'}}>Sell {from}
    <input value={amount} inputMode="decimal" placeholder="0.00"
     onChange={e=>{setAmount(e.target.value);setQuote(null);}}
     className="mt-1 w-full rounded-xl border p-3 text-lg"
     style={{background:'var(--surface)',borderColor:'var(--border)',color:'var(--ink)'}}/>
   </label>
   <button type="button" disabled={busy||Boolean(pending)}
    onClick={()=>{setFrom(to);setQuote(null);setError(null);}}
    className="rounded-xl border px-4 py-2 text-xs"
    style={{borderColor:'var(--border)'}}>Switch direction ↕</button>
   <p className="text-xs" style={{color:'var(--muted)'}}>Receive {to}</p>
   <button type="button" disabled={busy||Boolean(pending)||!signingAllowed}
    onClick={()=>void review()} className="w-full rounded-xl border p-3 font-semibold disabled:opacity-50"
    style={{borderColor:'var(--border-strong)',color:'var(--ink)'}}>
    {busy?'Checking Circle…':'Review swap quote'}
   </button>
   {quote&&<div className="rounded-xl border p-3 space-y-2 text-xs"
    style={{borderColor:'var(--border)'}}>
    <p className="font-semibold">{quote.amount} {quote.from} → {quote.to}</p>
    <p>Expected: {quote.estimated} {quote.to}</p>
    <p className="font-semibold">Minimum receive: {quote.minReceive} {quote.to}</p>
    <p>Slippage limit: 1% · quote expires after 30 seconds</p>
    {quote.fees.length===0?<p>Provider fee breakdown unavailable; network fees may apply.</p>:
     quote.fees.map((v,i)=><p key={i}>{v}</p>)}
    <p>Route may use a third-party aggregator (currently LiFi). You approve the transaction in your wallet.</p>
    <button type="button" disabled={busy} onClick={()=>void confirm()}
     className="w-full rounded-xl border p-3 font-semibold disabled:opacity-50"
     style={{borderColor:'var(--border-strong)',color:'var(--ink)'}}>
     Confirm & sign Swap
    </button>
   </div>}
   {pending&&<div role="status" className="rounded-xl border p-3 space-y-2 text-xs"
    style={{borderColor:'var(--warning)'}}>
    <p className="font-semibold">Swap pending verification · Do not resend</p>
    <p>{pending.amount} {pending.from} → {pending.to}</p>
    {pending.txHash?<p className="break-all font-mono">{pending.txHash}</p>:
     <label className="block">Transaction hash from your wallet history
      <input value={hashInput} onChange={e=>setHashInput(e.target.value)}
       placeholder="0x…" className="mt-1 w-full rounded-xl border p-2"
       style={{borderColor:'var(--border)',color:'var(--ink)'}}/>
     </label>}
    <button type="button" disabled={busy} onClick={()=>void verify()}
     className="rounded-xl border px-3 py-2 disabled:opacity-50"
     style={{borderColor:'var(--border)'}}>Verify on-chain receipt</button>
   </div>}
   {verified&&<div role="status" className="rounded-xl border p-3 text-xs space-y-1"
    style={{borderColor:'var(--success)'}}>
    <p className="font-semibold">Swap verified on Arc Testnet</p>
    <p>{verified.received} {verified.token} received</p>
    <p className="font-mono break-all">{verified.txHash}</p>
   </div>}
   {error&&<p role="alert" className="text-xs" style={{color:'var(--warning)'}}>{error}</p>}
   {!identityReady&&<p className="text-xs" style={{color:'var(--muted)'}}>
    Sign in with your existing Veyra ID to start a wallet-bound Swap.
   </p>}
  </div>
 </div>;
}
