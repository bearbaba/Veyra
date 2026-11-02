/** Arc Mainnet wallet-to-wallet USDC Pay. Uses the existing hardened canary pipeline.
 * Real wallet signature only; fail-closed preflight and recovery lock prevent duplicate retries.
 */
import { useEffect, useRef, useState } from 'react';
import { useAccount, useSwitchChain } from 'wagmi';
import { ConnectKitButton } from 'connectkit';
import { formatUnits } from 'viem';
import { recordLocalOperation } from '@/mainnet/localOperations';
import {saveVerifiedMainnetPayReceipt} from '@/lib/api/mainnetPayReceipts';
import {verifyPaymentRecipient} from '@/lib/api/identityApi';
import {useUnifiedSocial} from '@/features/social/UnifiedSocial';
import {validVerifiedRecipient,type VerifiedMainnetRecipient} from '@/mainnet/verifiedRecipient';
import type {MainnetPayDraft} from '@/mainnet/payDraft';
import {assertMainnetSigningAllowed,MAINNET_EMERGENCY_READ_ONLY} from '@/mainnet/releaseGates';
import { AlertTriangle, ExternalLink, ShieldCheck, CheckCircle2 } from 'lucide-react';
import {
  buildMainnetPayPlan, mainnetPreflight, requestMainnetCanaryTransfer,
  reconcileMainnetCanary, mainnetExplorerTx, type MainnetWallet,
  type MainnetPlan, type MainnetPreflight, type MainnetReconciliation,
} from '@/mainnet/arcMainnetPay';
import {
  readMainnetJournal, writeMainnetJournal, clearMainnetJournal,
  storageForMainnet, type MainnetJournal,
} from '@/mainnet/arcMainnetJournal';

const box = 'rounded-2xl border p-5 sm:p-6';
const field = 'w-full rounded-xl border px-4 py-3 text-sm';
type Review = {plan: MainnetPlan; preflight: MainnetPreflight};

export function MainnetPayPage({friendHandle,recipientWallet,onRecipientUsed,embedded=false,sharedDraft,onDraftChange,verifiedRecipient}:{friendHandle?:string|null;recipientWallet?:string|null;onRecipientUsed?:()=>void;embedded?:boolean;sharedDraft?:MainnetPayDraft;onDraftChange?:(patch:Partial<MainnetPayDraft>)=>void;verifiedRecipient?:VerifiedMainnetRecipient|null}) {
  const {address, chainId, connector, isConnected} = useAccount();
  const social=useUnifiedSocial();
  async function reverifySelectedIdentity(plan:MainnetPlan){
    if(verifiedRecipient&&!idSelection)
      throw Error('Recipient differs from the reviewed Veyra ID. Change person or verify again in People.');
    if(!idSelection)return;
    if(!validVerifiedRecipient(idSelection,plan.from,plan.to))
      throw Error('Recipient Veyra ID snapshot expired. Return to People to verify the current wallet.');
    if(social.identityOrigin!=='ready'||!social.session?.token)
      throw Error('Signed identity session is no longer available. Reverify the recipient in People.');
    await verifyPaymentRecipient({snapshotId:idSelection.snapshotId,expectedWalletId:idSelection.walletId,
      expectedWalletAddress:plan.to,expectedChainId:5042,reviewToken:idSelection.reviewToken},social.session.token);
  }
  const {switchChain} = useSwitchChain();
  const [recipient,setRecipient] = useState('');
  const idSelection=verifiedRecipient&&address&&recipient.toLowerCase()===verifiedRecipient.wallet.toLowerCase()
    &&verifiedRecipient.owner.toLowerCase()===address.toLowerCase()?verifiedRecipient:null;
  const [amount,setAmount] = useState('');
  const [review,setReview] = useState<Review|null>(null);
  const [ack,setAck] = useState(false);
  const [busy,setBusy] = useState(false);
  const lock = useRef(false);
  const [journal,setJournal] = useState<MainnetJournal|null>(null);
  const [blockedStorage,setBlockedStorage] = useState(false);
  const [loadedFor,setLoadedFor] = useState<string|null>(null);
  const [hashInput,setHashInput] = useState('');
  const [receipt,setReceipt] = useState<MainnetReconciliation|null>(null);
  const [error,setError] = useState<string|null>(null);
  const [syncNonce,setSyncNonce]=useState(0);
  const [receiptSync,setReceiptSync]=useState<'idle'|'saving'|'saved'|'unavailable'>('idle');
  const syncedFor=useRef<string|null>(null);

  useEffect(()=>{
    setReview(null);setAck(false);setReceipt(null);setError(null);
    if(!address){setJournal(null);setBlockedStorage(false);setLoadedFor(null);return;}
    const stored=readMainnetJournal(address,storageForMainnet());
    setJournal(stored.kind==='active'?stored.value:null);
    setBlockedStorage(stored.kind==='blocked');
    setLoadedFor(address.toLowerCase());
  },[address]);
  useEffect(()=>{setReview(null);setAck(false);},[chainId,connector]);
  useEffect(()=>{
    if(!sharedDraft)return;
    setRecipient(sharedDraft.recipient);
    setAmount(sharedDraft.amount);
    setReview(null);setAck(false);
  },[sharedDraft?.recipient,sharedDraft?.amount]);
  useEffect(()=>{
    if(!recipientWallet)return;
    if(/^0x[0-9a-fA-F]{40}$/.test(recipientWallet)){
      setRecipient(recipientWallet);setAmount('');setReview(null);setAck(false);setError(null);
    }
    onRecipientUsed?.();
  },[recipientWallet,onRecipientUsed]);
  async function provider():Promise<MainnetWallet>{
    const w:unknown=await connector?.getProvider();
    if(!w||typeof w!=='object'||!('request' in w)||typeof w.request!=='function')
      throw new Error('Wallet provider unavailable; reconnect your wallet.');
    return w as MainnetWallet;
  }
  const msg=(e:unknown)=>e instanceof Error?e.message:'Wallet or RPC unavailable; check activity before retrying.';
  const ready=!!address&&isConnected&&loadedFor===address.toLowerCase();
  const blocked=!ready||blockedStorage||!!journal||busy||chainId!==5042;
  async function prepare(){
    if(!address||blocked||lock.current)return;
    lock.current=true;setBusy(true);setError(null);setReview(null);
    try {
      const plan=buildMainnetPayPlan(address,recipient.trim(),amount.trim());
      const preflight=await mainnetPreflight(await provider(),plan);
      await reverifySelectedIdentity(plan);
      setReview({plan,preflight});setAck(false);
    }catch(e){setError(msg(e));}
    finally{lock.current=false;setBusy(false);}
  }
  async function send(){
    if(!address||!review||!ack||blocked||lock.current)return;
    try{assertMainnetSigningAllowed();}catch(e){setError(msg(e));return;}
    lock.current=true;setBusy(true);setError(null);
    const initial:MainnetJournal={from:review.plan.from,to:review.plan.to,amount:review.plan.amount,hash:null,stage:'AWAITING_WALLET',
      note:sharedDraft?.note?.trim().slice(0,120)||undefined,
      recipientLabel:idSelection?'@'+idSelection.veyraHandle+'.veyra':undefined};
    let requested=false;
    try {
      await reverifySelectedIdentity(review.plan);
      if(readMainnetJournal(address,storageForMainnet()).kind!=='empty')
        throw new Error('Earlier transaction record exists. Do not resubmit.');
      if(!writeMainnetJournal(initial,storageForMainnet()))
        throw new Error('Cannot persist payment lock. Signing disabled.');
      setJournal(initial);
      const hash=await requestMainnetCanaryTransfer(await provider(),review.plan,()=>{requested=true;});
      const next:MainnetJournal={...initial,hash,stage:'PENDING'};
      setJournal(next);setHashInput(hash);
      recordLocalOperation({type:'Pay',hash,owner:address,amount:review.plan.amount,asset:'USDC',chainId:5042,
       status:'SUBMITTED',destination:review.plan.to,
       note:sharedDraft?.note?.trim().slice(0,120)||undefined,
       recipientLabel:idSelection?'@'+idSelection.veyraHandle+'.veyra':undefined});
      if(!writeMainnetJournal(next,storageForMainnet()))
        setError('Payment submitted but hash storage failed. Keep this hash and do not retry: '+hash);
    }catch(e){
      const rejected=typeof e==='object'&&e!==null&&'code' in e&&(e.code===4001||e.code==='ACTION_REJECTED');
      if(!requested||rejected){
        if(clearMainnetJournal(initial.from,storageForMainnet()))setJournal(null);
      }else{
        const unknown:MainnetJournal={...initial,stage:'UNKNOWN'};
        writeMainnetJournal(unknown,storageForMainnet());setJournal(unknown);
      }
      setError(msg(e)+(requested&&!rejected?' Status uncertain; do not retry.':''));
    }finally{lock.current=false;setBusy(false);setReview(null);setAck(false);}
  }
  async function verify(){
    if(!journal||!address||lock.current)return;
    lock.current=true;setBusy(true);setError(null);
    try{
      const plan=buildMainnetPayPlan(journal.from,journal.to,journal.amount);
      const result=await reconcileMainnetCanary(plan,journal.hash||hashInput);
      setReceipt(result);
      const next:MainnetJournal={...journal,hash:result.hash,
        stage:result.state==='VERIFIED'?'VERIFIED':result.state==='REVERTED'?'REVERTED':'PENDING'};
      setJournal(next);
      if(result.state==='VERIFIED')recordLocalOperation({type:'Pay',hash:result.hash,owner:address,amount:journal.amount,asset:'USDC',chainId:5042,status:'RECORDED',destination:journal.to});
      if(!writeMainnetJournal(next,storageForMainnet()))
        setError('Could not save receipt state. Preserve the transaction hash.');
    }catch(e){setError(msg(e)+' Previous transaction lock remains.');}
    finally{lock.current=false;setBusy(false);}
  }
  // After a wallet signs, reconcile against Arc automatically; never submit again.
  useEffect(()=>{
    if(!address||!journal?.hash||journal.stage!=='PENDING')return;
    let live=true;
    let checking=false;
    const snapshot=journal;
    async function poll(){
      if(checking)return;
      checking=true;
      try{
        const plan=buildMainnetPayPlan(snapshot.from,snapshot.to,snapshot.amount);
        const result=await reconcileMainnetCanary(plan,snapshot.hash!);
        if(!live)return;
        setReceipt(result);
        if(result.state==='VERIFIED'||result.state==='REVERTED'){
          const next:MainnetJournal={...snapshot,stage:result.state};
          if(result.state==='VERIFIED')recordLocalOperation({type:'Pay',hash:snapshot.hash!,owner:snapshot.from,amount:snapshot.amount,asset:'USDC',chainId:5042,status:'RECORDED',destination:snapshot.to});
          if(writeMainnetJournal(next,storageForMainnet()))setJournal(next);
          else setError('Receipt confirmed but local history could not be saved. Preserve the transaction hash.');
        }
      }catch(e){
        if(live)setError('Receipt check failed: '+(e instanceof Error?e.message:'RPC unavailable')+'. No duplicate payment will be submitted.');
      }finally{checking=false;}
    }
    void poll();
    const timer=window.setInterval(()=>void poll(),10000);
    return()=>{live=false;window.clearInterval(timer);};
  },[address,journal?.hash,journal?.stage,journal?.from,journal?.to,journal?.amount]);
  // Only after the original wallet transaction is independently VERIFIED.
  // Backend verifies the exact same onchain evidence again and never signs/retries.
  // A network failure here does not invalidate the wallet receipt or unlock a send.
  useEffect(()=>{
    const token=social.session?.token;
    if(!address||!token||social.identityOrigin!=='ready'||journal?.stage!=='VERIFIED'||!journal.hash)return;
    if(journal.from.toLowerCase()!==address.toLowerCase())return;
    const key=journal.hash.toLowerCase()+':'+token+':'+syncNonce;
    if(syncedFor.current===key)return;
    syncedFor.current=key;setReceiptSync('saving');
    let active=true;
    void saveVerifiedMainnetPayReceipt(token,{
      hash:journal.hash,note:journal.note,
      ...(idSelection?.snapshotId?{snapshotId:idSelection.snapshotId}:{}),
    }).then(()=>{
      if(!active)return;
      setReceiptSync('saved');
      window.dispatchEvent(new Event('veyra:mainnet:server-receipt'));
    }).catch(()=>{if(active)setReceiptSync('unavailable');});
    return()=>{active=false;};
  },[address,social.session?.token,social.identityOrigin,journal?.hash,journal?.stage,journal?.note,
      journal?.from,idSelection?.snapshotId,syncNonce]);
  function reset(){
    if(!address||!journal||!['VERIFIED','REVERTED'].includes(journal.stage)||lock.current)return;
    if(!clearMainnetJournal(address,storageForMainnet())){setError('Cannot clear payment lock.');return;}
    setJournal(null);setReview(null);setReceipt(null);setRecipient('');setAmount('');setHashInput('');
  }
  return <div className={embedded?'space-y-4':'mx-auto w-full max-w-2xl space-y-5 px-4 py-7 md:px-7 md:py-9'}>
    {!embedded&&<div>
      <span className="text-xs font-bold uppercase" style={{color:'var(--accent)'}}>Arc Mainnet · 5042</span>
      <h1 className="display mt-2 text-3xl font-bold" style={{color:'var(--ink)'}}>Pay</h1>
      <p className="mt-2 text-sm" style={{color:'var(--muted)'}}>
        Send USDC to a wallet. Veyra automatically tracks and checks the receipt.
      </p>
    </div>}
    <div className={box} style={{background:'var(--surface)',borderColor:'var(--border)'}}>
      <div className="flex items-start gap-3 text-sm" style={{color:'var(--muted)'}}>
        <ShieldCheck className="size-5 shrink-0" style={{color:'var(--accent)'}}/>
        <p><strong style={{color:'var(--ink)'}}>Direct wallet transfer · limit 1 USDC.</strong> Your wallet confirms this payment once; no token spending permission is granted.
          If it remains pending, Veyra checks the existing transaction rather than sending again.</p>
      </div>
    </div>
    {journal?.stage==='VERIFIED'&&social.session?.token&&
      <div role="status" className="rounded-lg border p-3 text-sm"
        style={{borderColor:'var(--border)',color:'var(--muted)'}}>
        {receiptSync==='saved'?'Verified receipt saved to your Veyra account.':
         receiptSync==='saving'?'Saving your verified receipt to Veyra…':
         'Onchain payment verified. Account receipt is not synced yet.'}
        {receiptSync==='unavailable'&&
          <button type="button" className="ml-2 font-semibold" style={{color:'var(--accent)'}}
            onClick={()=>setSyncNonce(n=>n+1)}>Retry receipt sync</button>}
      </div>}
    {idSelection&&<div role="status" className={box} style={{background:'var(--surface)',borderColor:'var(--border)',color:'var(--ink)'}}>
      <p className="text-sm font-semibold">{'Send to @'+idSelection.veyraHandle+'.veyra'}</p>
      <p className="mt-1 text-xs" style={{color:'var(--muted)'}}>Verified recipient snapshot · address will be rechecked by the backend before signing.</p>
      <p className="mt-2 break-all font-mono text-xs">{idSelection.wallet}</p>
    </div>}
    {friendHandle&&<div role="status" className={box} style={{background:'var(--surface)',borderColor:'var(--border)',color:'var(--warning)'}}>
      Paying {friendHandle} by Veyra ID is not activated on Mainnet. No recipient address has been substituted.
      Use the direct wallet transfer only after verifying the exact recipient address.
    </div>}
    {!isConnected?<div className={box} style={{background:'var(--surface)',borderColor:'var(--border)'}}>
      <p className="mb-3 text-sm" style={{color:'var(--muted)'}}>Connect your wallet to pay.</p><ConnectKitButton/>
    </div>:<>
      {chainId!==5042&&<div className={box} role="alert" style={{background:'var(--surface)',borderColor:'var(--border)'}}>
        <div className="flex items-center gap-2 text-sm" style={{color:'var(--warning)'}}>
          <AlertTriangle className="size-5"/> Wrong network. Payment cannot use Testnet on this Mainnet website.
        </div>
        <button className="mt-3 rounded-xl px-4 py-2 text-sm font-semibold"
          style={{background:'var(--accent)',color:'#fff'}} onClick={()=>switchChain({chainId:5042})}>Switch to Arc Mainnet</button>
      </div>}
      <div className={box+' space-y-4'} style={{background:'var(--surface)',borderColor:'var(--border)'}}>
        {!embedded&&<><div><label className="text-sm font-semibold" style={{color:'var(--ink)'}}>Recipient wallet</label>
          <input className={field+' mt-2'} style={{background:'var(--surface-raised)',borderColor:'var(--border)',color:'var(--ink)'}}
            value={recipient} maxLength={42} autoComplete="off" spellCheck={false} placeholder="0x…"
            disabled={blocked} onChange={e=>{setRecipient(e.target.value);onDraftChange?.({recipient:e.target.value});setReview(null);setAck(false);}}/></div>
        <div><label className="text-sm font-semibold" style={{color:'var(--ink)'}}>Amount (USDC)</label>
          <input className={field+' mt-2'} style={{background:'var(--surface-raised)',borderColor:'var(--border)',color:'var(--ink)'}}
            value={amount} inputMode="decimal" placeholder="0.01" disabled={blocked}
            onChange={e=>{setAmount(e.target.value);onDraftChange?.({amount:e.target.value});setReview(null);setAck(false);}}/></div>
        </>}
        {!review&&!journal&&<button className="w-full rounded-xl px-4 py-3 text-sm font-bold disabled:opacity-40"
          disabled={blocked} style={{background:'var(--accent)',color:'#fff'}}
          onClick={()=>void prepare()}>{busy?'Checking…':'Review payment'}</button>}
        {review&&!journal&&<div className="space-y-3 rounded-xl border p-4 text-sm"
          style={{borderColor:'var(--border)',color:'var(--ink)'}}>
          <strong>Arc Mainnet · Review before signing</strong>
          <p className="break-all text-xs">From: {review.plan.from}</p>
          <p className="break-all text-xs">To: {review.plan.to}</p>
          <p>Amount: <strong>{review.plan.amount} USDC</strong></p>
          <p>Estimated gas reserve: {formatUnits(review.preflight.feeReserveUnits,6)} USDC</p>
          <label className="flex items-start gap-2 text-xs">
            <input type="checkbox" checked={ack} onChange={e=>setAck(e.target.checked)}/>
            <span>I verified network, recipient, amount and real-money risk.</span>
          </label>
          <button className="w-full rounded-xl px-4 py-3 font-bold disabled:opacity-40"
            disabled={!ack||busy||MAINNET_EMERGENCY_READ_ONLY} style={{background:'var(--accent)',color:'#fff'}} onClick={()=>void send()}>
            Confirm in wallet
          </button>
          <button className="w-full py-2 text-xs" onClick={()=>{setReview(null);setAck(false);}}>Edit details</button>
        </div>}
      </div>
      {(journal||blockedStorage)&&<div className={box+' space-y-3'} role="status"
        style={{background:'var(--surface)',borderColor:'var(--border)',color:'var(--ink)'}}>
        <h2 className="text-lg font-semibold">Payment status</h2>
        {blockedStorage?<p className="text-sm" style={{color:'var(--warning)'}}>
          Previous transaction record unreadable. Signing blocked. Check wallet history.
        </p>:journal&&<>
          <p className="text-sm" style={{color:'var(--muted)'}}>
            {receipt?.state==='VERIFIED'?'Verified on Arc Mainnet':receipt?.state==='REVERTED'?'Transaction reverted':
              'Transaction pending or uncertain. Do not submit a second payment.'}
          </p>
          {receipt?.state==='VERIFIED'&&<CheckCircle2 className="size-5" style={{color:'var(--success)'}}/>}
          {journal.hash&&<a className="flex items-center gap-2 break-all text-xs" href={mainnetExplorerTx(journal.hash)}
            style={{color:'var(--accent)'}} target="_blank" rel="noreferrer">
            {journal.hash}<ExternalLink className="size-4"/></a>}
          {!journal.hash&&<details className="rounded-xl border p-3" style={{borderColor:'var(--border)'}}>
            <summary className="cursor-pointer text-xs" style={{color:'var(--muted)'}}>Advanced recovery · only if the wallet did not return a hash</summary>
            <p className="my-2 text-xs" style={{color:'var(--warning)'}}>
              The original wallet request has an uncertain outcome. Do not send again. Normally Veyra recovers automatically; only use this fallback if your wallet can identify the exact original transaction.
            </p>
            <input className={field} placeholder="Original transaction from wallet history"
              value={hashInput} style={{background:'var(--surface-raised)',borderColor:'var(--border)',color:'var(--ink)'}}
              onChange={e=>setHashInput(e.target.value)}/>
          </details>}
          {!['VERIFIED','REVERTED'].includes(journal.stage)&&
            <button className="rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-40"
              disabled={busy||!(journal.hash||hashInput)} style={{background:'var(--accent)',color:'#fff'}}
              onClick={()=>void verify()}>Check original receipt</button>}
          {['VERIFIED','REVERTED'].includes(journal.stage)&&
            <button className="rounded-xl px-4 py-2 text-sm font-semibold"
              style={{background:'var(--accent)',color:'#fff'}} onClick={reset}>Start new payment</button>}
        </>}
      </div>}
    </>}
    {error&&<div role="alert" className="rounded-xl border px-4 py-3 text-sm"
      style={{borderColor:'var(--warning)',color:'var(--warning)'}}>{error}</div>}
  </div>;
}
