/**
 * Owner-signed Arc Mainnet VeyraSettlement deployment.
 * Creation bytecode is reproducibly built & Keccak-checked by GitHub Actions.
 * No service-side signing; wallet confirmation required for any real transaction.
 */
import { useEffect, useState, useRef } from 'react';
import { useAccount, usePublicClient, useSwitchChain, useWalletClient } from 'wagmi';
import { arc } from 'viem/chains';
import { encodeDeployData, formatUnits, getAddress, isAddress, keccak256, parseAbi, type Hex } from 'viem';
import { AlertTriangle, CheckCircle2, ExternalLink, ShieldCheck, Copy, RefreshCw } from 'lucide-react';
import { VEYRA_SETTLEMENT_CREATION_BYTECODE, VEYRA_SETTLEMENT_CREATION_KECCAK } from '@/generated/veyraSettlementCreation';
import { ARC_MAINNET_USDC } from '@/config/veyraSettlement';

const CHAIN = 5042;
const ABI = parseAbi([
  'constructor(address usdc_,address initialOwner,address feeRecipient_,uint16 feeBps_)',
  'function owner() view returns (address)',
  'function usdc() view returns (address)',
  'function feeBps() view returns (uint16)',
  'function paused() view returns (bool)',
]);
const STORAGE_PREFIX = 'veyra:mainnet:settlement-deploy:v1:';
const HASH = /^0x[0-9a-fA-F]{64}$/;
const ADDR = /^0x[0-9a-fA-F]{40}$/;
type RecordState = {
  owner: string;
  input: Hex;
  txHash: Hex | null;
  contract: string | null;
  phase: 'AWAITING_WALLET' | 'PENDING' | 'VERIFIED';
  createdAt: number;
};
type ReviewState = {owner:string; input:Hex; gas:bigint; gasPrice:bigint; balance:bigint; feeReserve:bigint; reviewedAt:number};
function key(address:string) { return STORAGE_PREFIX+address.toLowerCase(); }
function read(address:string):RecordState|null{
  const v=localStorage.getItem(key(address));
  if(!v)return null;
  const record:unknown=JSON.parse(v);
  if(!record||typeof record!=='object'||Array.isArray(record))throw Error('Invalid saved deployment record');
  const r=record as RecordState;
  if(r.owner!==address.toLowerCase() || !/^0x[0-9a-fA-F]+$/.test(r.input)||
     (r.txHash!==null&&!HASH.test(r.txHash))||
     (r.contract!==null&&!ADDR.test(r.contract))||
     !['AWAITING_WALLET','PENDING','VERIFIED'].includes(r.phase))
    throw Error('Untrusted saved deployment record');
  return r;
}
function store(r:RecordState){localStorage.setItem(key(r.owner),JSON.stringify(r));}
function err(e:unknown){return e instanceof Error?e.message:'Wallet or RPC unavailable. Review the original transaction before retrying.';}
const explorer=(hash:string)=>'https://explorer.arc.io/tx/'+hash;

export function MainnetSettlementDeploy(){
  const {address,chainId,isConnected}=useAccount();
  const {data:walletClient}=useWalletClient({chainId:CHAIN});
  const publicClient=usePublicClient({chainId:CHAIN});
  const {switchChain}=useSwitchChain();
  const [record,setRecord]=useState<RecordState|null>(null);
  const [blocked,setBlocked]=useState(false);
  const [review,setReview]=useState<ReviewState|null>(null);
  const [accepted,setAccepted]=useState(false);
  const [manualHash,setManualHash]=useState('');
  const [message,setMessage]=useState('');
  const [busy,setBusy]=useState(false);
  const lock=useRef(false);

  useEffect(()=>{
    setReview(null);setAccepted(false);setManualHash('');setMessage('');
    if(!address){setRecord(null);setBlocked(false);return;}
    try{setRecord(read(address));setBlocked(false);}
    catch{setRecord(null);setBlocked(true);setMessage('Saved deployment record is unreadable. No new deployment will be signed until reviewed.');}
  },[address]);
  useEffect(()=>{setReview(null);setAccepted(false);},[chainId]);

  const owner = address ? getAddress(address) : null;
  const canReview = isConnected && owner && chainId===CHAIN && !!publicClient && !record && !blocked && !busy;

  async function checkPreflight(){
    if(!canReview || !owner || !publicClient || lock.current)return;
    lock.current=true;setBusy(true);setMessage('');setAccepted(false);setReview(null);
    try{
      if(await publicClient.getChainId()!==CHAIN)throw Error('Connected RPC is not Arc Mainnet (5042).');
      if(keccak256(VEYRA_SETTLEMENT_CREATION_BYTECODE)!==VEYRA_SETTLEMENT_CREATION_KECCAK)
        throw Error('Verified creation bytecode hash mismatch. Deployment blocked.');
      const code=await publicClient.getBytecode({address:ARC_MAINNET_USDC});
      if(!code || code==='0x')throw Error('Canonical Arc USDC bytecode is unavailable.');
      const input=encodeDeployData({
        abi:ABI,bytecode:VEYRA_SETTLEMENT_CREATION_BYTECODE,
        args:[ARC_MAINNET_USDC,owner,owner,0],
      });
      const [gas,gasPrice,balance]=await Promise.all([
        publicClient.estimateGas({account:owner,data:input}),
        publicClient.getGasPrice(),
        publicClient.getBalance({address:owner}),
      ]);
      if(gas<=0n || gasPrice<=0n)throw Error('Cannot estimate Mainnet deployment gas.');
      // 20% reserve for live gas variance. Never present a fabricated fixed fee.
      const reserve=(gas*gasPrice*120n+99n)/100n;
      if(balance<reserve)throw Error(
        'Insufficient native Arc USDC for deployment reserve: '+formatUnits(reserve,18)+
        ' USDC; available '+formatUnits(balance,18)+' USDC.'
      );
      setReview({owner,input,gas,gasPrice,balance,feeReserve:reserve,reviewedAt:Date.now()});
    }catch(e){setMessage(err(e));}
    finally{lock.current=false;setBusy(false);}
  }

  async function verifyTx(txHash:Hex, original:RecordState){
    if(!publicClient || !owner)throw Error('Arc RPC or connected wallet unavailable.');
    if(await publicClient.getChainId()!==CHAIN)throw Error('RPC changed network.');
    const tx=await publicClient.getTransaction({hash:txHash});
    if(tx.from.toLowerCase()!==original.owner || tx.to!==null ||
       tx.input.toLowerCase()!==original.input.toLowerCase()){
      throw Error('Deployment hash is not the reviewed owner-signed constructor transaction.');
    }
    const receipt=await publicClient.getTransactionReceipt({hash:txHash});
    if(receipt.status!=='success')throw Error('Deployment reverted; do not retry without checking the transaction.');
    const contract=receipt.contractAddress;
    if(!contract || !isAddress(contract))throw Error('No contract address in deployment receipt.');
    const code=await publicClient.getBytecode({address:contract});
    if(!code||code==='0x')throw Error('Contract runtime bytecode not present.');
    const [deployedOwner,deployedUsdc,fee,paused]=await Promise.all([
      publicClient.readContract({address:contract,abi:ABI,functionName:'owner'}),
      publicClient.readContract({address:contract,abi:ABI,functionName:'usdc'}),
      publicClient.readContract({address:contract,abi:ABI,functionName:'feeBps'}),
      publicClient.readContract({address:contract,abi:ABI,functionName:'paused'}),
    ]);
    if(deployedOwner.toLowerCase()!==owner.toLowerCase()||
       deployedUsdc.toLowerCase()!==ARC_MAINNET_USDC.toLowerCase()||
       fee!==0||paused!==false){
      throw Error('Deployed contract parameters do not match the approved Mainnet configuration.');
    }
    const verified:RecordState={...original,txHash,contract,phase:'VERIFIED'};
    store(verified);setRecord(verified);setMessage('');
  }

  async function deploy(){
    if(!review||!accepted||!owner||!publicClient||!walletClient||chainId!==CHAIN||
       record||blocked||lock.current)return;
    lock.current=true;setBusy(true);setMessage('');
    let pending:RecordState|null=null;
    try{
      if(Date.now()-review.reviewedAt>90_000)throw Error('Gas estimate expired. Review again.');
      if(review.owner!==owner)throw Error('Connected wallet changed after Review.');
      if(read(owner))throw Error('A deployment record already exists. Do not send another.');
      if(await publicClient.getChainId()!==CHAIN || walletClient.chain.id!==CHAIN)
        throw Error('Wallet/RPC network changed.');
      if(keccak256(VEYRA_SETTLEMENT_CREATION_BYTECODE)!==VEYRA_SETTLEMENT_CREATION_KECCAK)
        throw Error('Bytecode integrity check failed.');
      const liveGasPrice=await publicClient.getGasPrice();
      if(liveGasPrice>review.gasPrice*120n/100n)
        throw Error('Gas price increased more than 20%. Review again.');
      const nativeBalance=await publicClient.getBalance({address:owner});
      if(nativeBalance<review.feeReserve)throw Error('Available gas balance changed. Review again.');
      pending={owner:owner.toLowerCase(),input:review.input,txHash:null,contract:null,phase:'AWAITING_WALLET',createdAt:Date.now()};
      store(pending);setRecord(pending);
      const hash=await walletClient.sendTransaction({
        account:owner,
        chain:arc,
        data:review.input,
        gas:review.gas+review.gas/5n,
      });
      pending={...pending,txHash:hash,phase:'PENDING'};
      store(pending);setRecord(pending);
      setManualHash(hash);
      setReview(null);setAccepted(false);
      try{await verifyTx(hash,pending);}
      catch(e){setMessage('Transaction submitted. '+err(e)+' Check the original hash below; do not redeploy.');}
    }catch(e){
      setMessage(err(e));
      // Once an injected wallet has been asked to sign, an unknown transaction
      // must NEVER be silently cleared or sent again.
      if(!pending)setReview(null);
    }finally{lock.current=false;setBusy(false);}
  }

  async function verifyAgain(){
    if(!owner||!record||lock.current||!publicClient)return;
    const hash=(record.txHash??manualHash) as Hex;
    if(!HASH.test(hash)){setMessage('Enter the original deployment transaction hash from MetaMask/Arc Explorer.');return;}
    lock.current=true;setBusy(true);setMessage('');
    try{await verifyTx(hash,record);}
    catch(e){setMessage('Verification not complete: '+err(e));}
    finally{lock.current=false;setBusy(false);}
  }

  const signed=record?.phase==='VERIFIED';
  const details=record?.contract&&record.txHash
    ?'VeyraSettlement Arc Mainnet\nContract: '+record.contract+'\nDeploy TX: '+record.txHash+'\nOwner: '+record.owner+'\nUSDC: '+ARC_MAINNET_USDC+'\nFee bps: 0\nChain: 5042'
    :'';
  return <section aria-label="Deploy VeyraSettlement on Arc Mainnet"
    className="mx-auto mt-4 w-full max-w-2xl rounded-2xl border p-5 sm:p-6 space-y-4"
    style={{background:'var(--surface)',borderColor:'var(--border)'}}>
    <div className="flex gap-3">
      <ShieldCheck className="size-6 shrink-0" style={{color:'var(--accent)'}}/>
      <div>
        <h2 className="font-bold text-lg" style={{color:'var(--ink)'}}>
          {signed?'Contract deployed — verification passed':'Deploy VeyraSettlement'}
        </h2>
        <p className="mt-1 text-sm leading-6" style={{color:'var(--muted)'}}>
          One owner-signed deployment on Arc Mainnet. Contract source and creation bytecode were hash-verified in GitHub Actions.
          You approve the transaction in MetaMask; Veyra never holds your keys.
        </p>
      </div>
    </div>
    {!isConnected&&<p className="text-sm" style={{color:'var(--warning)'}}>Connect your owner wallet first.</p>}
    {isConnected&&chainId!==CHAIN&&<button type="button" onClick={()=>switchChain({chainId:CHAIN})}
      className="rounded-xl px-4 py-3 text-sm font-semibold"
      style={{background:'var(--accent)',color:'#0d1b2f'}}>Switch to Arc Mainnet (5042)</button>}
    <div className="rounded-xl border p-4 text-xs space-y-2" style={{borderColor:'var(--border)',color:'var(--muted)'}}>
      <p>USDC token: <span className="break-all font-mono">{ARC_MAINNET_USDC}</span></p>
      <p>Initial owner: <span className="break-all font-mono">{owner??'Connect wallet'}</span></p>
      <p>Fee recipient: <span className="break-all font-mono">{owner??'Connect wallet'}</span></p>
      <p>Protocol fee: 0 bps · Direct Pay only at launch</p>
      <p>Verified creation bytecode: <span className="break-all font-mono">{VEYRA_SETTLEMENT_CREATION_KECCAK}</span></p>
    </div>
    {!record&&<div className="space-y-3">
      <button type="button" onClick={()=>void checkPreflight()} disabled={!canReview}
        className="w-full rounded-xl px-4 py-3 text-sm font-bold disabled:opacity-40"
        style={{background:'var(--accent)',color:'#0d1b2f'}}>
        {busy?'Checking real Mainnet gas…':'Review deployment and gas'}
      </button>
      {review&&<div className="rounded-xl border p-4 text-sm space-y-2"
        style={{borderColor:'var(--border)',color:'var(--ink)'}}>
        <strong>Review — real Mainnet transaction</strong>
        <p>Estimated gas: {review.gas.toString()} units</p>
        <p>Live gas price: {formatUnits(review.gasPrice,18)} USDC/gas</p>
        <p>Gas reserve including 20% buffer: <strong>{formatUnits(review.feeReserve,18)} USDC</strong></p>
        <p>Native USDC available: {formatUnits(review.balance,18)} USDC</p>
        <label className="flex items-start gap-2 text-xs">
          <input type="checkbox" checked={accepted} onChange={e=>setAccepted(e.target.checked)}/>
          <span>I authorize deploying this exact contract on Arc Mainnet using my own wallet and paying the real gas fee.</span>
        </label>
        <button type="button" disabled={!accepted||busy}
          className="w-full rounded-xl px-4 py-3 font-bold disabled:opacity-40"
          style={{background:'var(--accent)',color:'#0d1b2f'}} onClick={()=>void deploy()}>
          Sign contract deployment in MetaMask
        </button>
      </div>}
    </div>}
    {record&&<div className="rounded-xl border p-4 space-y-3 text-sm"
      style={{borderColor:signed?'var(--success)':'var(--border)',color:'var(--ink)'}}>
      <p className="flex items-center gap-2 font-bold">
        {signed?<CheckCircle2 className="size-5" style={{color:'var(--success)'}}/>:<RefreshCw className="size-5"/>}
        {signed?'Verified contract deployment':'Previous deployment awaiting verification — do not submit another'}
      </p>
      {record.txHash&&<a href={explorer(record.txHash)} target="_blank" rel="noopener noreferrer"
        className="flex items-center gap-2 break-all font-mono text-xs" style={{color:'var(--accent)'}}>
        {record.txHash} <ExternalLink className="size-4"/>
      </a>}
      {!signed&&<div className="space-y-2">
        <input aria-label="Original deployment transaction hash" value={record.txHash??manualHash}
          onChange={e=>setManualHash(e.target.value)} placeholder="Original deployment hash 0x…"
          className="w-full rounded-xl border p-3 font-mono text-xs"
          style={{background:'var(--surface-raised)',borderColor:'var(--border)',color:'var(--ink)'}}/>
        <button type="button" onClick={()=>void verifyAgain()} disabled={busy}
          className="w-full rounded-xl border px-4 py-3 font-semibold disabled:opacity-50"
          style={{borderColor:'var(--border-strong)',color:'var(--ink)'}}>Verify original transaction on Arc</button>
      </div>}
      {record.contract&&<p className="break-all font-mono text-xs">Contract: {record.contract}</p>}
      {signed&&<div className="space-y-2">
        <p className="text-xs" style={{color:'var(--success)'}}>
          Deployer, owner, USDC, protocol fee and runtime contract presence are verified.
        </p>
        <button type="button" onClick={()=>void navigator.clipboard.writeText(details)}
          className="flex items-center gap-2 rounded-xl border px-4 py-3 text-sm font-semibold"
          style={{borderColor:'var(--border-strong)',color:'var(--ink)'}}>
          <Copy className="size-4"/> Copy contract and deployment proof
        </button>
        <p className="text-xs" style={{color:'var(--muted)'}}>
          Share the copied contract details in ChatGPT so the verified address can be published
          for every Veyra user. This local session alone does not change the public contract registry.
        </p>
      </div>}
    </div>}
    {blocked&&<p role="alert" className="flex gap-2 text-sm" style={{color:'var(--warning)'}}>
      <AlertTriangle className="size-4 shrink-0"/>Local deployment record invalid — automatic retry disabled.
    </p>}
    {message&&<p role="status" className="rounded-xl border p-3 text-xs"
      style={{borderColor:'var(--border)',color:'var(--warning)'}}>{message}</p>}
  </section>;
}
