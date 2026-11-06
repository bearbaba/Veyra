/** Mainnet Unified on Home. Provenance: Circle SDK ledger, not ERC20 wallet total.
 * All onchain writes are gated, explicit and checkpointed before provider calls.
 */
import {useEffect,useRef,useState} from 'react';
import {AppKit} from '@circle-fin/app-kit';
import {erc20Abi,formatUnits,isAddress,parseUnits,type EIP1193Provider} from 'viem';
import {useAccount,usePublicClient,useReadContracts,useSwitchChain} from 'wagmi';
import {ChevronDown,RefreshCw,ArrowDownLeft,SendHorizontal,Clock3,ShieldAlert} from 'lucide-react';
import {BrandLogo} from '../brand/BrandLogo';
import {useUnifiedSocial} from '@/features/social/UnifiedSocial';
import {isMainnetSessionForWallet} from '@/mainnet/signedWalletReceiptScope';
import {GATEWAY_MAINNET_CHAINS,GATEWAY_MAINNET_WRITE_ENABLED,
 gatewayMainnetAmount,fetchGatewayMainnetBalances,formatGatewayUsdc,
 type GatewayMainnetBalance} from '@/mainnet/gatewayMainnetBalances';
import {readGatewayMainnetOperation,type GatewayMainnetOperation} from '@/mainnet/gatewayMainnetJournal';
import {planGatewayMultiSource,matchingGatewayAllocation,type GatewayAllocation} from '@/mainnet/gatewayMultiSourceAllocation';
import {estimateGatewayMainnetSpend,submitGatewayMainnetReview,
 type GatewayMainnetReview} from '@/mainnet/gatewayMainnetExecution';
import type {GatewaySdkFee} from '@/core/gateway/gatewaySdkSpend';
import {MAINNET_CANARY_OWNER} from '@/mainnet/releaseGates';
const C=GATEWAY_MAINNET_CHAINS;
/** One-click funding picks an adequate confirmed source automatically;
 * aggregated balance is NOT proof that a single-source spend is possible. */
export function chooseGatewaySource(balance:GatewayMainnetBalance,raw:string):number|null{
 if(!gatewayMainnetAmount(raw))return null;
 const amount=parseUnits(raw,6);
 return [...balance.chains].filter(c=>c.available>=amount).sort((a,b)=>{
  if(a.available!==b.available)return a.available>b.available?-1:1;
  return a.chainId-b.chainId;
 })[0]?.chainId??null;
}
type Mode='deposit'|'spend';
export function MainnetUnifiedBalancePanel(){
 const {address,connector}=useAccount();
 const social=useUnifiedSocial();
 const signed= social.identityOrigin==='ready'&&
  isMainnetSessionForWallet(social.session,address,connector?.uid);
 const {switchChainAsync}=useSwitchChain();
 const eth=usePublicClient({chainId:1}),base=usePublicClient({chainId:8453}),arc=usePublicClient({chainId:5042});
 const [snapshot,setSnapshot]=useState<GatewayMainnetBalance|null>(null);
 const [scope,setScope]=useState('');
 const [loading,setLoading]=useState(false);
 const [error,setError]=useState('');
 const [operation,setOperation]=useState<GatewayMainnetOperation|null|'blocked'>(null);
 const [mode,setMode]=useState<Mode|null>(null);
 const [sourceId,setSourceId]=useState<number>(8453);
 const [destinationId,setDestinationId]=useState<number>(1);
 const [recipient,setRecipient]=useState('');
 const [amount,setAmount]=useState('');
 const [fees,setFees]=useState<GatewaySdkFee[]|null>(null);
 const [review,setReview]=useState(false);
 const reviewedPlan=useRef<GatewayMainnetReview|null>(null);
 const [advanced,setAdvanced]=useState(false);
 const [busy,setBusy]=useState(false);
 const owner=address?.toLowerCase()??'';
 const session=social.session?.token??'';
 const canRead=!!address&&signed;
 const current=scope===owner+':'+session?snapshot:null;
 const activeSource=C.find(x=>x.chainId===sourceId)!;
 const sourceLedger=current?.chains.find(x=>x.chainId===sourceId)?.available??null;
 const previous=operation!==null;
 const canPilot=GATEWAY_MAINNET_WRITE_ENABLED&&owner===MAINNET_CANARY_OWNER.toLowerCase();
 const {data:walletReads}=useReadContracts({
  contracts:C.map(x=>({address:x.usdc,abi:erc20Abi,functionName:'balanceOf' as const,
   chainId:x.chainId,args:[address??'0x0000000000000000000000000000000000000000'] as const})),
  query:{enabled:!!address,staleTime:18000,refetchInterval:30000},
 });
 const sourceWalletRaw=walletReads?.[C.findIndex(x=>x.chainId===sourceId)];
 const sourceWalletBalance=sourceWalletRaw?.status==='success'&&
  typeof sourceWalletRaw.result==='bigint'?sourceWalletRaw.result:null;
 const availableForSource=mode==='deposit'?sourceWalletBalance:advanced?sourceLedger:current?.available??null;
 function readJournal(){
  setOperation(address?readGatewayMainnetOperation(address):null);
 }
 useEffect(()=>{
  setScope('');setSnapshot(null);setError('');setMode(null);
  setRecipient(address??'');setReview(false);setFees(null);
  if(!address||!signed){setOperation(null);return;}
  const ownerAddress=address,activeSession=session;
  let active=true;
  const refresh=()=>{
   if(!active)return;
   setLoading(true);
   void fetchGatewayMainnetBalances(ownerAddress).then(value=>{
    if(active&&social.session?.token===activeSession){
     setSnapshot(value);setScope(ownerAddress.toLowerCase()+':'+activeSession);setError('');
    }
   }).catch(e=>{
    if(active){setError(e instanceof Error?e.message:'Circle Gateway ledger unavailable.');
     setSnapshot(null);setScope('');}
   }).finally(()=>{if(active)setLoading(false);});
   setOperation(readGatewayMainnetOperation(ownerAddress));
  };
  refresh();
  const interval=window.setInterval(refresh,60000);
  window.addEventListener('focus',refresh);
  const changed=()=>refresh();
  window.addEventListener('veyra:gateway:mainnet',changed);
  return()=>{active=false;window.clearInterval(interval);
   window.removeEventListener('focus',refresh);window.removeEventListener('veyra:gateway:mainnet',changed);};
 },[address,signed,session]);
 function selectMode(next:Mode){
  setMode(next);setAmount('');setFees(null);setReview(false);setError('');setRecipient(address??'');setAdvanced(false);
 }
 function selectSource(id:number){
  if(!C.some(x=>x.chainId===id))return;
  setSourceId(id);setFees(null);setReview(false);
 }
 function selectDestination(id:number){
  if(!C.some(x=>x.chainId===id))return;
  setDestinationId(id);setFees(null);setReview(false);
 }
 const validAmount=gatewayMainnetAmount(amount);
 const units=validAmount?parseUnits(amount,6):0n;
 let allocations:GatewayAllocation[]=[];
 if(mode==='spend'&&current&&validAmount){
  try{allocations=planGatewayMultiSource(current,amount,advanced?sourceId:undefined);}
  catch{/* Confirmed source liquidity insufficient. */}
 }
 const enough=mode==='spend'?allocations.length>0:
  availableForSource!==null&&units>0n&&units<=availableForSource;
 const validRecipient=!!address&&isAddress(recipient);
 const good=!!current&&!previous&&validAmount&&enough&&validRecipient&&signed&&!loading;
 async function connectedProvider(frozenSource?:number):Promise<EIP1193Provider>{
  if(!address||!connector)throw Error('Connect your wallet first.');
  await switchChainAsync({chainId:frozenSource??(mode==='spend'?allocations[0]?.chainId??sourceId:sourceId)});
  const raw:unknown=await connector.getProvider();
  if(!raw||typeof raw!=='object'||!('request' in raw)||
   typeof raw.request!=='function')throw Error('Connected wallet provider is unavailable.');
  return raw as EIP1193Provider;
 }
 function checkpoint():GatewayMainnetReview{
  if(!current||!address||!social.session?.token||!mode)
   throw Error('Connect and sign into your Veyra ID to review Unified.');
  return {kind:mode,owner:address,sourceChainId:mode==='spend'?allocations[0]?.chainId??sourceId:sourceId,
   ...(mode==='spend'?{allocations,manualSourceChainId:advanced?sourceId:undefined}:{}),
   ...(mode==='spend'?{destinationChainId:destinationId}:{}),
   recipient,amount,balance:current,sessionToken:social.session.token,fees:fees??[]};
 }
 async function preview(){
  if(!good||busy)return;
  setBusy(true);setError('');
  try{
   const planned=checkpoint();
   if(mode==='spend'){
    const provider=await connectedProvider(planned.sourceChainId);
    const estimated=await estimateGatewayMainnetSpend(planned,provider);
    setFees(estimated);
    reviewedPlan.current={...planned,fees:estimated};
   }else reviewedPlan.current=planned;
   setReview(true);
  }catch(e){setError(e instanceof Error?e.message:'Gateway estimate could not be verified.');}
  finally{setBusy(false);}
 }
 async function execute(){
  if(!review||!good||busy||!canPilot||!reviewedPlan.current)return;
  setBusy(true);setError('');
  try{
   const frozen=reviewedPlan.current;
   const latest=checkpoint();
   if(latest.owner!==frozen.owner||latest.kind!==frozen.kind||
    latest.recipient.toLowerCase()!==frozen.recipient.toLowerCase()||
    latest.amount!==frozen.amount||latest.sourceChainId!==frozen.sourceChainId||
    latest.destinationChainId!==frozen.destinationChainId||
    latest.sessionToken!==frozen.sessionToken||
    latest.balance.readAt!==frozen.balance.readAt||
    latest.manualSourceChainId!==frozen.manualSourceChainId||
    !matchingGatewayAllocation(latest.allocations??[],frozen.allocations??[]))
    throw Error('Balance or route changed after review. Review sources and fees again; no signature requested.');
   const provider=await connectedProvider(frozen.sourceChainId);
   const id=frozen.sourceChainId;
   const client=id===1?eth:id===8453?base:arc;
   if(!client)throw Error('Source network RPC unavailable.');
   const confirmed=await submitGatewayMainnetReview(frozen,provider,client);
   setOperation(confirmed);setReview(false);setFees(null);
   setError('Original transaction saved in Activity. Wait for independent Gateway confirmation; do not submit again.');
  }catch(e){
   setOperation(address?readGatewayMainnetOperation(address):null);
   setError(e instanceof Error?e.message:'Original transfer outcome is uncertain. Do not sign again.');
  }finally{setBusy(false);}
 }
 const fmt=(x:bigint|null)=>formatGatewayUsdc(x);
 return <div className="mt-4 border-t pt-4" style={{borderColor:'var(--border)'}} aria-label="Unified Balance">
  <div className="flex flex-wrap items-start justify-between gap-3">
   <div><p className="text-sm font-bold" style={{color:'var(--ink)'}}>Unified Balance</p>
    <p className="mt-1 text-xs" style={{color:'var(--muted)'}}>Circle Gateway · Arc, Ethereum and Base</p></div>
   <button type="button" aria-label="Refresh Unified Balance" disabled={!canRead||loading}
    onClick={()=>{if(!address)return;setLoading(true);
     void fetchGatewayMainnetBalances(address).then(x=>{setSnapshot(x);setScope(owner+':'+session);setError('');})
      .catch(e=>setError(e instanceof Error?e.message:'Gateway balance unavailable.'))
      .finally(()=>setLoading(false));readJournal();}}
    className="veyra-icon-button disabled:opacity-40">
    <RefreshCw className={'size-4 '+(loading?'animate-spin':'')}/>
   </button>
  </div>
  <div className="mt-3 grid grid-cols-2 gap-3">
   <div><p className="text-xs" style={{color:'var(--muted)'}}>Available</p>
    <p className="mt-1 text-2xl font-bold tabular-nums" style={{color:'var(--ink)'}}>{canRead?fmt(current?.available??null):'—'}
     <span className="ml-1 text-xs font-semibold" style={{color:'var(--muted)'}}>USDC</span></p></div>
   <div><p className="text-xs" style={{color:'var(--muted)'}}>Pending</p>
    <p className="mt-1 text-2xl font-bold tabular-nums" style={{color:'var(--ink)'}}>{canRead?fmt(current?.pending??null):'—'}
     <span className="ml-1 text-xs font-semibold" style={{color:'var(--muted)'}}>USDC</span></p></div>
  </div>
  {!canRead?<p className="mt-2 text-xs" style={{color:'var(--muted)'}}>
   Connect a wallet and sign in to Veyra ID to read the owner's Gateway ledger.
  </p>:error&&<p role="alert" className="mt-2 text-xs" style={{color:'var(--warning)'}}>{error}</p>}
  <p className="mt-2 text-xs" style={{color:'var(--muted)'}}>
   {current?'Available is the current Circle Gateway ledger, not a sum of deposit receipts. Pending is separate and not spendable.':
    'Gateway values are not confirmed in this session; wallet funds remain separate.'}
  </p>
  {current&&<details className="mt-2 text-xs" style={{color:'var(--muted)'}}>
   <summary className="cursor-pointer">Details · source networks</summary>
   <div className="mt-2 space-y-1">{current.chains.map(c=><div key={c.chainId} className="flex justify-between">
    <span>{c.chain}</span><span className="tabular-nums">{formatUnits(c.available,6)} USDC</span>
   </div>)}</div>
   <p className="mt-2">Confirmed source balances only. Last checked {new Date(current.readAt).toLocaleTimeString()}.</p>
  </details>}
  {previous&&<p role="status" className="mt-3 rounded-xl border p-3 text-xs"
   style={{borderColor:'var(--border)',color:'var(--warning)'}}>
   <Clock3 className="mr-1 inline size-4"/>
   {operation==='blocked'?'Previous Unified recovery data is unreadable. Do not submit another transaction.':
    operation?.kind==='deposit'?'The original Gateway deposit is not finalized onchain. Check Activity; a finalized deposit will release this submission lock.':
    'Unified transfer outcome is not independently verified. Check Activity before another.'}
  </p>}
  <div className="mt-3 flex flex-wrap gap-2">
   <button type="button" disabled={!canRead||!current||previous} onClick={()=>selectMode('deposit')}
    className="veyra-btn-secondary flex min-h-10 items-center gap-2 rounded-xl px-3 text-xs font-semibold disabled:opacity-40">
    <ArrowDownLeft className="size-4"/> Add USDC</button>
   <button type="button" disabled={!canRead||!current||previous||current.available<=0n} onClick={()=>selectMode('spend')}
    className="veyra-btn-secondary flex min-h-10 items-center gap-2 rounded-xl px-3 text-xs font-semibold disabled:opacity-40">
    <SendHorizontal className="size-4"/> Send to wallet</button>
  </div>
  {!GATEWAY_MAINNET_WRITE_ENABLED&&<p className="mt-2 text-xs" style={{color:'var(--muted)'}}>
   Gateway transactions are not enabled in Veyra yet. You can inspect the live ledger and review supported routes without signing.
  </p>}
  {mode&&current&&!previous&&<section className="mt-3 space-y-3 rounded-xl border p-3"
   style={{background:'var(--surface-raised)',borderColor:'var(--border)'}} aria-label={mode==='deposit'?'Gateway deposit panel':'Unified transfer panel'}>
   {!GATEWAY_MAINNET_WRITE_ENABLED&&<p role="status" className="text-xs font-semibold"
    style={{color:'var(--warning)'}}>Quotes and review only · Mainnet transfers paused</p>}
   <div className="flex items-center justify-between">
    <p className="text-sm font-bold">{mode==='deposit'?'Add USDC':'Send Unified USDC'}</p>
    <button type="button" onClick={()=>setMode(null)} className="veyra-btn-secondary px-2 text-xs">Close</button>
   </div>
   <p className="text-xs" style={{color:'var(--muted)'}}>
    {mode==='deposit'?'Source deposit finality and Circle Gateway Available are separate milestones. Only the provider ledger is spendable.':
     'The Circle forwarding service pays destination gas from its quoted fee. No automatic trustless withdrawal.'}
   </p>
   {mode==='spend'&&<button type="button" className="text-xs underline"
    onClick={()=>{setAdvanced(value=>!value);setReview(false);setFees(null);}}>
    {advanced?'Automatic source selection':'Advanced · select one source'}
   </button>}
   {(mode==='deposit'||advanced)&&<div><p className="mb-1 text-xs font-semibold">Source network</p>
    <div className="grid grid-cols-2 gap-2">{C.map(c=><button type="button" key={c.chainId}
     onClick={()=>selectSource(c.chainId)} aria-pressed={sourceId===c.chainId}
     className="veyra-route-control flex min-w-0 items-center gap-2 rounded-xl border p-2 text-left"
     style={{background:sourceId===c.chainId?'var(--accent-muted)':'var(--surface)',
      borderColor:sourceId===c.chainId?'var(--border-strong)':'var(--border)'}}>
     <BrandLogo logoKey={c.logo} size={26}/><span className="truncate text-xs font-semibold">{c.chain}</span>
    </button>)}</div></div>}
   {mode==='spend'&&<div><p className="mb-1 text-xs font-semibold">Destination network</p>
    <div className="grid grid-cols-2 gap-2">{C.map(c=><button type="button" key={c.chainId}
     onClick={()=>selectDestination(c.chainId)} aria-pressed={destinationId===c.chainId}
     className="veyra-route-control flex min-w-0 items-center gap-2 rounded-xl border p-2 text-left"
     style={{background:destinationId===c.chainId?'var(--accent-muted)':'var(--surface)',
      borderColor:destinationId===c.chainId?'var(--border-strong)':'var(--border)'}}>
     <BrandLogo logoKey={c.logo} size={26}/><span className="truncate text-xs font-semibold">{c.chain}</span>
    </button>)}</div></div>}
   <label className="block text-xs font-semibold">Amount · USDC
    <input value={amount} onChange={e=>{const next=e.target.value;setAmount(next);setReview(false);setFees(null);
     if(mode==='spend'&&!advanced&&current){const preferred=chooseGatewaySource(current,next);
      if(preferred!==null)setSourceId(preferred);}
    }}
     inputMode="decimal" placeholder="0.00" maxLength={24}
     className="veyra-route-input mt-2 w-full rounded-xl border p-3 text-2xl font-bold tabular-nums"
     style={{background:'var(--surface)',borderColor:'var(--border)',color:'var(--ink)'}}/>
   </label>
   <div className="flex items-center justify-between text-xs" style={{color:'var(--muted)'}}>
    <span>{mode==='deposit'?'Wallet':advanced?'Selected source':'Combined confirmed'} available: {fmt(availableForSource)} USDC</span>
    <button type="button" disabled={availableForSource===null||availableForSource===0n}
     onClick={()=>{if(availableForSource===null)return;
      setAmount(formatUnits(availableForSource>10000n?10000n:availableForSource,6));
      setReview(false);setFees(null);}}
     className="veyra-btn-secondary px-2 disabled:opacity-40">Max pilot</button>
   </div>
   {mode==='spend'&&<label className="block text-xs font-semibold">Recipient wallet
    <input value={recipient} onChange={e=>{setRecipient(e.target.value);setReview(false);setFees(null);}}
     className="veyra-route-input mt-2 w-full rounded-xl border p-3 text-sm"
     style={{background:'var(--surface)',borderColor:'var(--border)',color:'var(--ink)'}}/>
   </label>}
   {mode==='spend'&&!advanced&&allocations.length>1&&<p className="text-xs" style={{color:'var(--accent)'}}>
    One Circle transfer can use {allocations.length} confirmed sources. Review exact source amounts and fees before signing.
   </p>}
   {!enough&&validAmount&&<p className="text-xs" style={{color:'var(--warning)'}}>
    Insufficient confirmed {mode==='spend'?'Gateway Available':'wallet USDC on '+activeSource.chain}.
   </p>}
   {review&&<div className="rounded-lg border p-3 text-xs" style={{borderColor:'var(--border)'}}>
    <p className="font-semibold">Review · {reviewedPlan.current?.amount??amount} USDC {mode==='spend'?'· '+(reviewedPlan.current?.allocations?.length??allocations.length)+' source(s)':'· '+activeSource.chain}</p>
    {mode==='spend'&&<div className="mt-2 space-y-1" aria-label="Reviewed source allocations">
      {(reviewedPlan.current?.allocations??allocations).map(a=><p key={a.chainId}>{a.chain} · {a.amount} USDC</p>)}
    </div>}
    <p className="mt-1">{mode==='spend'?'To '+recipient+' on '+C.find(c=>c.chainId===destinationId)?.chain:
     'Deposit to Circle Gateway · same wallet owner'}</p>
    <p className="mt-1">Fees: {mode==='spend'?(fees?.map(f=>f.type+': '+f.amount+' '+f.token).join(' · ')||'Unavailable'):
     'Network gas shown by wallet; not estimated by Veyra'}</p>
    <p className="mt-1">A provider result is not final settlement. Each source and destination must be independently verified; no automatic resend.</p>
   </div>}
   <button type="button" disabled={!good||busy||review}
    onClick={()=>void preview()} className="veyra-btn-secondary w-full py-3 disabled:opacity-40">
    {busy?'Checking…':mode==='deposit'?'Review deposit':'Review transfer fees'}
   </button>
   {review&&<button type="button" onClick={()=>void execute()} disabled={!canPilot||busy||!good}
    className="veyra-btn-primary w-full py-3 disabled:opacity-40">
    {canPilot?'Confirm in wallet':'Transfers paused · Mainnet canary not accepted'}
   </button>}
   <p className="text-[11px]" style={{color:'var(--muted)'}}>
    Circle Gateway standard trustless withdrawal is a separate seven-day recovery process and is not enabled here.
   </p>
  </section>}
 </div>;
}
