/**
 * Mainnet Circle App Kit workflows. Never reuses a Testnet chain or token.
 * Every quote is review-only until an explicit wallet signature.
 * The SDK may submit multiple transactions; local recovery locks prevent blind repeats.
 * VERIFIED requires independently checked destination USDC or swap output logs.
 */
import {useEffect,useRef,useState} from 'react';
import {AppKit} from '@circle-fin/app-kit';
import {createViemAdapterFromProvider} from '@circle-fin/adapter-viem-v2';
import {useAccount,usePublicClient,useReadContract,useSwitchChain} from 'wagmi';
import {ConnectKitButton} from 'connectkit';
import {decodeEventLog,erc20Abi,formatUnits,getAddress,isAddress,parseAbi,parseUnits,type EIP1193Provider,type Hash} from 'viem';
import {ArrowLeftRight,Route,ShieldCheck,AlertTriangle,ExternalLink,RefreshCw} from 'lucide-react';
import {getMainnetChain,CCTP_V2_MAINNET} from '@/config/mainnetCatalog';
import {ARC_VERIFIED_ASSETS,assertArcSwapCandidate} from '@/config/arcVerifiedAssets';
import {recordLocalOperation} from '@/mainnet/localOperations';
import {recordExchangeActivity} from '@/mainnet/exchangeActivity';
import {getAppKitBridgeSteps} from '@/core/bridge/arcAppKitBridge';
import {assertCctpBridgeLinked} from '@/mainnet/verifyCctpBridgeLink';
import {assertMainnetSigningAllowed} from '@/mainnet/releaseGates';
import {readBridgeQuoteAmounts} from '@/mainnet/bridgeQuoteGuard';

const kit=new AppKit();
const ARC=5042,BASE=8453;
const TOKENS={USDC:ARC_VERIFIED_ASSETS.USDC.contractAddress,
 EURC:ARC_VERIFIED_ASSETS.EURC.contractAddress} as const;
const TRANSFER=parseAbi(['event Transfer(address indexed from,address indexed to,uint256 value)']);
const HASH=/^0x[0-9a-fA-F]{64}$/;
declare const __VEYRA_RELEASE_ENV__:string;
const BRIDGE_WRITE_ENABLED=__VEYRA_RELEASE_ENV__==='production' &&
 import.meta.env.VITE_VEYRA_MAINNET_BRIDGE_WRITE_ENABLED==='1';
type Mode='swap'|'bridge';
type Token='USDC'|'EURC';
export type ExchangeExecutionSelection={fromChainId:number;toChainId:number;fromToken:Token;toToken:Token};
type Quote={owner:string;at:number;mode:Mode;amount:string;source:number;destination:number;fromToken:Token;toToken:Token;minimum:string;expected:string;fees:string[]};
type Recovery={owner:string;mode:Mode;amount:string;source:number;destination:number;fromToken:Token;toToken:Token;minimum:string;status:'UNKNOWN'|'PENDING'|'VERIFIED'|'REVERTED';hash?:string;burnHash?:string;mintHash?:string};
const key=(mode:Mode,owner:string)=>'veyra:mainnet:circle:v1:'+mode+':'+owner.toLowerCase();
const label=(id:number)=>id===ARC?'Arc Mainnet':'Base Mainnet';
const sdkChain=(id:number)=>id===ARC?'Arc' as const:'Base' as const;
const validAmount=(amount:string)=>/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,6})?$/.test(amount)&&parseUnits(amount,6)>0n&&parseUnits(amount,6)<=100_000_000n;
function transferSum(receipt:{logs:ReadonlyArray<{address:string;data:string;topics:ReadonlyArray<string>}>},token:string,receiver:string):bigint {
 let sum=0n;
 for(const log of receipt.logs){
  if(log.address.toLowerCase()!==token.toLowerCase())continue;
  try{
   const e=decodeEventLog({abi:TRANSFER,data:log.data as Hash,topics:log.topics as [Hash,...Hash[]]});
   if(e.eventName==='Transfer'&&e.args.to.toLowerCase()===receiver.toLowerCase())sum+=e.args.value;
  }catch{ /* unrelated token log */ }
 }
 return sum;
}
function feeLines(result:unknown):string[]{
 if(!result||typeof result!=='object'||!('fees' in result)||!Array.isArray(result.fees))return ['Fees not itemized by provider'];
 return result.fees.map((f:unknown)=>{
  if(!f||typeof f!=='object')return 'Fee details unavailable';
  const x=f as Record<string,unknown>;
  const scalar=(value:unknown,fallback:string)=>typeof value==='string'||typeof value==='number'?String(value):fallback;
  return scalar(x.type,'Fee')+': '+scalar(x.amount,'unknown')+' '+scalar(x.token,'');
 });
}
function parseSaved(raw:string|null,owner:string,mode:Mode):Recovery|null {
 if(!raw)return null;
 const v:unknown=JSON.parse(raw);
 if(!v||typeof v!=='object'||Array.isArray(v))throw Error('Unreadable prior operation');
 const p=v as Recovery;
 if(p.owner!==owner.toLowerCase()||p.mode!==mode||!['UNKNOWN','PENDING','VERIFIED','REVERTED'].includes(p.status)||
 (p.hash!==undefined&&!HASH.test(p.hash))||(p.burnHash!==undefined&&!HASH.test(p.burnHash))||
 (p.mintHash!==undefined&&!HASH.test(p.mintHash)))throw Error('Invalid prior operation');
 return p;
}
export function MainnetCirclePage({mode,selection,embedded=false}:{mode:Mode;selection?:ExchangeExecutionSelection;embedded?:boolean}){
 const {address,connector}=useAccount();
 const {switchChainAsync}=useSwitchChain();
 const arc=usePublicClient({chainId:ARC});
 const base=usePublicClient({chainId:BASE});
 const [legacySource,setSource]=useState(ARC);
 const [legacyDestination,setDestination]=useState(BASE);
 const [legacyFromToken,setFromToken]=useState<Token>('USDC');
 const source=selection?.fromChainId??legacySource;
 const destination=selection?.toChainId??legacyDestination;
 const fromToken=selection?.fromToken??legacyFromToken;
 const toToken:Token=selection?.toToken??(fromToken==='USDC'?'EURC':'USDC');
 const [amount,setAmount]=useState('');
 const [minimum,setMinimum]=useState('');
 const [quote,setQuote]=useState<Quote|null>(null);
 const [recovery,setRecovery]=useState<Recovery|null>(null);
 const [unknownStorage,setUnknownStorage]=useState(false);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [proof,setProof]=useState('');
 const [manualMint,setManualMint]=useState('');
 const [manualSource,setManualSource]=useState('');
 const lock=useRef(false);
 const owner=address?.toLowerCase()??'';
 const card=embedded?'rounded-2xl border p-4 sm:p-5':'rounded-2xl border p-5 sm:p-6';
 const input='mt-2 w-full rounded-xl border p-3 text-sm';
 const selectedSource=mode==='swap'?ARC:source;
 const selectedDest=mode==='swap'?ARC:destination;
 const token=mode==='swap'?TOKENS[fromToken]:getMainnetChain(selectedSource)?.usdc;
 const destToken=mode==='swap'?TOKENS[toToken]:getMainnetChain(selectedDest)?.usdc;
 const {data:sourceBalance,isError:sourceBalanceError,isFetching:balanceLoading,refetch:refreshBalance}=useReadContract({
  address: token?getAddress(token):undefined,abi:erc20Abi,functionName:'balanceOf',
  args:address?[address]:undefined,chainId:selectedSource,
  query:{enabled:!!address&&!!token,refetchInterval:15000,staleTime:8000},
 });
 const title=mode==='swap'?'Swap':'Bridge';
 useEffect(()=>{
  setQuote(null);setProof('');setError('');setManualMint('');setManualSource('');
  if(!address){setRecovery(null);setUnknownStorage(false);return;}
  try{setRecovery(parseSaved(localStorage.getItem(key(mode,address)),address,mode));setUnknownStorage(false);}
  catch{setRecovery(null);setUnknownStorage(true);}
 },[address,mode]);
 useEffect(()=>{setQuote(null);},[source,destination,fromToken,amount]);
 const client=(id:number)=>id===ARC?arc:id===BASE?base:undefined;
 async function wallet(id:number):Promise<EIP1193Provider>{
  if(!address||!connector)throw Error('Connect your wallet first.');
  await switchChainAsync({chainId:id});
  const raw:unknown=await connector.getProvider();
  if(!raw||typeof raw!=='object'||!('request' in raw)||typeof raw.request!=='function')
   throw Error('Browser wallet provider unavailable.');
  const p=raw as EIP1193Provider;
  const [accounts,chain]=await Promise.all([p.request({method:'eth_accounts'}),p.request({method:'eth_chainId'})]);
  if(!Array.isArray(accounts)||typeof accounts[0]!=='string'||accounts[0].toLowerCase()!==address.toLowerCase()||
   typeof chain!=='string'||Number.parseInt(chain,16)!==id)
   throw Error('Wallet address or network changed. Review again.');
  return p;
 }
 const params=async()=>{
  const p=await wallet(selectedSource);
  const adapter=await createViemAdapterFromProvider({provider:p});
  if(mode==='swap'){
   return {adapter,params:{from:{adapter,chain:'Arc' as const},tokenIn:fromToken,tokenOut:toToken,
    amountIn:amount,config:{slippageBps:100}}};
  }
  return {adapter,params:{from:{adapter,chain:sdkChain(selectedSource)},
   to:{chain:sdkChain(selectedDest),recipientAddress:address!,useForwarder:true},
   amount,token:'USDC',config:{transferSpeed:'SLOW'}}};
 };
 async function quoteNow(){
  if(!address||!validAmount(amount)||lock.current||unknownStorage||recovery)return;
  lock.current=true;setBusy(true);setError('');setProof('');
  try{
   if(!token||!destToken||!isAddress(address)||selectedSource===selectedDest&&mode==='bridge')
    throw Error('Choose valid supported Mainnet chains and tokens.');
   if(mode==='swap'){
    assertArcSwapCandidate(selectedSource,token);
    assertArcSwapCandidate(selectedDest,destToken);
   }

   const c=client(selectedSource);
   if(!c||await c.getChainId()!==selectedSource)throw Error('Mainnet RPC is not available.');
   const available=await c.readContract({address:getAddress(token),abi:erc20Abi,
    functionName:'balanceOf',args:[address]});
   if(available<parseUnits(amount,6))throw Error('Insufficient source wallet balance.');
   const {params:p}=await params();
   const estimate=mode==='swap'?
    await kit.estimateSwap(p as Parameters<AppKit['estimateSwap']>[0]):
    await kit.estimateBridge(p as Parameters<AppKit['estimateBridge']>[0]);
   const bridgeOutput=mode==='bridge'?readBridgeQuoteAmounts(estimate,amount):null;
   const expected=mode==='swap'?String((estimate as Awaited<ReturnType<AppKit['estimateSwap']>>).estimatedOutput.amount):bridgeOutput!.expected;
   const min=mode==='swap'?String((estimate as Awaited<ReturnType<AppKit['estimateSwap']>>).stopLimit.amount):bridgeOutput!.minimum;
   if(mode==='bridge')setMinimum(min);
   if(!validAmount(min)||parseUnits(min,6)>parseUnits(expected,6)&&mode==='swap')
    throw Error('Provider did not return a usable minimum-output quote.');
   setQuote({owner,at:Date.now(),mode,amount,source:selectedSource,destination:selectedDest,
    fromToken,toToken,minimum:min,expected,fees:feeLines(estimate)});
  }catch(e){setError(e instanceof Error?e.message:'Circle Mainnet quote unavailable.');}
  finally{setBusy(false);lock.current=false;}
 }
 async function signNow(){
  if(!quote||!address||lock.current||unknownStorage||recovery)return;
  lock.current=true;setBusy(true);setError('');setProof('');
  let saved=false;
  try{
   if(__VEYRA_RELEASE_ENV__!=='production')
    throw Error('Preview is read-only for real Mainnet Exchange. No wallet signature requested.');
   assertMainnetSigningAllowed();
   if(mode==='swap'){
    assertArcSwapCandidate(quote.source,TOKENS[quote.fromToken]);
    assertArcSwapCandidate(quote.destination,TOKENS[quote.toToken]);
   }
   if(mode==='bridge'&&!BRIDGE_WRITE_ENABLED)
    throw Error('Bridge signing is paused on Production until source-to-destination proof is accepted.');
   if(quote.owner!==owner||quote.mode!==mode||quote.amount!==amount||
    quote.source!==selectedSource||quote.destination!==selectedDest||
    quote.fromToken!==fromToken||quote.toToken!==toToken||
    mode==='bridge'&&quote.minimum!==minimum||Date.now()-quote.at>30000)
    throw Error('Payment route changed or quote expired. Review again.');
   if(localStorage.getItem(key(mode,address)))throw Error('Previous operation must be resolved first.');
   const {params:p}=await params();
   const fresh=mode==='swap'?
    await kit.estimateSwap(p as Parameters<AppKit['estimateSwap']>[0]):
    await kit.estimateBridge(p as Parameters<AppKit['estimateBridge']>[0]);
   if(JSON.stringify(feeLines(fresh))!==JSON.stringify(quote.fees)||
    mode==='swap'&&String((fresh as Awaited<ReturnType<AppKit['estimateSwap']>>).stopLimit.amount)!==quote.minimum||
    mode==='bridge'&&readBridgeQuoteAmounts(fresh,amount).minimum!==quote.minimum)
    throw Error('Provider quote changed. Review it again before signing.');
   if(Date.now()-quote.at>30000)throw Error('Quote expired.');
   await wallet(selectedSource);
   const record:Recovery={owner,mode,amount,source:selectedSource,destination:selectedDest,
    fromToken,toToken,minimum:quote.minimum,status:'UNKNOWN'};
   localStorage.setItem(key(mode,address),JSON.stringify(record));
   if(localStorage.getItem(key(mode,address))!==JSON.stringify(record))
    throw Error('Cannot persist recovery lock.');
   saved=true;setRecovery(record);setQuote(null);
   if(mode==='swap'){
    const result=await kit.swap(p as Parameters<AppKit['swap']>[0]);
    const hash=typeof result.txHash==='string'&&HASH.test(result.txHash)?result.txHash:undefined;
    const next:Recovery={...record,status:'PENDING',...(hash?{hash}:{})};
    localStorage.setItem(key(mode,address),JSON.stringify(next));setRecovery(next);
    if(hash){
     recordLocalOperation({type:'Swap',hash,owner:address,amount,asset:fromToken,chainId:ARC,status:'SUBMITTED'});
     recordExchangeActivity({owner,mode:'swap',source:ARC,destination:ARC,tokenIn:fromToken,
      tokenOut:toToken,amountIn:amount,minOut:record.minimum,originalHash:hash,
      status:'SUBMITTED',createdAt:Date.now()});
    }
   }else{
    const result=await kit.bridge(p as Parameters<AppKit['bridge']>[0]);
    const steps=getAppKitBridgeSteps(result);
    const next:Recovery={...record,status:'PENDING',...steps};
    localStorage.setItem(key(mode,address),JSON.stringify(next));setRecovery(next);
    if(steps.burnHash){
     recordLocalOperation({type:'Bridge',hash:steps.burnHash,owner:address,amount,asset:'USDC',chainId:selectedSource,status:'SUBMITTED'});
     recordExchangeActivity({owner,mode:'bridge',source:selectedSource,destination:selectedDest,
      tokenIn:'USDC',tokenOut:'USDC',amountIn:amount,minOut:record.minimum,
      originalHash:steps.burnHash,destinationHash:steps.mintHash,status:'SUBMITTED',createdAt:Date.now()});
    }
   }
  }catch(e){
   setError((e instanceof Error?e.message:'Provider outcome uncertain.')+
    (saved?' Original operation remains locked. Do not sign again.':''));
  }finally{lock.current=false;setBusy(false);}
 }
 async function verify(){
  if(!recovery||!address||lock.current)return;
  lock.current=true;setBusy(true);setError('');
  try{
   if(recovery.owner!==owner)throw Error('Owner changed.');
   const hash=mode==='swap'?(recovery.hash||manualSource):
    (recovery.mintHash||manualMint);
   if(!HASH.test(hash))throw Error('Supply the original output transaction hash from wallet/SDK; do not retry.');
   const destinationClient=client(recovery.destination);
   const receivedToken=mode==='swap'?TOKENS[recovery.toToken]:getMainnetChain(recovery.destination)?.usdc;
   if(!destinationClient||!receivedToken||await destinationClient.getChainId()!==recovery.destination)
    throw Error('Destination RPC or token unavailable.');
   let burnEvidence:{sourceHash:string;receipt:Awaited<ReturnType<NonNullable<typeof arc>['getTransactionReceipt']>>}|null=null;
   if(mode==='bridge'){
    const sourceHash=recovery.burnHash||manualSource;
    if(!HASH.test(sourceHash))throw Error('Supply source burn hash before checking destination.');
    const sourceClient=client(recovery.source);
    if(!sourceClient)throw Error('Source chain RPC unavailable.');
    const burn=await sourceClient.getTransactionReceipt({hash:sourceHash as Hash});
    if(burn.status!=='success')throw Error('Source burn is not confirmed.');
    const sourceTx=await sourceClient.getTransaction({hash:sourceHash as Hash});
    if(sourceTx.from.toLowerCase()!==owner)throw Error('Source burn sender differs from the reviewed wallet.');
    if(!burn.logs.some(log=>log.address.toLowerCase()===CCTP_V2_MAINNET.tokenMessengerV2.toLowerCase()))
     throw Error('Canonical CCTP source burn event missing.');
    burnEvidence={sourceHash,receipt:burn};
   }
   const receipt=await destinationClient.getTransactionReceipt({hash:hash as Hash});
   if(mode==='swap'){
    const submitted=await destinationClient.getTransaction({hash:hash as Hash});
    if(submitted.from.toLowerCase()!==owner)throw Error('Swap transaction sender differs from the connected wallet.');
   }
   if(receipt.status==='reverted'){
    if(mode==='swap'){
     const r:Recovery={...recovery,status:'REVERTED',hash};
     localStorage.setItem(key(mode,address),JSON.stringify(r));setRecovery(r);
    }
    throw Error('Destination transaction reverted. Check Circle status before any new request.');
   }
   if(receipt.status!=='success')throw Error('Receipt not confirmed.');
   if(mode==='bridge'){
    if(!burnEvidence)throw Error('Original CCTP burn missing.');
    await assertCctpBridgeLinked(recovery.source,recovery.destination,
     burnEvidence.sourceHash,hash,burnEvidence.receipt,receipt,address,parseUnits(recovery.amount,6));
   }
   const amountOut=transferSum(receipt,receivedToken,address);
   if(amountOut<parseUnits(recovery.minimum,6))throw Error('Destination Transfer amount below reviewed minimum or mint not found.');
   const r:Recovery={...recovery,status:'VERIFIED',...(mode==='swap'?{hash}:{mintHash:hash})};
   localStorage.setItem(key(mode,address),JSON.stringify(r));setRecovery(r);
   setProof('Destination verified: '+formatUnits(amountOut,6)+' '+(mode==='swap'?recovery.toToken:'USDC'));
   recordLocalOperation({type:mode==='swap'?'Swap':'Bridge',hash,owner:address,amount:formatUnits(amountOut,6),asset:mode==='swap'?recovery.toToken:'USDC',chainId:recovery.destination,status:'RECORDED'});
   const original=mode==='swap'?hash:(recovery.burnHash||manualSource);
   if(HASH.test(original))recordExchangeActivity({owner,mode,source:recovery.source,destination:recovery.destination,
    tokenIn:recovery.fromToken,tokenOut:recovery.toToken,amountIn:recovery.amount,
    minOut:recovery.minimum,originalHash:original,destinationHash:hash,
    status:'DESTINATION_VERIFIED',createdAt:Date.now(),verifiedAt:Date.now()});
  }catch(e){setError(e instanceof Error?e.message:'Destination receipt unverified.');}
  finally{lock.current=false;setBusy(false);}
 }
 // Read-only automatic reconciliation; no second swap, approval or burn can be submitted.
 useEffect(()=>{
  if(!address||!recovery||recovery.status!=='PENDING')return;
  const hasEvidence=mode==='swap'?!!recovery.hash:!!recovery.burnHash&&!!recovery.mintHash;
  if(!hasEvidence)return;
  let active=true;
  const tick=()=>{if(active&&!lock.current)void verify();};
  tick();
  const timer=window.setInterval(tick,12000);
  return ()=>{active=false;window.clearInterval(timer);};
  // The verification function always reads the original transaction hashes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[address,mode,recovery?.hash,recovery?.burnHash,recovery?.mintHash,recovery?.status]);
 function reset(){
  if(!address||!recovery||lock.current||
   !['VERIFIED','REVERTED'].includes(recovery.status))return;
  localStorage.removeItem(key(mode,address));setRecovery(null);setProof('');setQuote(null);
 }
 return <div className={embedded?'w-full space-y-3':'mx-auto w-full max-w-3xl space-y-5 px-4 py-7 md:px-7 md:py-9'}>
  {!embedded&&<div><p className="text-xs font-bold uppercase" style={{color:'var(--accent)'}}>Veyra · Mainnet Circle App Kit</p>
   <h1 className="display mt-2 text-3xl font-bold" style={{color:'var(--ink)'}}>{title}</h1>
   <p className="mt-2 text-sm" style={{color:'var(--muted)'}}>
    {mode==='swap'?'Swap Arc Mainnet USDC and EURC with a live liquidity quote.':
     'Bridge USDC between Arc and Base Mainnet via CCTP. Destination verification is required.'}
   </p>
  </div>}
  <div className={card+' space-y-4'} style={{borderColor:'var(--border)',background:'var(--surface)'}}>
   {!address?<ConnectKitButton/>:<>
    {!embedded&&(mode==='bridge'?<div className="grid gap-3 sm:grid-cols-2">
     <label className="text-sm" style={{color:'var(--muted)'}}>From
      <select className={input} value={source} disabled={!!recovery||busy}
       onChange={e=>{const id=Number(e.target.value);setSource(id);setDestination(id===ARC?BASE:ARC);}}
       style={{background:'var(--surface-raised)',borderColor:'var(--border)',color:'var(--ink)'}}>
       <option value={ARC}>Arc Mainnet</option><option value={BASE}>Base Mainnet</option>
      </select>
     </label>
     <label className="text-sm" style={{color:'var(--muted)'}}>To
      <select className={input} value={destination} disabled={!!recovery||busy}
       onChange={e=>{const id=Number(e.target.value);setDestination(id);setSource(id===ARC?BASE:ARC);}}
       style={{background:'var(--surface-raised)',borderColor:'var(--border)',color:'var(--ink)'}}>
       <option value={BASE}>Base Mainnet</option><option value={ARC}>Arc Mainnet</option>
      </select>
     </label>
    </div>:<div className="flex flex-wrap items-center gap-3">
     <span className="text-sm" style={{color:'var(--ink)'}}>{fromToken} → {toToken}</span>
     <button type="button" disabled={!!recovery||busy} className="rounded-xl border px-4 py-2 text-xs"
      style={{borderColor:'var(--border)',color:'var(--ink)'}}
      onClick={()=>setFromToken(t=>t==='USDC'?'EURC':'USDC')}><ArrowLeftRight className="inline size-4"/> Reverse</button>
    </div>)}
    {mode==='swap'&&<details className="text-xs" style={{color:'var(--muted)'}}>
      <summary className="cursor-pointer">Verified asset details · trading availability</summary>
      <p className="mt-2">Veyra verifies token contract identities; the Circle route and liquidity
       must still be verified with a live quote. Listing does not guarantee safety or value.</p>
      {[ARC_VERIFIED_ASSETS[fromToken],ARC_VERIFIED_ASSETS[toToken]].map(x=><p key={x.contractAddress}
        className="mt-2 break-all">{x.symbol} · Arc {x.chainId} · {x.contractAddress} · {x.decimals} decimals · <a
          href={x.sourceUrl} target="_blank" rel="noreferrer" className="underline">official source</a></p>)}
      <p className="mt-2">Other tokens are not selectable until contract verification,
       provider route validation, and verified output recovery have been integrated.</p>
     </details>}
    <label className="block text-sm" style={{color:'var(--muted)'}}>Amount ({mode==='swap'?fromToken:'USDC'})
     <input className={input} value={amount} disabled={!!recovery||busy} inputMode="decimal"
      placeholder="0.01" onChange={e=>setAmount(e.target.value)}
      style={{background:'var(--surface-raised)',borderColor:'var(--border)',color:'var(--ink)'}}/>
    </label>
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs" style={{color:'var(--muted)'}}>
     <span>Source wallet balance ({label(selectedSource)}): {sourceBalanceError?'Unavailable':sourceBalance!==undefined?formatUnits(sourceBalance,6)+' '+(mode==='swap'?fromToken:'USDC'):'Reading…'}</span>
     <button type="button" disabled={balanceLoading} onClick={()=>void refreshBalance()} className="underline">Refresh</button>
    </div>
    {mode==='bridge'&&<p className="text-sm" style={{color:'var(--muted)'}}>
      Destination: {address} · Standard CCTP transfer. Minimum received must come from the provider's quote.
      If the provider gives no verifiable minimum, signing is unavailable.
    </p>}
    {!quote&&!recovery&&<button type="button" disabled={busy||unknownStorage||!validAmount(amount)}
      className="w-full rounded-xl px-4 py-3 font-semibold disabled:opacity-40"
      style={{background:'var(--accent)',color:'#0d1b2f'}} onClick={()=>void quoteNow()}>
      {busy?'Getting live quote…':'Review live Mainnet quote'}
    </button>}
    {quote&&!recovery&&<div className="space-y-2 rounded-xl border p-4 text-sm"
      style={{borderColor:'var(--border)',color:'var(--ink)'}}>
      <p className="font-bold">{label(quote.source)} {mode==='bridge'?'→ '+label(quote.destination):'Swap'}</p>
      <p>You pay: <strong>{quote.amount} {quote.fromToken}</strong></p>
      <p>You receive (estimated): <strong>{quote.expected} {mode==='swap'?quote.toToken:'USDC'}</strong></p>
      <p>Provider minimum: {quote.minimum} {mode==='swap'?quote.toToken:'USDC'}</p>
      {mode==='swap'&&<p>Slippage limit: 1% · refresh quote if expired</p>}
      <p>Recipient: {address}</p>
      <p>Quote expires in 30 seconds · Real Mainnet assets</p>
      <p>Provider: Circle App Kit {mode==='bridge'?'· CCTP burn → destination mint':'· swap router'}</p>
      <p>Estimated completion: provider ETA not available · verify final destination before completion</p>
      <p>Confirmations: wallet approval required; token allowance or provider steps may require additional signatures. Review wallet prompts individually.</p>
      {quote.fees.map((fee,i)=><p key={i} className="text-xs">{fee}</p>)}
      <button type="button" disabled={busy} onClick={()=>void signNow()}
       className="w-full rounded-xl px-4 py-3 font-bold disabled:opacity-40"
       style={{background:'var(--accent)',color:'#0d1b2f'}}>Confirm and sign in wallet</button>
    </div>}
    {(recovery||unknownStorage)&&<div role="status" className="space-y-3 rounded-xl border p-4 text-sm"
     style={{borderColor:'var(--border)',color:'var(--ink)'}}>
     <p className="flex items-center gap-2 font-bold">
      {recovery?.status==='VERIFIED'?<ShieldCheck className="size-5" style={{color:'var(--success)'}}/>:
       <RefreshCw className="size-4" style={{color:'var(--muted)'}}/>}
      {recovery?.status==='VERIFIED'?'Destination verified':
       recovery?.status==='REVERTED'?'Transaction reverted':
       'Tracking Mainnet '+title}
     </p>
     <p className="text-xs" style={{color:recovery?.status==='VERIFIED'?'var(--success)':'var(--muted)'}}>
      {recovery?.status==='VERIFIED'?'Destination asset receipt passed Veyra verification. Open the original transaction for details.':
       recovery?.status==='REVERTED'?'Review the original transaction before starting a new request.':
       'Previous outcome is pending or uncertain. Veyra will not submit a duplicate transaction. Status rechecks never request a signature.'}
     </p>
     {recovery?.hash&&<p className="break-all text-xs">Swap: {recovery.hash}</p>}
     {recovery?.burnHash&&<p className="break-all text-xs">Burn: {recovery.burnHash}</p>}
     {recovery?.mintHash&&<p className="break-all text-xs">Destination: {recovery.mintHash}</p>}
     {(recovery?.mintHash||recovery?.hash)&&<a target="_blank" rel="noreferrer"
      className="block break-all text-xs underline" style={{color:'var(--accent)'}}
      href={(recovery.destination===BASE?'https://basescan.org/tx/':'https://explorer.arc.io/tx/')+(recovery.mintHash||recovery.hash)}>
      View transaction on explorer
     </a>}
     {recovery&&recovery.status!=='VERIFIED'&&recovery.status!=='REVERTED'&&<>
      {mode==='bridge'&&!recovery.burnHash&&<input className={input} value={manualSource}
       placeholder="Original source burn hash" onChange={e=>setManualSource(e.target.value)}
       style={{background:'var(--surface-raised)',borderColor:'var(--border)',color:'var(--ink)'}}/>}
      {!(mode==='bridge'?recovery.mintHash:recovery.hash)&&<input className={input}
       value={mode==='swap'?manualSource:manualMint} placeholder="Original destination transaction hash"
       onChange={e=>mode==='swap'?setManualSource(e.target.value):setManualMint(e.target.value)}
       style={{background:'var(--surface-raised)',borderColor:'var(--border)',color:'var(--ink)'}}/>}
      <button type="button" disabled={busy} onClick={()=>void verify()}
       className="w-full rounded-xl border px-4 py-3 font-semibold disabled:opacity-40"
       style={{borderColor:'var(--border-strong)',color:'var(--ink)'}}>
       <RefreshCw className="mr-2 inline size-4"/>Verify destination onchain
      </button>
     </>}
     {recovery&&['VERIFIED','REVERTED'].includes(recovery.status)&&
      <button type="button" onClick={reset} className="rounded-xl border px-4 py-2"
       style={{borderColor:'var(--border)',color:'var(--ink)'}}>Start new review</button>}
    </div>}
    {proof&&<p role="status" className="flex items-center gap-2 text-sm"
      style={{color:'var(--success)'}}><ShieldCheck className="size-4"/>{proof}</p>}
    {error&&<p role="alert" className="flex items-start gap-2 text-sm" style={{color:'var(--warning)'}}>
      <AlertTriangle className="size-4"/>{error}</p>}
   </>}
  </div>
  {!embedded&&<p className="flex items-start gap-2 text-xs leading-5" style={{color:'var(--muted)'}}>
   <ShieldCheck className="size-4 shrink-0"/>Mainnet transactions are irreversible. Circle route availability depends on live SDK and liquidity.
   Approval, burn or source confirmation alone never counts as final settlement. No automatic retries.
  </p>}
 </div>;
}
