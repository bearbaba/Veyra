/** Arc Mainnet wallet-to-wallet USDC Pay. Uses the existing hardened canary pipeline.
 * Real wallet signature only; fail-closed preflight and recovery lock prevent duplicate retries.
 */
import { useEffect, useRef, useState } from 'react';
import { useAccount, useSwitchChain } from 'wagmi';
import { ConnectKitButton } from 'connectkit';
import { formatUnits } from 'viem';
import { recordLocalOperation } from '@/mainnet/localOperations';
import {withMainnetWalletSigningLock} from '@/mainnet/mainnetWalletSigningLock';
import {classifyMainnetPayFailure} from '@/mainnet/mainnetPayFailureOutcome';
import {listVerifiedMainnetPayReceipts,type MainnetPayServerReceipt} from '@/lib/api/mainnetPayReceipts';
import {enqueueVerifiedPay,readReceiptOutbox,storageForReceiptOutbox,type ReceiptOutboxItem} from '@/mainnet/receiptOutbox';
import {preparePaymentRecipient,verifyPaymentRecipient} from '@/lib/api/identityApi';
import {useUnifiedSocial} from '@/features/social/UnifiedSocial';
import {isSameVerifiedPaymentReceiver,type VerifiedMainnetRecipient} from '@/mainnet/verifiedRecipient';
import type {MainnetPayDraft} from '@/mainnet/payDraft';
import {assertMainnetCanarySigningAllowed,canSignMainnetCanary,MAINNET_EMERGENCY_READ_ONLY,MAINNET_CANARY_ONLY} from '@/mainnet/releaseGates';
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
  async function reverifySelectedIdentity(plan:MainnetPlan):Promise<VerifiedMainnetRecipient|null>{
    if(verifiedRecipient&&!idSelection)
      throw Error('The recipient wallet no longer matches the selected Veyra ID. Select the person again.');
    if(!idSelection)return null;
    if(social.identityOrigin!=='ready'||!social.session?.token)
      throw Error('Veyra ID sign-in expired. Sign in again to verify the recipient.');
    // Refresh a short-lived snapshot, but never silently change the original receiver.
    const prepared=await preparePaymentRecipient('@'+idSelection.veyraHandle+'.veyra',5042,social.session.token);
    if(prepared.kind!=='VEYRA_IDENTITY'||prepared.chainId!==5042||!prepared.snapshot)
      throw Error('Recipient Veyra ID is no longer available for Mainnet payments.');
    const sn=prepared.snapshot;
    const renewed:VerifiedMainnetRecipient={...idSelection,wallet:prepared.resolvedAddress,
      walletId:sn.walletId,veyraUserId:sn.veyraUserId,veyraHandle:sn.veyraHandle,
      displayName:sn.displayName,snapshotId:sn.snapshotId,reviewToken:sn.reviewToken,expiresAt:sn.expiresAt};
    if(!isSameVerifiedPaymentReceiver(idSelection,renewed)||renewed.wallet.toLowerCase()!==plan.to.toLowerCase())
      throw Error('Receiving wallet or identity changed. Return to People to review. No transfer started.');
    await verifyPaymentRecipient({snapshotId:renewed.snapshotId,expectedWalletId:renewed.walletId,
      expectedWalletAddress:plan.to,expectedChainId:5042,reviewToken:renewed.reviewToken},social.session.token);
    return renewed;
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
  const [completed,setCompleted]=useState<MainnetJournal|null>(null);
  const [outboxItem,setOutboxItem]=useState<ReceiptOutboxItem|null>(null);
  const [accountReceipt,setAccountReceipt]=useState<MainnetPayServerReceipt|null>(null);
  const [receiptSessionScope,setReceiptSessionScope]=useState('');

  useEffect(()=>{
    setReview(null);setAck(false);setReceipt(null);setCompleted(null);setOutboxItem(null);setAccountReceipt(null);setReceiptSessionScope('');setError(null);
    if(!address){setJournal(null);setBlockedStorage(false);setLoadedFor(null);return;}
    const storage=storageForReceiptOutbox();
    const stored=readMainnetJournal(address,storage);
    const outbox=readReceiptOutbox(address,storage);
    setJournal(stored.kind==='active'?stored.value:null);
    setBlockedStorage(stored.kind==='blocked'||outbox.kind==='blocked');
    if(stored.kind!=='active'&&outbox.kind==='ready'&&outbox.items.length){
      const item=outbox.items[outbox.items.length-1];
      setCompleted({from:item.owner,to:item.to,amount:item.amount,stage:'VERIFIED',hash:item.hash,
       note:item.note,recipientLabel:item.recipientLabel,recipientSnapshotId:item.snapshotId,senderUserId:item.senderUserId});
      setOutboxItem(item);
    }
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
  const signedForWallet=!!address&&social.identityOrigin==='ready'&&!!social.session?.token&&
    social.session.walletKey===address.toLowerCase()+':'+(connector?.uid??'');
  const blocked=!ready||!signedForWallet||blockedStorage||!!journal||busy||chainId!==5042;
  async function prepare(){
    if(!address||blocked||lock.current||!signedForWallet)return;
    lock.current=true;setBusy(true);setError(null);setReview(null);
    try {
      const queued=readReceiptOutbox(address,storageForReceiptOutbox());
      if(queued.kind!=='ready'||queued.items.length>=60)
       throw Error('Receipt storage needs attention before signing another payment.');
      const plan=buildMainnetPayPlan(address,recipient.trim(),amount.trim());
      const preflight=await mainnetPreflight(await provider(),plan);
      await reverifySelectedIdentity(plan);
      setReview({plan,preflight});setAck(false);
    }catch(e){setError(msg(e));}
    finally{lock.current=false;setBusy(false);}
  }
  async function send(){
    if(!address||!review||!ack||blocked||lock.current||!signedForWallet)return;
    try{assertMainnetCanarySigningAllowed(review.plan.from,review.plan.units);}catch(e){setError(msg(e));return;}
    lock.current=true;setBusy(true);setError(null);
    let initial:MainnetJournal={from:review.plan.from,to:review.plan.to,amount:review.plan.amount,hash:null,stage:'AWAITING_WALLET',
      note:sharedDraft?.note?.trim().slice(0,120)||undefined,
      senderUserId:social.session?.profile.veyraUserId,
      recipientLabel:idSelection?'@'+idSelection.veyraHandle+'.veyra':undefined};
    let requested=false,wroteJournal=false,submittedHash:string|null=null;
    try {
      await withMainnetWalletSigningLock(address,async()=>{
      const renewed=await reverifySelectedIdentity(review.plan);
      const queued=readReceiptOutbox(address,storageForReceiptOutbox());
      if(queued.kind!=='ready'||queued.items.length>=60)
       throw Error('Receipt queue is unavailable or full. No wallet transfer requested.');
      initial={...initial,recipientSnapshotId:renewed?.snapshotId};
      if(readMainnetJournal(address,storageForMainnet()).kind!=='empty')
        throw new Error('Earlier transaction record exists. Do not resubmit.');
      if(!writeMainnetJournal(initial,storageForMainnet()))
        throw new Error('Cannot persist payment lock. Signing disabled.');
      wroteJournal=true;setJournal(initial);
      const hash=await requestMainnetCanaryTransfer(await provider(),review.plan,()=>{requested=true;});
      submittedHash=hash;
      const next:MainnetJournal={...initial,hash,stage:'PENDING'};
      setJournal(next);setHashInput(hash);
      recordLocalOperation({type:'Pay',hash,owner:address,amount:review.plan.amount,asset:'USDC',chainId:5042,
       status:'SUBMITTED',destination:review.plan.to,
       note:sharedDraft?.note?.trim().slice(0,120)||undefined,
       recipientLabel:idSelection?'@'+idSelection.veyraHandle+'.veyra':undefined,
       recipientSnapshotId:initial.recipientSnapshotId});
      if(!writeMainnetJournal(next,storageForMainnet()))
        setError('Payment submitted but hash storage failed. Keep this hash and do not retry: '+hash);
      });
    }catch(e){
      const outcome=classifyMainnetPayFailure(requested,e);
      let caution='';
      if(outcome==='before-wallet'){
        if(wroteJournal){
          const latest=readMainnetJournal(initial.from,storageForMainnet());
          if(latest.kind==='active'&&latest.value.stage==='AWAITING_WALLET'&&
             latest.value.hash===null&&latest.value.to.toLowerCase()===initial.to.toLowerCase()&&
             latest.value.amount===initial.amount&&
             clearMainnetJournal(initial.from,storageForMainnet()))setJournal(null);
          else caution=' Original pre-sign lock could not be safely cleared. Inspect Activity.';
        }
      }else{
        // A provider rejection/error after eth_sendTransaction is NOT
        // definitive evidence that no original transaction was broadcast.
        const unresolved:MainnetJournal={...initial,stage:submittedHash?'PENDING':'UNKNOWN',
          hash:submittedHash};
        if(writeMainnetJournal(unresolved,storageForMainnet()))setJournal(unresolved);
        else caution=' Recovery storage failed. Preserve any original transaction hash.';
        caution+=' Wallet request outcome uncertain. Check the original transaction; do not resend.';
      }
      setError(msg(e)+caution);
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
      if(result.state==='VERIFIED')recordLocalOperation({type:'Pay',hash:result.hash,owner:address,amount:journal.amount,asset:'USDC',chainId:5042,status:'RECORDED',destination:journal.to,note:journal.note,recipientLabel:journal.recipientLabel,recipientSnapshotId:journal.recipientSnapshotId});
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
          if(result.state==='VERIFIED')recordLocalOperation({type:'Pay',hash:snapshot.hash!,owner:snapshot.from,amount:snapshot.amount,asset:'USDC',chainId:5042,status:'RECORDED',destination:snapshot.to,note:snapshot.note,recipientLabel:snapshot.recipientLabel,recipientSnapshotId:snapshot.recipientSnapshotId});
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
  // ONLY when independently verified and durably stored, hand off to an outbox.
  // An UNKNOWN/PENDING original transaction never releases the wallet journal.
  useEffect(()=>{
    if(!address||!journal||journal.stage!=='VERIFIED'||!journal.hash||lock.current)return;
    const result=enqueueVerifiedPay(journal,storageForReceiptOutbox());
    if(result.kind!=='queued'){
      setError(result.reason??'Could not preserve verified receipt. Keep original payment locked.');
      return;
    }
    setCompleted(journal);setJournal(null);setReview(null);setAck(false);
    const latest=readReceiptOutbox(address,storageForReceiptOutbox());
    if(latest.kind==='ready')setOutboxItem(latest.items.find(v=>v.hash.toLowerCase()===journal.hash?.toLowerCase())??null);
  },[address,journal?.hash,journal?.stage,journal?.from,journal?.to,journal?.amount]);
  // Read the receipt that the global worker has written, for the same owner and hash.
  useEffect(()=>{
    if(!address||!completed?.hash)return;
    let active=true;
    setAccountReceipt(null);setReceiptSessionScope('');
    const controller=new AbortController();
    const wallet=address,hash=completed.hash;
    const session=social.session;
    const refresh=()=>{
      const queue=readReceiptOutbox(wallet,storageForReceiptOutbox());
      if(queue.kind==='ready')setOutboxItem(queue.items.find(x=>x.hash===hash?.toLowerCase())??null);
      if(!session?.token||session.walletKey!==(wallet.toLowerCase()+':'+(connector?.uid??''))||social.identityOrigin!=='ready'){
        setAccountReceipt(null);return;
      }
      void listVerifiedMainnetPayReceipts(session.token,controller.signal).then(receipts=>{
        if(!active)return;
        setAccountReceipt(receipts.find(x=>x.txHash.toLowerCase()===hash?.toLowerCase()&&
         x.senderAddress.toLowerCase()===wallet.toLowerCase()&&x.direction==='sent')??null);
        setReceiptSessionScope(wallet.toLowerCase()+':'+session.token);
      }).catch(()=>{/* The chain transfer stays verified; account history can be offline. */});
    };
    refresh();
    window.addEventListener('veyra:mainnet:server-receipt',refresh);
    window.addEventListener('veyra:mainnet:outbox',refresh);
    window.addEventListener('focus',refresh);
    return()=>{active=false;controller.abort();window.removeEventListener('veyra:mainnet:server-receipt',refresh);
      window.removeEventListener('veyra:mainnet:outbox',refresh);window.removeEventListener('focus',refresh);};
  },[address,completed?.hash,social.session?.token,social.session?.walletKey,connector?.uid,social.identityOrigin]);
  function reset(){
    if(!address||lock.current)return;
    if(journal){
      if(journal.stage!=='REVERTED')return;
      if(!clearMainnetJournal(address,storageForMainnet())){setError('Cannot clear reverted payment lock.');return;}
    }else if(!completed)return;
    setJournal(null);setCompleted(null);setOutboxItem(null);setReview(null);setReceipt(null);setAccountReceipt(null);setReceiptSessionScope('');
    setRecipient('');setAmount('');setHashInput('');setError(null);
  }
  const shownJournal=journal?.from.toLowerCase()===address?.toLowerCase()?journal:null;
  const shownCompleted=!shownJournal&&completed?.from.toLowerCase()===address?.toLowerCase()?completed:null;
  const shownAccountReceipt=social.session?.token&&social.identityOrigin==='ready'&&!!accountReceipt&&
   receiptSessionScope===address?.toLowerCase()+':'+social.session.token&&
   accountReceipt.senderAddress.toLowerCase()===address?.toLowerCase()&&
   accountReceipt.txHash.toLowerCase()===(shownCompleted?.hash??shownJournal?.hash)?.toLowerCase()?accountReceipt:null;
  const shownOutbox=shownCompleted?.hash===outboxItem?.hash&&
   shownCompleted?.from.toLowerCase()===outboxItem?.owner.toLowerCase()?outboxItem:null;
  return <div className={embedded?'space-y-4':'mx-auto w-full max-w-2xl space-y-5 px-4 py-7 md:px-7 md:py-9'}>
    {!embedded&&<div>
      <span className="text-xs font-bold uppercase" style={{color:'var(--accent)'}}>Arc Mainnet · 5042</span>
      <h1 className="display mt-2 text-3xl font-bold" style={{color:'var(--ink)'}}>Pay</h1>
      <p className="mt-2 text-sm" style={{color:'var(--muted)'}}>
        Send USDC to a wallet. Veyra automatically tracks and checks the receipt.
      </p>
    </div>}
    {!embedded&&<div className={box} style={{background:'var(--surface)',borderColor:'var(--border)'}}>
      <div className="flex items-start gap-3 text-sm" style={{color:'var(--muted)'}}>
        <ShieldCheck className="size-5 shrink-0" style={{color:'var(--accent)'}}/>
        <p><strong style={{color:'var(--ink)'}}>Direct wallet transfer · {MAINNET_CANARY_ONLY?'pilot limit 0.01 USDC.':'limit 1 USDC.'}</strong> Your wallet confirms this payment once; no token spending permission is granted.
          If it remains pending, Veyra checks the existing transaction rather than sending again.</p>
      </div>
    </div>}
    {(shownCompleted||shownJournal?.stage==='VERIFIED')&&
      <section aria-label="USDC payment receipt" className={box+' space-y-3'}
       style={{background:'var(--surface)',borderColor:'var(--border)',color:'var(--ink)'}}>
        <div className="flex items-center gap-2">
         <CheckCircle2 className="size-5" style={{color:'var(--success)'}}/>
         <strong>Sent · {shownAccountReceipt?formatUnits(BigInt(shownAccountReceipt.amountRaw),6):
          (shownCompleted??shownJournal)?.amount} USDC</strong>
        </div>
        <p className="text-sm">To {shownAccountReceipt?.recipientLabel??shownCompleted?.recipientLabel??
          shownCompleted?.to??shownJournal?.to}</p>
        <p role="status" className="text-xs" style={{color:'var(--muted)'}}>
         {shownAccountReceipt?'Receipt saved to Veyra · '+new Date(shownAccountReceipt.paidAt).toLocaleString():
          !social.session?.token||social.identityOrigin!=='ready'?
           'Money sent · sign in to save the receipt to your account.':
          shownOutbox?.status==='review'?'Money sent · receipt needs review. No second transfer.':
          shownOutbox?.status==='sign-in'?'Money sent · sign in again to sync the receipt.':
          'Money sent · syncing receipt. No second transfer.'}
        </p>
        {shownOutbox?.problem&&shownOutbox.status==='review'&&
          <p className="text-xs" style={{color:'var(--warning)'}}>Receipt review: {shownOutbox.problem}</p>}
        <details className="text-xs" style={{color:'var(--muted)'}}>
         <summary className="cursor-pointer">Receipt and transaction details</summary>
         <p className="mt-2">Arc Mainnet · 5042</p>
         {shownAccountReceipt&&<p className="mt-1">Paid {new Date(shownAccountReceipt.paidAt).toLocaleString()} · Block {shownAccountReceipt.blockNumber}</p>}
         <p className="mt-2 break-all">Recipient wallet: {(shownCompleted??shownJournal)?.to}</p>
         {(shownCompleted??shownJournal)?.hash&&<a className="mt-2 inline-flex items-center gap-2 break-all"
          href={mainnetExplorerTx((shownCompleted??shownJournal)!.hash!)}
          style={{color:'var(--accent)'}} target="_blank" rel="noreferrer">View original transaction <ExternalLink className="size-4"/></a>}
        </details>
        {!shownJournal&&shownCompleted&&<button type="button" onClick={reset}
         className="w-full rounded-xl border px-4 py-3 text-sm font-semibold"
         style={{borderColor:'var(--border)',color:'var(--accent)'}}>Start another payment</button>}
      </section>}
    {!embedded&&idSelection&&<div role="status" className={box} style={{background:'var(--surface)',borderColor:'var(--border)',color:'var(--ink)'}}>
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
      {!shownCompleted&&<div className={embedded?'space-y-4':box+' space-y-4'} style={{background:'var(--surface)',borderColor:embedded?'transparent':'var(--border)'}}>
        {!embedded&&<><div><label className="text-sm font-semibold" style={{color:'var(--ink)'}}>Recipient wallet</label>
          <input className={field+' mt-2'} style={{background:'var(--surface-raised)',borderColor:'var(--border)',color:'var(--ink)'}}
            value={recipient} maxLength={42} autoComplete="off" spellCheck={false} placeholder="0x…"
            disabled={blocked} onChange={e=>{setRecipient(e.target.value);onDraftChange?.({recipient:e.target.value});setReview(null);setAck(false);}}/></div>
        <div><label className="text-sm font-semibold" style={{color:'var(--ink)'}}>Amount (USDC)</label>
          <input className={field+' mt-2'} style={{background:'var(--surface-raised)',borderColor:'var(--border)',color:'var(--ink)'}}
            value={amount} inputMode="decimal" placeholder="0.01" disabled={blocked}
            onChange={e=>{setAmount(e.target.value);onDraftChange?.({amount:e.target.value});setReview(null);setAck(false);}}/></div>
        </>}
        {!review&&!shownJournal&&<button className="w-full rounded-xl px-4 py-3 text-sm font-bold disabled:opacity-40"
          disabled={blocked} style={{background:'var(--accent)',color:'#fff'}}
          onClick={()=>void prepare()}>{busy?'Checking…':'Review payment'}</button>}
        {review&&!shownJournal&&<div className="space-y-3 rounded-xl border p-4 text-sm"
          style={{borderColor:'var(--border)',color:'var(--ink)'}}>
          <strong>Review · Arc Mainnet USDC</strong>
          <p>To: <strong>{idSelection?'@'+idSelection.veyraHandle+'.veyra':review.plan.to}</strong></p>
          <p>You send: <strong>{review.plan.amount} USDC</strong></p>
          <p>Network fee reserve (estimate): {formatUnits(review.preflight.feeReserveUnits,6)} USDC</p>
          <p>Amount + fee reserve: <strong>{formatUnits(review.plan.units+review.preflight.feeReserveUnits,6)} USDC</strong></p>
          <p>Recipient receives: <strong>{review.plan.amount} USDC</strong> if the transfer succeeds.</p>
          <details className="text-xs" style={{color:'var(--muted)'}}>
           <summary className="cursor-pointer">Wallet and contract details</summary>
           <p className="mt-2 break-all">From: {review.plan.from}</p>
           <p className="mt-1 break-all">To: {review.plan.to}</p>
           <p className="mt-1 break-all">USDC contract: {review.plan.token}</p>
          </details>
          <label className="flex items-start gap-2 text-xs">
            <input type="checkbox" checked={ack} onChange={e=>setAck(e.target.checked)}/>
            <span>I verified network, recipient, amount and real-money risk.</span>
          </label>
          <button className="w-full rounded-xl px-4 py-3 font-bold disabled:opacity-40"
            disabled={!ack||busy||MAINNET_EMERGENCY_READ_ONLY||
              MAINNET_CANARY_ONLY&&!canSignMainnetCanary(address,review.plan.units)} style={{background:'var(--accent)',color:'#fff'}} onClick={()=>void send()}>
            Confirm in wallet
          </button>
          <button className="w-full py-2 text-xs" onClick={()=>{setReview(null);setAck(false);}}>Edit details</button>
        </div>}
      </div>}
      {(shownJournal?.stage!=='VERIFIED'&&(shownJournal||blockedStorage))&&<div className={box+' space-y-3'} role="status"
        style={{background:'var(--surface)',borderColor:'var(--border)',color:'var(--ink)'}}>
        <h2 className="text-lg font-semibold">Payment status</h2>
        {blockedStorage?<p className="text-sm" style={{color:'var(--warning)'}}>
          Previous transaction record unreadable. Signing blocked. Check wallet history.
        </p>:shownJournal&&<>
          <p className="text-sm" style={{color:'var(--muted)'}}>
            {shownJournal.stage==='REVERTED'?'Transaction reverted':
              'Transaction pending or uncertain. Do not submit a second payment.'}
          </p>
          {shownJournal.hash&&<details className="text-xs" style={{color:'var(--muted)'}}>
            <summary className="cursor-pointer">Original transaction details</summary>
            <a className="mt-2 inline-flex items-center gap-2 break-all" href={mainnetExplorerTx(shownJournal.hash)}
              style={{color:'var(--accent)'}} target="_blank" rel="noreferrer">
              {shownJournal.hash}<ExternalLink className="size-4"/></a>
          </details>}
          {!shownJournal.hash&&<details className="rounded-xl border p-3" style={{borderColor:'var(--border)'}}>
            <summary className="cursor-pointer text-xs" style={{color:'var(--muted)'}}>Advanced recovery · only if the wallet did not return a hash</summary>
            <p className="my-2 text-xs" style={{color:'var(--warning)'}}>
              The original wallet request has an uncertain outcome. Do not send again. Normally Veyra recovers automatically; only use this fallback if your wallet can identify the exact original transaction.
            </p>
            <input className={field} placeholder="Original transaction from wallet history"
              value={hashInput} style={{background:'var(--surface-raised)',borderColor:'var(--border)',color:'var(--ink)'}}
              onChange={e=>setHashInput(e.target.value)}/>
          </details>}
          {!['VERIFIED','REVERTED'].includes(shownJournal.stage)&&
            <button className="rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-40"
              disabled={busy||!(shownJournal.hash||hashInput)} style={{background:'var(--accent)',color:'#fff'}}
              onClick={()=>void verify()}>Check original receipt</button>}
          {shownJournal.stage==='REVERTED'&&<button className="rounded-xl px-4 py-2 text-sm font-semibold"
              style={{background:'var(--accent)',color:'#fff'}} onClick={reset}>Start a different payment</button>}
        </>}
      </div>}
    </>}
    {error&&<div role="alert" className="rounded-xl border px-4 py-3 text-sm"
      style={{borderColor:'var(--warning)',color:'var(--warning)'}}>{error}</div>}
  </div>;
}
