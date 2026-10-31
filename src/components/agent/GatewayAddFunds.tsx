import { useEffect, useMemo, useRef, useState } from 'react';
import { erc20Abi, formatUnits, getAddress, parseUnits, type Hash } from 'viem';
import { useAccount, usePublicClient, useSwitchChain, useWalletClient } from 'wagmi';
import {
  GATEWAY_TESTNET_SOURCES, GATEWAY_TESTNET_WALLET, isGatewayDepositAmount,
  fetchGatewayTestnetBalances,
} from '../../core/gateway/gatewayBalances';
import { activeSignedIdentityToken } from '../../lib/api/liveIdentitySession';
import { GATEWAY_DEPOSIT_ABI, isMatchingGatewayDepositTransaction } from '../../core/gateway/gatewayDepositRecovery';
import { VEYRA_ENV, IS_UI_ONLY_PREVIEW } from '../../lib/env';

interface PendingGatewayDeposit {
 owner:string;chainId:number;amount:string;txHash:Hash|null;sentAt:number;beforeAvailable:string;
}
function pendingKey(owner:string){return 'veyra:gateway:deposit:'+owner.toLowerCase();}
function loadPending(owner:string):PendingGatewayDeposit|null{
 try {
  const raw=localStorage.getItem(pendingKey(owner));
  if(!raw)return null;
  const p=JSON.parse(raw) as Partial<PendingGatewayDeposit>;
  if(p.owner?.toLowerCase()!==owner.toLowerCase() ||
     !GATEWAY_TESTNET_SOURCES.some(s=>s.chainId===p.chainId)||
     (p.txHash!==null&&(typeof p.txHash!=='string'||!/^0x[0-9a-f]{64}$/i.test(p.txHash)))||
     typeof p.amount!=='string'||!isGatewayDepositAmount(p.amount)||
     typeof p.beforeAvailable!=='string'||!/^\d+$/.test(p.beforeAvailable))return null;
  return p as PendingGatewayDeposit;
 }catch{return null;}
}

/** One canonical Gateway deposit transaction signer for all source testnets. */
export function GatewayAddFunds({onUpdate}: {onUpdate:()=>void}){
 const {address,isConnected}=useAccount();
 const {data:walletClient}=useWalletClient();
 const {switchChainAsync}=useSwitchChain();
 const arc=usePublicClient({chainId:GATEWAY_TESTNET_SOURCES[0].chainId});
 const eth=usePublicClient({chainId:GATEWAY_TESTNET_SOURCES[1].chainId});
 const base=usePublicClient({chainId:GATEWAY_TESTNET_SOURCES[2].chainId});
 const [sourceId,setSourceId]=useState<number>(GATEWAY_TESTNET_SOURCES[0].chainId);
 const [amount,setAmount]=useState('');
 const [review,setReview]=useState(false);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState<string|null>(null);
 const [recoveryHash,setRecoveryHash]=useState('');
 const [pending,setPending]=useState<PendingGatewayDeposit|null>(()=>address?loadPending(address):null);
 const inFlight=useRef(false);
 const source=GATEWAY_TESTNET_SOURCES.find(s=>s.chainId===sourceId)!;
 const client=useMemo(()=>sourceId===GATEWAY_TESTNET_SOURCES[0].chainId?arc:
  sourceId===GATEWAY_TESTNET_SOURCES[1].chainId?eth:base,[sourceId,arc,eth,base]);
 const disabled=VEYRA_ENV==='mainnet'||IS_UI_ONLY_PREVIEW;
 useEffect(()=>{
  setReview(false);setError(null);setRecoveryHash('');
  const recovered=address?loadPending(address):null;
  setPending(recovered);
  if(recovered)setSourceId(recovered.chainId);
 },[address]);
 async function sendDeposit(){
  if(busy||inFlight.current)return;
  inFlight.current=true;setBusy(true);setError(null);
  try{
   if(disabled)throw Error('Deposits require an authorized Testnet release. No transaction submitted.');
   if(!isConnected||!address||!walletClient?.account||!client)
    throw Error('Connect your verified wallet and the selected Testnet RPC.');
   if(pending)throw Error('A previous Gateway deposit remains unresolved; refresh Activity before another.');
   if(!activeSignedIdentityToken()) throw Error('Sign in with your current Veyra ID before depositing.');
   if(!review||!isGatewayDepositAmount(amount))throw Error('Review a positive USDC amount first.');
   if(await client.getChainId()!==sourceId)throw Error('Source RPC returned an unexpected chain ID.');
   const owner=getAddress(address);
   if(getAddress(walletClient.account.address)!==owner)
    throw Error('Active signing wallet changed. Review again.');
   const chain=await walletClient.getChainId();
   if(chain!==sourceId)throw Error('Select the reviewed deposit network in the wallet first.');
   // A transaction hash without a durable local checkpoint cannot be safely recovered.
   // Refuse signing if the browser cannot persist owner-bound recovery data.
   try{
    const probe=pendingKey(owner)+':write-check';
    localStorage.setItem(probe,'ok');localStorage.removeItem(probe);
   }catch{throw Error('Browser storage is unavailable. Enable local storage before depositing.');}
   const before=await fetchGatewayTestnetBalances(owner);
   const beforeAvailable=before.sources.find(x=>x.domain===source.domain);
   if(!beforeAvailable) throw Error('Gateway source ledger unavailable. No deposit submitted.');
   const token=getAddress(source.token);
   const gateway=getAddress(GATEWAY_TESTNET_WALLET);
   const value=parseUnits(amount,6);
   const [tokenCode,gatewayCode,balance,allowance]=await Promise.all([
    client.getCode({address:token}),client.getCode({address:gateway}),
    client.readContract({address:token,abi:erc20Abi,functionName:'balanceOf',args:[owner]}),
    client.readContract({address:token,abi:erc20Abi,functionName:'allowance',args:[owner,gateway]}),
   ]);
   if(!tokenCode||tokenCode==='0x'||!gatewayCode||gatewayCode==='0x')
    throw Error('Pinned Gateway or USDC contract was not verified on source chain.');
   if(balance<value)throw Error('Insufficient source wallet USDC.');
   if(allowance<value){
    // Exact allowance only; source-chain transaction requires separate consent.
    const simulation=await client.simulateContract({
      account:owner,address:token,abi:erc20Abi,functionName:'approve',args:[gateway,value],
    });
    const approval=await walletClient.writeContract({
      ...simulation.request,account:walletClient.account,chain:null,
    });
    const approved=await client.waitForTransactionReceipt({hash:approval});
    if(approved.status!=='success')throw Error('Gateway USDC approval reverted.');
    const checked=await client.readContract({
      address:token,abi:erc20Abi,functionName:'allowance',args:[owner,gateway],
    });
    if(checked<value)throw Error('Exact Gateway approval not confirmed.');
   }
   if(await walletClient.getChainId()!==sourceId||
      getAddress(walletClient.account.address)!==owner)
    throw Error('Wallet changed before deposit; no deposit submitted.');
   const simulation=await client.simulateContract({
     account:owner,address:gateway,abi:GATEWAY_DEPOSIT_ABI,functionName:'deposit',args:[token,value],
   });
   // The only allowed money move is GatewayWallet.deposit(). Do not use ERC20.transfer().
   // Persist the owner's exact intent BEFORE opening the wallet signature.
   // A crash after broadcast but before returning txHash must not allow a
   // second deposit. Resume by attaching the matching hash from wallet history.
   const checkpoint:PendingGatewayDeposit={owner:owner.toLowerCase(),chainId:sourceId,
     amount,txHash:null,sentAt:Date.now(),beforeAvailable:beforeAvailable.available.toString()};
   localStorage.setItem(pendingKey(owner),JSON.stringify(checkpoint));
   setPending(checkpoint);
   const txHash=await walletClient.writeContract({
     ...simulation.request,account:walletClient.account,chain:null,
   });
   const broadcast={...checkpoint,txHash};
   localStorage.setItem(pendingKey(owner),JSON.stringify(broadcast));
   setPending(broadcast);
   const receipt=await client.waitForTransactionReceipt({hash:txHash});
   if(receipt.status!=='success')
     throw Error('Gateway deposit reverted. Check the transaction before trying again.');
   // Source confirmation is not Gateway finality. Balance is queried independently.
   setReview(false);onUpdate();
  }catch(e){
   setError(e instanceof Error?e.message:'Deposit state could not be confirmed.');
  }finally{inFlight.current=false;setBusy(false);}
 }
 async function resume(){
  if(!pending||busy||!client)return;
  setBusy(true);setError(null);
  try{
   if(sourceId!==pending.chainId)throw Error('Select the pending deposit source chain to verify.');
   const hash=pending.txHash??(/^0x[0-9a-fA-F]{64}$/.test(recoveryHash)
    ?recoveryHash as Hash:null);
   if(!hash)throw Error('Find the deposit transaction hash in your wallet history before resuming.');
   const [tx,receipt]=await Promise.all([
    client.getTransaction({hash}),
    client.getTransactionReceipt({hash}),
   ]);
   if(!isMatchingGatewayDepositTransaction(tx,pending))
    throw Error('Stored deposit does not match the verified source transaction. Do not resend.');
   // Persist hash before any subsequent read or Circle finality wait.
   if(!pending.txHash){
    const linked={...pending,txHash:hash};
    localStorage.setItem(pendingKey(pending.owner),JSON.stringify(linked));
    setPending(linked);
   }
   if(receipt.status==='reverted'){
    const proofKey=pendingKey(pending.owner)+':reverted:'+hash;
    localStorage.setItem(proofKey,JSON.stringify({owner:pending.owner,chainId:pending.chainId,
      amount:pending.amount,txHash:hash,status:'reverted',checkedAt:Date.now()}));
    localStorage.removeItem(pendingKey(pending.owner));
    setPending(null);
    setError('Source transaction verified REVERTED. No Gateway deposit occurred; review a new request.');
   }else {
    const account=await fetchGatewayTestnetBalances(pending.owner);
    const source=GATEWAY_TESTNET_SOURCES.find(s=>s.chainId===pending.chainId)!;
    const latest=account.sources.find(s=>s.domain===source.domain);
    if(!latest)throw Error('Gateway source ledger unavailable.');
    if(latest.available>=BigInt(pending.beforeAvailable)+parseUnits(pending.amount,6)){
      localStorage.removeItem(pendingKey(pending.owner));
      setPending(null);
      onUpdate();
      setError('Source confirmed and Gateway deposit credit verified. Available has been refreshed.');
    }else{
      onUpdate();
      setError('Source confirmed; Gateway has not credited this deposit yet. Check again after finality.');
    }
   }
  }catch(e){setError(e instanceof Error && e.message.includes('does not match')?e.message:
    'Source receipt or Gateway credit unavailable. This is not evidence of failure; do not resend.');}
  finally{setBusy(false);}
 }
 return <div className="space-y-3 rounded-xl border p-3" style={{borderColor:'var(--border-strong)'}}
   aria-label="Add funds to Circle Gateway">
   <p className="text-sm font-semibold" style={{color:'var(--ink)'}}>Add funds to Gateway</p>
   <p className="text-xs" style={{color:'var(--muted)'}}>
     Deposit USDC into the official Gateway Wallet. Wallet balance decreases; Gateway Available increases only after source finality.
   </p>
   <label className="block text-xs" style={{color:'var(--muted)'}}>Source network
    <select value={sourceId} onChange={e=>{setSourceId(Number(e.target.value));setReview(false);}}
      className="mt-1 w-full rounded-xl border p-2" style={{borderColor:'var(--border)',background:'var(--surface)',color:'var(--ink)'}}>
      {GATEWAY_TESTNET_SOURCES.map(s=><option key={s.chainId} value={s.chainId}>{s.name}</option>)}
    </select>
   </label>
   <label className="block text-xs" style={{color:'var(--muted)'}}>Amount (USDC)
     <input value={amount} onChange={e=>{setAmount(e.target.value);setReview(false);}}
       inputMode="decimal" placeholder="0.00" className="mt-1 w-full rounded-xl border p-2"
       style={{borderColor:'var(--border)',background:'var(--surface)',color:'var(--ink)'}}/>
   </label>
   {review&&<div className="rounded-xl border p-2 text-xs leading-5" style={{borderColor:'var(--border-strong)',color:'var(--ink)'}}>
     <strong>Confirm:</strong> {amount} USDC from {source.name} to Circle Gateway Wallet
     <div className="break-all font-mono text-[10px]">{GATEWAY_TESTNET_WALLET}</div>
     {formatUnits(parseUnits(amount,6),6)} USDC · approval only if allowance insufficient · transaction fees depend on source chain.
   </div>}
   {pending&&<div className="rounded-xl border p-2 text-xs" style={{borderColor:'var(--border)'}}>
      Pending deposit · {pending.amount} USDC · network {pending.chainId}
      {pending.txHash?<p className="mt-1 break-all font-mono">{pending.txHash}</p>:
       <label className="block mt-2">Source transaction hash from your wallet
        <input value={recoveryHash} onChange={e=>setRecoveryHash(e.target.value)}
          placeholder="0x… (only if the deposit was broadcast)"
          className="mt-1 w-full rounded-lg border p-2"
          style={{borderColor:'var(--border)',background:'var(--surface)',color:'var(--ink)'}}/>
       </label>}
      <p className="mt-1">Await Gateway finality. Source confirmation alone is not Available.</p>
      <button type="button" disabled={busy} onClick={()=>void resume()} className="mt-2 underline">Verify deposit and Gateway credit</button>
   </div>}
   {error&&<p role="alert" className="text-xs" style={{color:'var(--warning)'}}>{error}</p>}
   {!pending&&<button type="button" disabled={busy||!isConnected||disabled||!isGatewayDepositAmount(amount)}
     className="rounded-xl border px-3 py-2 text-xs font-semibold disabled:opacity-40"
     style={{borderColor:'var(--border-strong)',color:'var(--ink)'}}
     onClick={()=>{if(review)void sendDeposit();else setReview(true);}}>
      {busy?'Checking transaction…':review?'Approve (if needed) and deposit':'Review deposit'}
   </button>}
   {!pending&&review&&<button type="button" className="ml-2 text-xs underline" onClick={()=>setReview(false)}>Edit</button>}
   {disabled&&<p className="text-[11px]" style={{color:'var(--warning)'}}>
     Deposit signing is locked on UI-only preview / Mainnet. An approved Testnet identity origin is required.
   </p>}
 </div>;
}
