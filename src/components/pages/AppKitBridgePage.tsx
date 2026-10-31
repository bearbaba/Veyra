/**
 * Browser-wallet CCTP via Circle App Kit with bidirectional Arc/ETH/Base routes.
 * Owner must review fee + minimum received and authorize a wallet signature.
 * Source burn and destination mint are verified separately; never auto-resend.
 */
import {useEffect,useRef,useState} from 'react';
import {AppKit} from '@circle-fin/app-kit';
import {createViemAdapterFromProvider} from '@circle-fin/adapter-viem-v2';
import {useAccount,usePublicClient,useSwitchChain} from 'wagmi';
import {getAddress,isAddress,parseUnits,type EIP1193Provider} from 'viem';
import {useUnifiedSocial} from '../../features/social/UnifiedSocial';
import {activeSignedIdentityToken} from '../../lib/api/liveIdentitySession';
import {VEYRA_ENV,IS_UI_ONLY_PREVIEW} from '../../lib/env';
import {
 BRIDGE_TESTNET_ROUTES,bridgeChain,bridgeKey,makeBridgeAttempt,
 readBridgeAttempt,getAppKitBridgeSteps,verifyCompletedAppKitBridge,
 type BridgeAttempt,
} from '../../core/bridge/arcAppKitBridge';
import {assertGatewayProviderWallet} from '../../core/gateway/gatewaySdkSpend';
const kit=new AppKit();
const MAX_QUOTE_MS=45_000;
type BridgeQuote={
 owner:string;identity:string;sourceChainId:number;destinationChainId:number;
 recipient:string;amount:string;minReceive:string;readAt:number;fees:string[];
};
const DECIMAL=/^\d{1,18}(?:\.\d{1,6})?$/;
function validateAmount(amount:string,minReceive:string):void{
 if(!DECIMAL.test(amount)||!DECIMAL.test(minReceive)||
  parseUnits(amount,6)<=0n||parseUnits(minReceive,6)<=0n||
  parseUnits(minReceive,6)>parseUnits(amount,6))
  throw Error('Enter a valid six-decimal USDC amount and minimum received.');
}
function params(adapter:Awaited<ReturnType<typeof createViemAdapterFromProvider>>,
 sourceChainId:number,destinationChainId:number,recipient:string,amount:string){
 return {from:{adapter,chain:bridgeChain(sourceChainId)},
  to:{chain:bridgeChain(destinationChainId),recipientAddress:recipient,useForwarder:true},
  amount,token:'USDC' as const,config:{transferSpeed:'SLOW' as const}}
  // Circle's runtime supports Forwarding Service recipients without a second
  // destination signer. The installed overload's static type still expects
  // an adapter on the destination; match the existing Veyra App Kit boundary.
  as unknown as Parameters<AppKit['bridge']>[0];
}
function quoteFees(estimate:unknown):string[]{
 const data=estimate as Record<string,unknown>;
 return Array.isArray(data.fees)?data.fees.map(v=>{
  if(!v||typeof v!=='object'||Array.isArray(v))return 'Fee details unavailable';
  const f=v as Record<string,unknown>;
  return String(f.type??'Fee')+': '+String(f.amount??'unknown')+' '+String(f.token??'');
 }):['Circle fees not itemized by this provider; network fees may apply'];
}
export function AppKitBridgePage({embedded=false}:{embedded?:boolean}={}){
 const {address,connector}=useAccount();
 const {switchChainAsync}=useSwitchChain();
 const arc=usePublicClient({chainId:5042002});
 const eth=usePublicClient({chainId:11155111});
 const base=usePublicClient({chainId:84532});
 const social=useUnifiedSocial();
 const identity=social.session?.profile.veyraUserId??'';
 const identityReady=Boolean(identity&&social.identityOrigin==='ready'&&
  social.session?.walletKey===(address?.toLowerCase()??'')+':'+(connector?.uid??''));
 const [source,setSource]=useState(5042002);
 const [destination,setDestination]=useState(84532);
 const [recipient,setRecipient]=useState('');
 const [amount,setAmount]=useState('');
 const [minimum,setMinimum]=useState('');
 const [busy,setBusy]=useState(false);
 const [quote,setQuote]=useState<BridgeQuote|null>(null);
 const [pending,setPending]=useState<BridgeAttempt|null>(null);
 const [error,setError]=useState<string|null>(null);
 const [verifiedHash,setVerifiedHash]=useState<string|null>(null);
 const [lastResult,setLastResult]=useState<Awaited<ReturnType<typeof kit.bridge>>|null>(null);
 const busyRef=useRef(false);
 const owner=address?.toLowerCase()??'';
 const canSign=VEYRA_ENV==='testnet'&&!IS_UI_ONLY_PREVIEW&&identityReady;
 useEffect(()=>{
  setQuote(null);setVerifiedHash(null);setLastResult(null);setError(null);
  setRecipient(address??'');
  if(!address||!identity){setPending(null);return;}
  setPending(readBridgeAttempt(localStorage,address,identity));
 },[address,identity]);
 useEffect(()=>{
  if(!quote)return;
  const timer=setTimeout(()=>setQuote(v=>v?.readAt===quote.readAt?null:v),
   Math.max(0,quote.readAt+MAX_QUOTE_MS-Date.now()));
  return ()=>clearTimeout(timer);
 },[quote]);
 async function getProvider(sourceId:number):Promise<EIP1193Provider>{
  if(!address||!connector)throw Error('Connect the reviewed Veyra wallet.');
  await switchChainAsync({chainId:sourceId});
  const value:unknown=await connector.getProvider();
  if(!value||typeof value!=='object'||!('request' in value)||
     typeof value.request!=='function')
   throw Error('Browser signer unavailable.');
  const provider=value as EIP1193Provider;
  await assertGatewayProviderWallet(provider,address,sourceId);
  return provider;
 }
 async function review(){
  if(busyRef.current)return;
  busyRef.current=true;setBusy(true);setError(null);setQuote(null);
  try{
   if(!canSign||!address||!identity)throw Error('Sign into your Veyra ID on the authorized Testnet website.');
   if(pending||localStorage.getItem(bridgeKey(address,identity)))
    throw Error('A previous CCTP Bridge remains unresolved. Verify it instead of burning again.');
   validateAmount(amount,minimum);
   if(source===destination||!isAddress(recipient))throw Error('Select different supported chains and a valid recipient.');
   const session=activeSignedIdentityToken();
   if(!session)throw Error('Signed Veyra ID required.');
   const provider=await getProvider(source);
   const adapter=await createViemAdapterFromProvider({provider});
   await assertGatewayProviderWallet(provider,address,source);
   if(activeSignedIdentityToken()!==session)throw Error('Veyra ID session changed.');
   const estimate=await kit.estimateBridge(params(adapter,source,destination,recipient,amount));
   const fees=quoteFees(estimate);
   if(activeSignedIdentityToken()!==session)throw Error('Veyra ID session changed during quote.');
   setQuote({owner,identity,sourceChainId:source,destinationChainId:destination,
    recipient:getAddress(recipient),amount,minReceive:minimum,readAt:Date.now(),fees});
  }catch(e){setError(e instanceof Error?e.message:'Circle Bridge estimate unavailable.');}
  finally{setBusy(false);busyRef.current=false;}
 }
 async function commit(){
  if(busyRef.current||!quote||!address||!identity)return;
  busyRef.current=true;setBusy(true);setError(null);
  try{
   if(!canSign||quote.owner!==owner||quote.identity!==identity||
     quote.sourceChainId!==source||quote.destinationChainId!==destination||
     quote.recipient!==getAddress(recipient)||quote.amount!==amount||
     quote.minReceive!==minimum||Date.now()-quote.readAt>=MAX_QUOTE_MS)
    throw Error('Bridge request changed or quote expired. Review again.');
   if(localStorage.getItem(bridgeKey(address,identity)))
    throw Error('Previous Bridge unresolved; never send a second burn.');
   const session=activeSignedIdentityToken();
   if(!session)throw Error('Signed Veyra ID required.');
   const provider=await getProvider(source);
   if(Date.now()-quote.readAt>=MAX_QUOTE_MS)throw Error('Bridge quote expired.');
   const adapter=await createViemAdapterFromProvider({provider});
   await assertGatewayProviderWallet(provider,address,source);
   if(activeSignedIdentityToken()!==session)throw Error('Veyra ID changed before signature.');
   // Repeat the read-only estimate immediately before signing; a provider
   // failure is not treated as a valid earlier quote.
   const latestEstimate=await kit.estimateBridge(params(adapter,source,destination,recipient,amount));
   if(JSON.stringify(quoteFees(latestEstimate))!==JSON.stringify(quote.fees))
    throw Error('CCTP quote fees changed. Review the updated costs before signing.');
   if(Date.now()-quote.readAt>=MAX_QUOTE_MS)
    throw Error('CCTP quote expired during provider checks.');
   await assertGatewayProviderWallet(provider,address,source);
   if(activeSignedIdentityToken()!==session)throw Error('Veyra ID changed.');
   const attempt=makeBridgeAttempt({owner:address,identity,
    recipient,sourceChainId:source,destinationChainId:destination,amount,minReceive:minimum});
   const key=bridgeKey(address,identity);
   localStorage.setItem(key,JSON.stringify(attempt));setPending(attempt);setQuote(null);
   const result=await kit.bridge(params(adapter,source,destination,recipient,amount));
   const steps=getAppKitBridgeSteps(result);
   const current:BridgeAttempt={...attempt,state:'SUBMITTED_UNVERIFIED',...steps};
   localStorage.setItem(key,JSON.stringify(current));setPending(current);
   setLastResult(result);
  }catch(e){
   if(address&&identity)setPending(readBridgeAttempt(localStorage,address,identity));
   setError(e instanceof Error?e.message:'CCTP outcome unknown. Do not resend.');
  }finally{busyRef.current=false;setBusy(false);}
 }
 async function retry(){
  if(busyRef.current||!lastResult||lastResult.state!=='error'||!pending||
    !address||!identity||!canSign)return;
  busyRef.current=true;setBusy(true);setError(null);
  try{
   if(pending.owner!==owner||pending.identity!==identity||
      !readBridgeAttempt(localStorage,address,identity))
    throw Error('The Bridge recovery owner changed.');
   const session=activeSignedIdentityToken();
   if(!session)throw Error('Signed Veyra ID required.');
   const provider=await getProvider(pending.sourceChainId);
   const adapter=await createViemAdapterFromProvider({provider});
   await assertGatewayProviderWallet(provider,address,pending.sourceChainId);
   if(activeSignedIdentityToken()!==session)throw Error('Veyra session changed.');
   // retryBridge resumes the existing SDK result. NEVER call bridge() again.
   const result=await kit.retryBridge(lastResult,{from:adapter,to:undefined});
   const steps=getAppKitBridgeSteps(result);
   const updated:BridgeAttempt={...pending,state:'SUBMITTED_UNVERIFIED',...steps};
   localStorage.setItem(bridgeKey(address,identity),JSON.stringify(updated));
   setPending(updated);setLastResult(result);
  }catch(e){setError(e instanceof Error?e.message:'Recovery unavailable; do not resend.');}
  finally{busyRef.current=false;setBusy(false);}
 }
 async function verify(){
  if(busyRef.current||!pending?.mintHash||!pending.burnHash||!address||!identity)return;
  busyRef.current=true;setBusy(true);setError(null);
  try{
   if(!canSign||pending.owner!==owner||pending.identity!==identity)
    throw Error('Bridge identity changed.');
   const client=pending.destinationChainId===5042002?arc:
    pending.destinationChainId===11155111?eth:base;
   if(!client||await client.getChainId()!==pending.destinationChainId)
    throw Error('Correct destination RPC is unavailable.');
   const receipt=await client.getTransactionReceipt({hash:pending.mintHash as `0x${string}`});
   const evidence=verifyCompletedAppKitBridge(receipt,pending);
   const key=bridgeKey(address,identity);
   const local=readBridgeAttempt(localStorage,address,identity);
   if(!local||local.burnHash!==evidence.burnHash||
      local.mintHash!==evidence.proof.txHash)
    throw Error('Stored CCTP attempt differs from provider evidence.');
   const proofKey=key+':verified:'+evidence.burnHash;
   localStorage.setItem(proofKey,JSON.stringify({...evidence,
    owner,identity,sourceChainId:pending.sourceChainId,verifiedAt:Date.now()}));
   localStorage.removeItem(key);setPending(null);setVerifiedHash(evidence.proof.txHash);
  }catch(e){setError(e instanceof Error?e.message:'Destination mint remains unverified. Do not resend.');}
  finally{busyRef.current=false;setBusy(false);}
 }
 if(VEYRA_ENV==='mainnet'||IS_UI_ONLY_PREVIEW)
  return <div role="status" className="rounded-2xl border p-5"
   style={{borderColor:'var(--border)',color:'var(--muted)'}}>
   CCTP Bridge signing requires an authorized Testnet release.
  </div>;
 return <div className={embedded?'w-full space-y-4':'mx-auto max-w-md px-4 py-8 space-y-4'}
  aria-label="Circle App Kit two-way CCTP Bridge">
  <h1 className="display text-2xl font-semibold" style={{color:'var(--ink)'}}>Bridge</h1>
  <p className="text-xs" style={{color:'var(--muted)'}}>
   CCTP V2 · Arc Testnet ↔ Ethereum Sepolia / Base Sepolia · Wallet USDC
  </p>
  <div className="rounded-2xl border p-4 space-y-3"
   style={{borderColor:'var(--border-strong)',background:'var(--surface)'}}>
   <label className="block text-xs">From
    <select value={source} disabled={Boolean(pending)||busy}
     onChange={e=>{const value=Number(e.target.value);setSource(value);
      if(value===destination)setDestination(value===5042002?84532:5042002);
      setQuote(null);}} className="mt-1 w-full rounded-xl border p-2"
     style={{borderColor:'var(--border)',color:'var(--ink)',background:'var(--surface)'}}>
     {BRIDGE_TESTNET_ROUTES.map(x=><option value={x.chainId} key={x.chain}>{x.chain}</option>)}
    </select>
   </label>
   <label className="block text-xs">To
    <select value={destination} disabled={Boolean(pending)||busy}
     onChange={e=>{const value=Number(e.target.value);setDestination(value);
      if(value===source)setSource(value===5042002?84532:5042002);
      setQuote(null);}} className="mt-1 w-full rounded-xl border p-2"
     style={{borderColor:'var(--border)',color:'var(--ink)',background:'var(--surface)'}}>
     {BRIDGE_TESTNET_ROUTES.map(x=><option value={x.chainId} key={x.chain}>{x.chain}</option>)}
    </select>
   </label>
   <label className="block text-xs">Recipient wallet
    <input value={recipient} disabled={Boolean(pending)}
     onChange={e=>{setRecipient(e.target.value);setQuote(null);}}
     className="mt-1 w-full rounded-xl border p-2"
     style={{borderColor:'var(--border)',color:'var(--ink)',background:'var(--surface)'}}/>
   </label>
   <label className="block text-xs">Bridge amount (USDC)
    <input value={amount} inputMode="decimal" disabled={Boolean(pending)}
     onChange={e=>{setAmount(e.target.value);setQuote(null);}}
     placeholder="1.00" className="mt-1 w-full rounded-xl border p-2"
     style={{borderColor:'var(--border)',color:'var(--ink)',background:'var(--surface)'}}/>
   </label>
   <label className="block text-xs">Minimum acceptable USDC after fees
    <input value={minimum} inputMode="decimal" disabled={Boolean(pending)}
     onChange={e=>{setMinimum(e.target.value);setQuote(null);}}
     placeholder="Review Circle fees before choosing"
     className="mt-1 w-full rounded-xl border p-2"
     style={{borderColor:'var(--border)',color:'var(--ink)',background:'var(--surface)'}}/>
   </label>
   <p className="text-xs" style={{color:'var(--muted)'}}>
    Circle Forwarding Service handles destination mint. SLOW finality avoids FAST transfer fee;
    forwarding/network fees may still apply. Minimum receive is your safety limit.
   </p>
   <button type="button" disabled={busy||Boolean(pending)||!canSign}
    onClick={()=>void review()} className="w-full rounded-xl border p-3 font-semibold disabled:opacity-50"
    style={{borderColor:'var(--border-strong)',color:'var(--ink)'}}>
    {busy?'Checking CCTP…':'Review route and fees'}
   </button>
   {quote&&<div className="rounded-xl border p-3 text-xs space-y-2"
    style={{borderColor:'var(--border)'}}>
    <p className="font-semibold">{quote.amount} USDC · {bridgeChain(quote.sourceChainId)} → {bridgeChain(quote.destinationChainId)}</p>
    <p>Recipient: {quote.recipient}</p>
    <p>Minimum receive: {quote.minReceive} USDC</p>
    <p>Speed: SLOW · provider forwarding · quote expires after 45s</p>
    {quote.fees.map((fee,i)=><p key={i}>{fee}</p>)}
    <button type="button" disabled={busy} onClick={()=>void commit()}
     className="w-full rounded-xl border p-3 font-semibold disabled:opacity-50"
     style={{borderColor:'var(--border-strong)',color:'var(--ink)'}}>Confirm & sign CCTP Bridge</button>
   </div>}
   {pending&&<div role="status" className="rounded-xl border p-3 text-xs space-y-2"
    style={{borderColor:'var(--warning)'}}>
    <p className="font-semibold">Bridge pending verification — do not burn again</p>
    <p>{bridgeChain(pending.sourceChainId)} → {bridgeChain(pending.destinationChainId)}</p>
    {pending.burnHash&&<p className="break-all">Source burn: {pending.burnHash}</p>}
    {pending.mintHash&&<p className="break-all">Destination mint: {pending.mintHash}</p>}
    <p>Circle status: {pending.providerState??'unknown'}</p>
    {pending.providerState==='success'&&pending.mintHash&&<button type="button"
     disabled={busy} onClick={()=>void verify()}
     className="rounded-xl border px-3 py-2 disabled:opacity-50"
     style={{borderColor:'var(--border)'}}>Verify destination mint receipt</button>}
    {lastResult?.state==='error'&&<button type="button" disabled={busy}
     onClick={()=>void retry()} className="rounded-xl border px-3 py-2 disabled:opacity-50"
     style={{borderColor:'var(--border)'}}>Resume existing Bridge (never reburn)</button>}
    <p>A partial source burn cannot be undone. Keep the checkpoint if finality is delayed.</p>
   </div>}
   {verifiedHash&&<div role="status" className="rounded-xl border p-3 text-xs"
    style={{borderColor:'var(--success)'}}>CCTP destination mint verified · {verifiedHash}</div>}
   {error&&<p role="alert" className="text-xs"
    style={{color:'var(--warning)'}}>{error}</p>}
   {!identityReady&&<p className="text-xs" style={{color:'var(--muted)'}}>
    Sign in to your existing Veyra ID before reviewing Bridge.
   </p>}
  </div>
 </div>;
}
