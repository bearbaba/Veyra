/**
 * Mainnet Circle App Kit workflows. Never reuses a Testnet chain or token.
 * Every quote is review-only until an explicit wallet signature.
 * The SDK may submit multiple transactions; local recovery locks prevent blind repeats.
 * VERIFIED requires independently checked destination USDC or swap output logs.
 */
import {Fragment,useEffect,useRef,useState,type ReactNode} from 'react';
import {AppKit} from '@circle-fin/app-kit';
import {createViemAdapterFromProvider} from '@circle-fin/adapter-viem-v2';
import {useAccount,usePublicClient,useReadContract,useSwitchChain} from 'wagmi';
import {ConnectKitButton} from 'connectkit';
import {decodeEventLog,erc20Abi,formatUnits,getAddress,isAddress,parseAbi,parseUnits,type EIP1193Provider,type Hash} from 'viem';
import {ArrowLeftRight,Route,ShieldCheck,AlertTriangle,ExternalLink,RefreshCw,LockKeyhole,History} from 'lucide-react';
import {getMainnetChain,CCTP_V2_MAINNET} from '@/config/mainnetCatalog';
import {circleCctpBridgePair} from '@/mainnet/circleBridgePolicy';
import {ARC_VERIFIED_ASSETS,assertArcSwapCandidate} from '@/config/arcVerifiedAssets';
import {recordLocalOperation} from '@/mainnet/localOperations';
import {recordExchangeActivity} from '@/mainnet/exchangeActivity';
import {advanceExchangeIntent,readExchangeIntents} from '@/mainnet/exchangeIntentJournal';
import {reserveCircleExchangeBeforeSigning} from '@/mainnet/reserveCircleExchange';
import {withMainnetWalletSigningLock} from '@/mainnet/mainnetWalletSigningLock';
import {recordVerifiedExchangeProof,recordVerifiedSourceRevert} from '@/mainnet/recordVerifiedExchangeProof';
import {getAppKitBridgeSteps} from '@/core/bridge/arcAppKitBridge';
import {assertCctpBridgeLinked,findCctpDestinationMintHash} from '@/mainnet/verifyCctpBridgeLink';
import {assertMainnetConsumerSigningAllowed,MAINNET_PUBLIC_BETA,MAINNET_EMERGENCY_READ_ONLY} from '@/mainnet/releaseGates';
import {readBridgeQuoteAmounts,assertBridgeQuoteWithinReviewedCap} from '@/mainnet/bridgeQuoteGuard';
import {feeBurdenMessage} from '@/mainnet/feeBurden';
import {exchangeSigningBlock,signingNotice,type SigningBlock} from '@/mainnet/exchangeSigningGate';
import {summarizeQuote} from '@/mainnet/quoteSummary';
import {Notice,StatusPill,TxStepper} from '@/components/ui/primitives';
import {exchangeStageView} from '@/mainnet/exchangeStage';
import {validStoredExchangeRecovery,withFreshVerification} from '@/mainnet/recoveryTrust';
import {networkRequirement} from '@/mainnet/walletNetworkRequirement';

const kit=new AppKit();
const ARC=5042,BASE=8453;
const TOKENS={USDC:ARC_VERIFIED_ASSETS.USDC.contractAddress,
 EURC:ARC_VERIFIED_ASSETS.EURC.contractAddress} as const;
const TRANSFER=parseAbi(['event Transfer(address indexed from,address indexed to,uint256 value)']);
const HASH=/^0x[0-9a-fA-F]{64}$/;
declare const __VEYRA_RELEASE_ENV__:string;
const BRIDGE_WRITE_ENABLED=__VEYRA_RELEASE_ENV__==='production' &&
 ((MAINNET_PUBLIC_BETA&&import.meta.env.VITE_VEYRA_MAINNET_BRIDGE_BETA_ENABLED==='1') ||
 (import.meta.env.VITE_VEYRA_MAINNET_BRIDGE_WRITE_ENABLED==='1'&&
 import.meta.env.VITE_VEYRA_MAINNET_BRIDGE_E2E_ACCEPTED==='1'));
type Mode='swap'|'bridge';
/** Keep display readiness and the signing decision on the same release gates. */
export function circleSigningBlock(mode:Mode):SigningBlock|null{
 return exchangeSigningBlock({releaseEnv:__VEYRA_RELEASE_ENV__,emergencyReadOnly:MAINNET_EMERGENCY_READ_ONLY,
  publicBeta:MAINNET_PUBLIC_BETA,bridgeWriteEnabled:BRIDGE_WRITE_ENABLED,mode});
}
export function isCircleSigningReady(mode:Mode):boolean{
 return circleSigningBlock(mode)===null;
}
type Token='USDC'|'EURC';
export type ExchangeExecutionSelection={fromChainId:number;toChainId:number;fromToken:Token;toToken:Token};
type Quote={owner:string;at:number;mode:Mode;amount:string;source:number;destination:number;fromToken:Token;toToken:Token;minimum:string;expected:string;fees:string[];bridgeMaxFee?:string};
type Recovery={owner:string;mode:Mode;amount:string;source:number;destination:number;fromToken:Token;toToken:Token;minimum:string;status:'UNKNOWN'|'PENDING'|'VERIFIED'|'REVERTED';hash?:string;burnHash?:string;mintHash?:string;intentId?:string;downgradedFrom?:'VERIFIED'|'REVERTED'};
const key=(mode:Mode,owner:string)=>'veyra:mainnet:circle:v1:'+mode+':'+owner.toLowerCase();
const label=(id:number)=>id===ARC?'Arc Mainnet':id===1?'Ethereum Mainnet':'Base Mainnet';
const sdkChain=(id:number)=>id===1?'Ethereum' as const:id===BASE?'Base' as const:'Arc' as const;
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
 if(!result||typeof result!=='object'||!('fees' in result)||!Array.isArray(result.fees))
  throw Error('Circle cannot provide itemized fees. Signing remains disabled.');
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
 if(!validStoredExchangeRecovery(v,owner,mode))throw Error('Invalid prior operation');
 // Local cached outcomes and hash strings are not independent blockchain proof.
 return withFreshVerification(v as Recovery);
}
export function MainnetCirclePage({mode,selection,embedded=false,onFinancialBusyChange,receiveSelector,onOpenActivity}:{
 mode:Mode;selection?:ExchangeExecutionSelection;embedded?:boolean;
 onFinancialBusyChange?:(blocked:boolean)=>void;receiveSelector?:ReactNode;
 onOpenActivity?:()=>void;
}){
 const {address,connector,chainId:walletChainId}=useAccount();
 const {switchChainAsync}=useSwitchChain();
 const arc=usePublicClient({chainId:ARC});
 const base=usePublicClient({chainId:BASE});
 const ethereum=usePublicClient({chainId:1});
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
 const [quoteClock,setQuoteClock]=useState(Date.now());
 const [recovery,setRecovery]=useState<Recovery|null>(null);
 const [unknownStorage,setUnknownStorage]=useState(false);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [proof,setProof]=useState('');
 const [manualMint,setManualMint]=useState('');
 const [manualSource,setManualSource]=useState('');
 const lock=useRef(false);
 const verificationScopeRef=useRef('');
 const autoCheckBudget=useRef({id:'',attempts:0});
 const owner=address?.toLowerCase()??'';
 // New wallet/route renders immediately invalidate any in-flight read-only check.
 verificationScopeRef.current=mode+':'+owner;
 useEffect(()=>()=>{verificationScopeRef.current='unmounted';},[]);
 useEffect(()=>{
  onFinancialBusyChange?.(busy||!!recovery);
  return()=>onFinancialBusyChange?.(false);
 },[busy,recovery,onFinancialBusyChange]);
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
 // A quote is informational. Mainnet pilot forbids signatures for Swap/Bridge.
 const signingBlock=circleSigningBlock(mode);
 const signingReady=signingBlock===null;
 const notice=signingBlock?signingNotice(signingBlock):null;
 useEffect(()=>{
  setQuote(null);setProof('');setError('');setManualMint('');setManualSource('');
  if(!address){setRecovery(null);setUnknownStorage(false);return;}
  try{
   const raw=localStorage.getItem(key(mode,address));
   const saved=parseSaved(raw,address,mode);
   if(saved&&raw&&(JSON.parse(raw) as Recovery).status!==saved.status)
    localStorage.setItem(key(mode,address),JSON.stringify(saved));
   setRecovery(saved);setUnknownStorage(false);
  }catch{setRecovery(null);setUnknownStorage(true);}
 },[address,mode]);
 useEffect(()=>{setQuote(null);},[source,destination,fromToken,toToken,amount]);
 // The network-requirement message stops being true the moment the wallet is on the right network
 // (or the route changes). Clear only that message, never any other error.
 useEffect(()=>{
  if(networkRequirement(walletChainId,selectedSource)===null)setError(prev=>prev.startsWith('Your wallet is on ')?'':prev);
 },[walletChainId,selectedSource]);
 useEffect(()=>{
  if(!quote)return;
  const tick=window.setInterval(()=>setQuoteClock(Date.now()),1000);
  return()=>window.clearInterval(tick);
 },[quote]);
 const quoteExpired=!!quote&&quoteClock-quote.at>=30000;
 const client=(id:number)=>id===ARC?arc:id===BASE?base:id===1?ethereum:undefined;
 async function wallet(id:number,allowSwitch=true):Promise<EIP1193Provider>{
  if(!address||!connector)throw Error('Connect your wallet first.');
  if(allowSwitch)await switchChainAsync({chainId:id});
  const raw:unknown=await connector.getProvider();
  if(!raw||typeof raw!=='object'||!('request' in raw)||typeof raw.request!=='function')
   throw Error('Browser wallet provider unavailable.');
  const p=raw as EIP1193Provider;
  const [accounts,chain]=await Promise.all([p.request({method:'eth_accounts'}),p.request({method:'eth_chainId'})]);
  if(!allowSwitch){
   // Signing is unavailable here, so no wallet prompt is opened for a quote that cannot proceed.
   // Say which network is needed; the address/network re-check below still runs.
   const current=typeof chain==='string'?Number.parseInt(chain,16):undefined;
   const requirement=networkRequirement(Number.isSafeInteger(current)?current:undefined,id);
   if(requirement)throw Error(requirement);
  }
  if(!Array.isArray(accounts)||typeof accounts[0]!=='string'||accounts[0].toLowerCase()!==address.toLowerCase()||
   typeof chain!=='string'||Number.parseInt(chain,16)!==id)
   throw Error('Wallet address or network changed. Review again.');
  return p;
 }
 const params=async(bridgeMaxFee?:string)=>{
  const p=await wallet(selectedSource,signingReady);
  const adapter=await createViemAdapterFromProvider({provider:p});
  if(mode==='swap'){
   return {adapter,params:{from:{adapter,chain:'Arc' as const},tokenIn:fromToken,tokenOut:toToken,
    amountIn:amount,config:{slippageBps:100}}};
  }
  return {adapter,params:{from:{adapter,chain:sdkChain(selectedSource)},
   to:{chain:sdkChain(selectedDest),recipientAddress:address!,useForwarder:true},
   amount,token:'USDC',config:{transferSpeed:'SLOW',...(bridgeMaxFee!==undefined?{maxFee:bridgeMaxFee}:{})}}};
 };
 async function quoteNow(){
  if(!address||!validAmount(amount)||lock.current||unknownStorage||recovery)return;
  lock.current=true;setBusy(true);setError('');setProof('');
  try{
   if(!token||!destToken||!isAddress(address)||selectedSource===selectedDest&&mode==='bridge'||
     mode==='bridge'&&!circleCctpBridgePair(selectedSource,selectedDest,'USDC','USDC'))
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
   const gas=await c.getBalance({address});
   if(gas<=0n)throw Error('Insufficient native gas on source network. Add ETH before requesting a quote.');
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
   const at=Date.now();setQuoteClock(at);
   setQuote({owner,at,mode,amount,source:selectedSource,destination:selectedDest,
    fromToken,toToken,minimum:min,expected,fees:feeLines(estimate),
    ...(bridgeOutput?{bridgeMaxFee:bridgeOutput.maxFee}:{})});
  }catch(e){setError(e instanceof Error?e.message:'Circle Mainnet quote unavailable.');}
  finally{setBusy(false);lock.current=false;}
 }
 async function signNow(){
  if(!quote||!address||lock.current||unknownStorage||recovery)return;
  lock.current=true;setBusy(true);setError('');setProof('');
  let saved=false;
  try{
   await withMainnetWalletSigningLock(address,async()=>{
   if(__VEYRA_RELEASE_ENV__!=='production')
    throw Error('Preview is read-only for real Mainnet Exchange. No wallet signature requested.');
   assertMainnetConsumerSigningAllowed();
   if(mode==='swap'){
    assertArcSwapCandidate(quote.source,TOKENS[quote.fromToken]);
    assertArcSwapCandidate(quote.destination,TOKENS[quote.toToken]);
   }
   if(mode==='bridge'&&(!BRIDGE_WRITE_ENABLED||!circleCctpBridgePair(selectedSource,selectedDest,'USDC','USDC')))
    throw Error('Bridge signing is paused on Production until source-to-destination proof is accepted.');
   if(quote.owner!==owner||quote.mode!==mode||quote.amount!==amount||
    quote.source!==selectedSource||quote.destination!==selectedDest||
    quote.fromToken!==fromToken||quote.toToken!==toToken||
    mode==='bridge'&&quote.minimum!==minimum||Date.now()-quote.at>30000)
    throw Error('Payment route changed or quote expired. Review again.');
   if(localStorage.getItem(key(mode,address)))throw Error('Previous operation must be resolved first.');
   // Both Swap and Bridge use the same wallet. Another saved Circle outcome,
   // even one previously marked VERIFIED, must be reopened and independently
   // checked before authorizing a second money movement in either mode.
   const otherMode:Mode=mode==='swap'?'bridge':'swap';
   if(localStorage.getItem(key(otherMode,address)))
    throw Error('Another Exchange operation requires review. Open its original Swap or Bridge tracking before signing.');
   const existingIntents=readExchangeIntents(owner);
   if(existingIntents.kind!=='ready'||existingIntents.items.some(task=>
    !['DESTINATION_VERIFIED','REFUNDED','SOURCE_REVERTED','CANCELLED_BEFORE_SOURCE'].includes(task.stage)))
    throw Error('Unresolved Exchange intent or unreadable recovery storage. Inspect Activity first.');
   const {params:p}=await params(mode==='bridge'?quote.bridgeMaxFee:undefined);
   const fresh=mode==='swap'?
    await kit.estimateSwap(p as Parameters<AppKit['estimateSwap']>[0]):
    await kit.estimateBridge(p as Parameters<AppKit['estimateBridge']>[0]);
   // CCTP forwarding fees are dynamic. The signed on-chain maxFee protects
   // the user's minimum. An improved (lower) fresh fee is safe under the
   // frozen cap; a higher fee must be explicitly reviewed again.
   if(mode==='bridge'){
    if(!quote.bridgeMaxFee)throw Error('Bridge fee cap is unavailable. Get a new quote.');
    assertBridgeQuoteWithinReviewedCap(fresh,amount,{
     minimum:quote.minimum,maxFee:quote.bridgeMaxFee});
   }else if(JSON.stringify(feeLines(fresh))!==JSON.stringify(quote.fees)||
    String((fresh as Awaited<ReturnType<AppKit['estimateSwap']>>).stopLimit.amount)!==quote.minimum)
    throw Error('Swap price changed. Refresh the quote before signing.');
   if(Date.now()-quote.at>30000)throw Error('Quote expired.');
   await wallet(selectedSource);
   const intentId=crypto.randomUUID();
   const record:Recovery={owner,mode,amount,source:selectedSource,destination:selectedDest,
    fromToken,toToken,minimum:quote.minimum,status:'UNKNOWN',intentId};
   const intentTime=Date.now();
   const reservation=reserveCircleExchangeBeforeSigning({legacyKey:key(mode,address),
    recoveryRecord:JSON.stringify(record),storage:localStorage,
    intent:{id:intentId,owner,provider:'Circle App Kit',mode,fromChainId:selectedSource,
     toChainId:selectedDest,tokenIn:fromToken,tokenOut:toToken,amountIn:amount,
     minimumOut:quote.minimum,createdAt:intentTime,updatedAt:intentTime,stage:'REVIEWED',steps:[]}});
   if(reservation.kind!=='reserved')throw Error(reservation.message);
   saved=true;setRecovery(record);setQuote(null);
   if(mode==='swap'){
    const result=await kit.swap(p as Parameters<AppKit['swap']>[0]);
    const hash=typeof result.txHash==='string'&&HASH.test(result.txHash)?result.txHash:undefined;
    const next:Recovery={...record,status:'PENDING',...(hash?{hash}:{})};
    localStorage.setItem(key(mode,address),JSON.stringify(next));setRecovery(next);
    advanceExchangeIntent(owner,intentId,hash?'SOURCE_SUBMITTED':'SOURCE_UNKNOWN',
     hash?{sourceHash:hash,steps:[{stage:'source',chainId:ARC,token:fromToken,
      status:'submitted',hash}]}:{message:'Wallet returned no original hash. Check wallet; do not re-sign.'});
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
    advanceExchangeIntent(owner,intentId,steps.burnHash?'SOURCE_SUBMITTED':'SOURCE_UNKNOWN',
     steps.burnHash?{sourceHash:steps.burnHash,steps:[{stage:'source',chainId:selectedSource,
      token:'USDC',status:'submitted',hash:steps.burnHash}]}:
      {message:'Provider returned no original source burn. Do not create a new transfer.'});
    if(steps.burnHash){
     recordLocalOperation({type:'Bridge',hash:steps.burnHash,owner:address,amount,asset:'USDC',chainId:selectedSource,status:'SUBMITTED'});
     recordExchangeActivity({owner,mode:'bridge',source:selectedSource,destination:selectedDest,
      tokenIn:'USDC',tokenOut:'USDC',amountIn:amount,minOut:record.minimum,
      originalHash:steps.burnHash,destinationHash:steps.mintHash,status:'SUBMITTED',createdAt:Date.now()});
    }
   }
   });
  }catch(e){
   if(saved&&address){
    // SDK may have broadcast before returning an error or timeout.
    // This journal state can only be cleared by original evidence.
    try{
     const original=JSON.parse(localStorage.getItem(key(mode,address))??'null') as Recovery|null;
     if(original?.intentId)
      advanceExchangeIntent(owner,original.intentId,'SOURCE_UNKNOWN',{
       message:'Provider outcome uncertain. Verify original wallet activity; do not repeat the source.'});
    }catch{/* Original recovery lock stays in storage. */}
   }
   const reason=e instanceof Error?e.message:'Provider outcome uncertain.';
   // Before the journal is reserved no wallet request occurred. Return to the
   // SAME quote control instead of leaving an expired Confirm button visible.
   if(!saved&&(/Refresh the quote|quote expired|Quote expired|price changed/i).test(reason))
    setQuote(null);
   setError(reason+(saved?' Original operation remains locked. Do not sign again.':''));
  }finally{lock.current=false;setBusy(false);}
 }
 async function verify(){
  if(!recovery||!address||lock.current)return;
  lock.current=true;setBusy(true);setError('');
  const requestScope=verificationScopeRef.current;
  const assertSameScope=()=>{
   if(verificationScopeRef.current!==requestScope)
    throw Error('Connected wallet or route changed during verification. Previous check ignored.');
  };
  try{
   assertSameScope();
   if(recovery.owner!==owner)throw Error('Owner changed.');
   let hash=mode==='swap'?recovery.hash:recovery.mintHash;
   if(mode==='bridge'&&!hash&&recovery.burnHash){
    const found=await findCctpDestinationMintHash(recovery.source,recovery.destination,recovery.burnHash);
    assertSameScope();
    if(!found)throw Error('Waiting for Circle destination mint or attestation. Original source remains locked; never resend.');
    hash=found;
    const next:Recovery={...recovery,mintHash:found};
    localStorage.setItem(key(mode,address),JSON.stringify(next));setRecovery(next);
   }
   if(!hash||!HASH.test(hash))
    throw Error('Original transaction hash is not known. Review wallet Activity; do not re-sign.');
   const destinationClient=client(recovery.destination);
   const receivedToken=mode==='swap'?TOKENS[recovery.toToken]:getMainnetChain(recovery.destination)?.usdc;
   if(!destinationClient||!receivedToken||await destinationClient.getChainId()!==recovery.destination)
    throw Error('Destination RPC or token unavailable.');
   assertSameScope();
   let burnEvidence:{sourceHash:string;receipt:Awaited<ReturnType<NonNullable<typeof arc>['getTransactionReceipt']>>}|null=null;
   if(mode==='bridge'){
    const sourceHash=recovery.burnHash||manualSource;
    if(!HASH.test(sourceHash))throw Error('Supply source burn hash before checking destination.');
    const sourceClient=client(recovery.source);
    if(!sourceClient)throw Error('Source chain RPC unavailable.');
    const burn=await sourceClient.getTransactionReceipt({hash:sourceHash as Hash});
    assertSameScope();
    if(burn.status!=='success')throw Error('Source burn is not confirmed.');
    const sourceTx=await sourceClient.getTransaction({hash:sourceHash as Hash});
    assertSameScope();
    if(sourceTx.from.toLowerCase()!==owner)throw Error('Source burn sender differs from the reviewed wallet.');
    if(!burn.logs.some(log=>log.address.toLowerCase()===CCTP_V2_MAINNET.tokenMessengerV2.toLowerCase()))
     throw Error('Canonical CCTP source burn event missing.');
    burnEvidence={sourceHash,receipt:burn};
    if(recovery.intentId){
     const task=readExchangeIntents(owner);
     const status=task.kind==='ready'?task.items.find(v=>v.id===recovery.intentId)?.stage:undefined;
     if(status==='SOURCE_UNKNOWN')
      advanceExchangeIntent(owner,recovery.intentId,'SOURCE_SUBMITTED',{sourceHash});
     advanceExchangeIntent(owner,recovery.intentId,'SOURCE_CONFIRMED',{sourceHash});
    }
   }
   const receipt=await destinationClient.getTransactionReceipt({hash:hash as Hash});
   assertSameScope();
   if(mode==='swap'){
    const submitted=await destinationClient.getTransaction({hash:hash as Hash});
    assertSameScope();
    if(submitted.from.toLowerCase()!==owner)throw Error('Swap transaction sender differs from the connected wallet.');
   }
   if(receipt.status==='reverted'){
    if(mode==='bridge'&&recovery.intentId&&burnEvidence){
     advanceExchangeIntent(owner,recovery.intentId,'PARTIAL',{
      sourceHash:burnEvidence.sourceHash,destinationHash:hash,holdingChainId:recovery.source,
      holdingToken:'CCTP burn confirmed; destination receipt reverted · funds not verified spendable',
      message:'Destination receipt reverted. Inspect CCTP recovery or refund; never repeat the source burn.'});
    }
    if(mode==='swap'){
     if(recovery.intentId){
      const savedRevert=recordVerifiedSourceRevert({
       owner,intentId:recovery.intentId,sourceHash:hash,
       chainId:recovery.source,sourceToken:recovery.fromToken,checkedAt:Date.now(),
      });
      if(savedRevert.kind==='blocked')throw Error(savedRevert.reason+
       ' Source transaction is reverted onchain but its local journal remains locked.');
     }
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
    assertSameScope();
   }
   const amountOut=transferSum(receipt,receivedToken,address);
   if(amountOut<parseUnits(recovery.minimum,6))throw Error('Destination Transfer amount below reviewed minimum or mint not found.');
   if(recovery.intentId){
    const originalHash=mode==='swap'?hash:(recovery.burnHash||manualSource);
    const commit=recordVerifiedExchangeProof({
     owner,intentId:recovery.intentId,sourceHash:originalHash,destinationHash:hash,
     sourceChainId:recovery.source,destinationChainId:recovery.destination,
     sourceToken:recovery.fromToken,destinationToken:recovery.toToken,checkedAt:Date.now(),
    });
    if(commit.kind==='blocked')throw Error(commit.reason+
     ' The onchain result is not lost; do not submit this transfer again.');
   }
   const r:Recovery={...recovery,status:'VERIFIED',...(mode==='swap'?{hash}:{mintHash:hash})};
   localStorage.setItem(key(mode,address),JSON.stringify(r));setRecovery(r);
   setProof('Destination verified: '+formatUnits(amountOut,6)+' '+(mode==='swap'?recovery.toToken:'USDC'));
   recordLocalOperation({type:mode==='swap'?'Swap':'Bridge',hash,owner:address,amount:formatUnits(amountOut,6),asset:mode==='swap'?recovery.toToken:'USDC',chainId:recovery.destination,status:'RECORDED'});
   const original=mode==='swap'?hash:(recovery.burnHash||manualSource);
   if(HASH.test(original))recordExchangeActivity({owner,mode,source:recovery.source,destination:recovery.destination,
    tokenIn:recovery.fromToken,tokenOut:recovery.toToken,amountIn:recovery.amount,
    minOut:recovery.minimum,originalHash:original,destinationHash:hash,
    status:'DESTINATION_VERIFIED',createdAt:Date.now(),verifiedAt:Date.now()});
  }catch(e){
   if(verificationScopeRef.current===requestScope)
    setError(e instanceof Error?e.message:'Destination receipt unverified.');
  }finally{
   // The shared lock blocks another action while this read is in flight.
   // Always release its spinner, including after a wallet switch; only
   // financial *results* are scoped and must be discarded when stale.
   lock.current=false;
   setBusy(false);
  }
 }
 // Read-only automatic reconciliation; no second swap, approval or burn can be submitted.
 useEffect(()=>{
  if(!address||!recovery||recovery.status!=='PENDING')return;
  const hasEvidence=mode==='swap'?!!recovery.hash:!!recovery.burnHash;
  if(!hasEvidence)return;
  let active=true;
  const checkId=key(mode,address)+':'+(recovery.hash??recovery.burnHash??'unknown');
  if(autoCheckBudget.current.id!==checkId)autoCheckBudget.current={id:checkId,attempts:0};
  const tick=()=>{
   if(!active||lock.current||autoCheckBudget.current.attempts>=4)return;
   autoCheckBudget.current.attempts++;
   void verify();
  };
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
  <div className={embedded?'space-y-4 border-t pt-4':card+' space-y-4'} style={{borderColor:'var(--border)',background:'var(--surface)'}}>
   {!address?<div className="space-y-3">
    <label className="block text-xs font-semibold" style={{color:'var(--muted)'}}>AMOUNT
     <input disabled placeholder="0.00" aria-label="Amount · connect wallet first"
      className="veyra-route-input mt-2 w-full rounded-xl border p-3 text-3xl font-bold"
      style={{background:'var(--surface-raised)',color:'var(--muted)',borderColor:'var(--border)'}}/>
    </label>
    <p className="text-xs" style={{color:'var(--muted)'}}>Connect your wallet to check the balance and request a live quote. No signing is enabled in this pilot.</p>
    <ConnectKitButton/>
   </div>:<>
    {(()=>{
     const stageView=exchangeStageView({hasLiveQuote:!!quote&&!quoteExpired,busy,
      recoveryStatus:recovery?.status??null,unknownStorage});
     return stageView?<TxStepper stage={stageView.stage} stalled={stageView.stalled}/>:null;
    })()}
    {!recovery&&!unknownStorage&&<>
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
    <div className="space-y-2">
     <label className="block text-xs font-semibold" style={{color:'var(--muted)'}}>
      {mode==='swap'?'YOU PAY · AMOUNT':'AMOUNT · USDC'}
      <input className="veyra-route-input mt-2 w-full rounded-xl border p-3 text-3xl font-bold tabular-nums"
       value={amount} disabled={!!recovery||busy} inputMode="decimal" maxLength={25}
       placeholder="0.00" onChange={e=>setAmount(e.target.value)}
       style={{background:'var(--surface-raised)',borderColor:'var(--border)',color:'var(--ink)'}}/>
     </label>
     <div className="flex flex-wrap items-center justify-between gap-2 text-xs" style={{color:'var(--muted)'}}>
      <span>Wallet · {sourceBalanceError?'Unavailable':sourceBalance!==undefined?formatUnits(sourceBalance,6)+' '+(mode==='swap'?fromToken:'USDC'):'Reading…'}</span>
      <span className="flex items-center gap-3">
       <button type="button" className="font-semibold underline disabled:opacity-40"
        disabled={busy||!!recovery||sourceBalance===undefined||sourceBalance===0n}
        onClick={()=>setAmount(formatUnits(sourceBalance!>100_000_000n*1_000_000n?100_000_000n*1_000_000n:sourceBalance!,6))}>Max</button>
       <button type="button" disabled={balanceLoading} onClick={()=>void refreshBalance()} className="underline">Refresh</button>
      </span>
     </div>
    </div>
    {mode==='swap'&&receiveSelector}
    <div className="space-y-2 rounded-xl border p-3" style={{background:'var(--surface-raised)',borderColor:'var(--border)'}}>
     <p className="text-xs font-semibold" style={{color:'var(--muted)'}}>YOU RECEIVE · {mode==='swap'?toToken:'USDC'}{mode==='bridge'?' · '+label(selectedDest):''}</p>
     <p className="display text-2xl font-bold tabular-nums" style={{color:'var(--ink)'}}>
      {quote&&!quoteExpired?quote.expected:'—'}
      <span className="ml-2 text-sm" style={{color:'var(--muted)'}}>{mode==='swap'?toToken:'USDC'}</span>
     </p>
     {!quote||quoteExpired?<p className="text-xs" style={{color:'var(--muted)'}}>Estimated amount will appear after a live provider quote.</p>:null}
    </div>
    {!recovery&&!unknownStorage&&<div className="space-y-2" aria-label="Transaction action">
     {!signingReady&&networkRequirement(walletChainId,selectedSource)&&<p role="status" className="text-xs" style={{color:'var(--muted)'}}>
      {networkRequirement(walletChainId,selectedSource)}</p>}
     <button type="button" aria-live="polite"
      disabled={busy||!validAmount(amount)||!!quote&&!quoteExpired&&!signingReady}
      className={'veyra-btn-primary flex min-h-12 w-full items-center justify-center gap-2 '+
       (quote&&!quoteExpired&&!signingReady?'disabled:opacity-80':'disabled:opacity-40')}
      onClick={()=>void(quote&&!quoteExpired?signNow():quoteNow())}>
      {busy&&<RefreshCw className="size-4 animate-spin" aria-hidden="true"/>}
      {busy?(quote&&!quoteExpired?'Checking live quote…':'Getting live quote…'):
       quote&&!quoteExpired?(signingReady?'Confirm in wallet':(notice?.buttonLabel??'Signing unavailable')):quoteExpired?'Refresh quote':
       mode==='swap'?'Review swap':'Review bridge'}
     </button>
     {quote&&!quoteExpired&&<div role="status" aria-label="Live provider quote"
       className="rounded-xl border px-3 py-2.5 text-xs"
       style={{borderColor:'var(--border)',background:'var(--surface-raised)',color:'var(--muted)'}}>
      {(()=>{
       const summary=summarizeQuote({mode:quote.mode,amount:quote.amount,fromToken:quote.fromToken,
        toToken:quote.mode==='swap'?quote.toToken:'USDC',expected:quote.expected,minimum:quote.minimum,
        fees:quote.fees,...(quote.bridgeMaxFee!==undefined?{bridgeMaxFee:quote.bridgeMaxFee}:{})});
       const message=summary.burden?feeBurdenMessage(summary.burden,summary.burdenSubject):null;
       return <>
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
         <span className="font-semibold" style={{color:'var(--ink)'}}>Live quote</span>
         <span>{Math.max(0,30-Math.floor((quoteClock-quote.at)/1000))}s left</span>
        </div>
        <dl className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1.5" aria-label="Quote breakdown">
         {summary.rows.map((r,i)=><Fragment key={i}>
          <dt style={{color:r.strong?'var(--ink)':undefined}} className={r.strong?'font-semibold':undefined}>
           {r.label}{r.note&&<span className="block text-[11px] font-normal opacity-80">{r.note}</span>}
          </dt>
          <dd className={'text-right tabular-nums whitespace-nowrap'+(r.strong?' font-semibold':'')}
           style={{color:r.muted?'var(--muted)':'var(--ink)'}}>{r.value}</dd>
         </Fragment>)}
        </dl>
        {message&&<div className="mt-2"><Notice tone="warning">{message}</Notice></div>}
       </>;
      })()}
      <details className="mt-1"><summary className="cursor-pointer font-semibold">Fee & route details</summary>
       <div className="mt-2 space-y-1 break-all">
        <p>{label(quote.source)} → {label(quote.destination)} · {quote.fromToken} → {mode==='swap'?quote.toToken:'USDC'}</p>
        <p>Recipient: {address}</p>
        <p>{mode==='swap'?'Slippage limit: 1%':
         'CCTP onchain fee cap: '+quote.bridgeMaxFee+' USDC; destination independently verified'}</p>
        <p>Source token: {token} · Destination token: {destToken}</p>
        <p>Network gas and wallet approvals are reviewed before signing.</p>
       </div>
      </details>
      {!signingReady&&notice&&<p role="status" className="mt-2" style={{color:'var(--warning)'}}>{notice.compact}</p>}
     </div>}
     {quoteExpired&&<p role="status" className="text-xs" style={{color:'var(--warning)'}}>
      Quote expired. Refresh before signing. No transaction was submitted.
     </p>}
    </div>}
    </>}
    {(recovery||unknownStorage)&&<section role="status" aria-label="Exchange tracking status"
     className="space-y-3 overflow-hidden rounded-2xl border p-3.5 shadow-sm sm:p-4"
     style={{
      borderColor:recovery?.status==='VERIFIED'?'rgba(70,186,153,.3)':'var(--border-strong)',
      background:recovery?.status==='VERIFIED'
       ?'linear-gradient(125deg,rgba(24,88,83,.2),rgba(11,31,59,.68) 78%)'
       :'linear-gradient(125deg,rgba(38,85,167,.19),rgba(12,29,60,.75) 70%,rgba(84,53,143,.14))',
      color:'var(--ink)',
     }}>
     <div className="flex flex-wrap items-center justify-between gap-2.5">
      <div className="flex min-w-0 items-center gap-2.5">
       <span className="flex size-9 shrink-0 items-center justify-center rounded-xl"
        style={{background:recovery?.status==='VERIFIED'?'rgba(51,174,146,.14)':'var(--accent-muted)',
         color:recovery?.status==='VERIFIED'?'var(--success)':'var(--accent)'}}>
        {recovery?.status==='VERIFIED'?<ShieldCheck className="size-4"/>:
         recovery?.status==='REVERTED'?<AlertTriangle className="size-4"/>:
         busy?<RefreshCw className="size-4 animate-spin" aria-label="Checking original transaction"/>:
         <LockKeyhole className="size-4" aria-hidden="true"/>}
       </span>
       <div className="min-w-0">
        <h2 className="text-sm font-bold leading-5">
         {recovery?.status==='VERIFIED'?title+' verified':
          recovery?.status==='REVERTED'?'Original transaction reverted':
          unknownStorage?'Recovery needs attention':'Tracking '+title}
        </h2>
        <p className="mt-0.5 text-[11px]" style={{color:'var(--muted)'}}>
         {recovery?.status==='VERIFIED'?'Verified destination receipt':
          recovery?.status==='REVERTED'?'Original onchain result':
          busy?'Checking onchain evidence':'Original operation · read-only tracking'}
        </p>
       </div>
      </div>
      <StatusPill tone={recovery?.status==='VERIFIED'?'success':
       recovery?.status==='REVERTED'||unknownStorage?'danger':'warning'}>
       {recovery?.status==='VERIFIED'?'Verified':recovery?.status==='REVERTED'?'Reverted':
        busy?'Checking':'Locked'}
      </StatusPill>
     </div>
     <p className="text-xs leading-5" style={{color:'var(--muted)'}}>
      {recovery?.status==='VERIFIED'?'Destination receipt verified onchain. Open the receipt for details.':
       recovery?.status==='REVERTED'?'The source transaction reverted onchain. Review its receipt before starting again.':
       unknownStorage?'Saved operation cannot be read. Signing remains locked; check Activity and wallet history.':
       'A previous '+title.toLowerCase()+' attempt is unresolved. Do not submit again until verified.'}
     </p>
     {recovery?.downgradedFrom&&recovery.status==='PENDING'&&
      <p className="text-[11px] leading-4" style={{color:'var(--muted)'}}>
       Previously saved as {recovery.downgradedFrom.toLowerCase()}; fresh onchain verification required.
       No funds were resent.
      </p>}
     {recovery&&recovery.status!=='VERIFIED'&&recovery.status!=='REVERTED'&&
      (mode==='bridge'?!recovery.burnHash:!recovery.hash)&&
      <p className="flex items-start gap-1.5 text-[11px] leading-4" style={{color:'var(--warning)'}}>
       <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden="true"/>
       Source hash unavailable on this device. Check your wallet or Activity.
      </p>}
     {(recovery?.hash||recovery?.burnHash||recovery?.mintHash)&&<details className="rounded-lg text-xs"
      style={{color:'var(--muted)'}}>
      <summary className="w-fit cursor-pointer font-medium underline-offset-4 hover:underline">Transaction details</summary>
      <div className="mt-2 space-y-1.5 break-all rounded-lg border p-2.5"
       style={{borderColor:'var(--border)',background:'rgba(5,19,44,.25)'}}>
       {recovery?.hash&&<p>Swap: {recovery.hash}</p>}
       {recovery?.burnHash&&<p>Burn: {recovery.burnHash}</p>}
       {recovery?.mintHash&&<p>Destination: {recovery.mintHash}</p>}
       {(recovery?.mintHash||recovery?.hash)&&<a target="_blank" rel="noreferrer"
        className="block font-semibold underline" style={{color:'var(--accent)'}}
        href={(recovery.destination===BASE?'https://basescan.org/tx/':'https://explorer.arc.io/tx/')+(recovery.mintHash||recovery.hash)}>
        View on explorer</a>}
      </div>
     </details>}
     <div className="flex flex-wrap items-center gap-2 pt-0.5" aria-label="Recovery actions">
      {recovery&&recovery.status!=='VERIFIED'&&recovery.status!=='REVERTED'&&
       (mode==='swap'?!!recovery.hash:!!recovery.burnHash)&&
       <button type="button" disabled={busy} onClick={()=>void verify()}
        aria-label="Verify destination onchain"
        className="veyra-btn-primary inline-flex min-h-10 min-w-0 flex-1 items-center justify-center gap-2 px-3 text-xs font-semibold disabled:opacity-50 sm:flex-none">
        <RefreshCw className={'size-3.5 shrink-0'+(busy?' animate-spin':'')}/>Verify onchain
       </button>}
      {onOpenActivity&&<button type="button" onClick={onOpenActivity}
       className="veyra-btn-secondary inline-flex min-h-10 min-w-0 flex-1 items-center justify-center gap-2 px-3 text-xs font-semibold sm:flex-none">
       <History className="size-3.5 shrink-0"/>Open Activity
      </button>}
      {recovery&&['VERIFIED','REVERTED'].includes(recovery.status)&&
       <button type="button" onClick={reset}
        className="veyra-btn-secondary inline-flex min-h-10 items-center px-3 text-xs font-semibold">
        Start new review
       </button>}
     </div>
    </section>}
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
